# Research — TranscriptFeed Scroll-Positioning Architecture

**Date:** 2026-06-03
**Author:** Plan agent + cross-model (Gemini + Codex) deep analysis
**Status:** Input to F-WEB-HISTORY-FU4 Spec (SDD Step 0)
**Trigger:** Owner reverify post-FU3 surfaced AC20-A regression + AC21 regression after 3 iterations (FU1/FU2/FU3) without convergence.

---

## 1. Executive summary (ES + EN bullets)

- **El sistema falla porque mezcla tres preocupaciones en seis effects** sin un dueño único del scroll. AC20-A (search) y AC21 (loadMore) son dos problemas distintos —*bottom-lock on append* vs *anchor preservation on prepend*— y los hemos estado parcheando como si fueran uno (todo `scrollTo`/`scrollTop` aritmético).
- **AC20-A confirmado**: Effect 3 (`packages/web/src/components/TranscriptFeed.tsx:174-198`) dispara `scrollTo({behavior:'smooth'})` cuando el shimmer está montado; la NutritionCard final (~300 px vs 100 px shimmer) crece DESPUÉS de que la animación smooth termine, y Effect 3 no re-fire porque `entries.length` no cambió en el settle (in-place mutation de `entry.isLoading` + `entry.result`). FU2 deferred this as MAJOR-2 — that deferral was wrong.
- **AC21 confirmado como regresión de FU3**: Effect 5 (`TranscriptFeed.tsx:217-226`) ahora corre como `useLayoutEffect` (pre-paint). Effect 4 (capture, line 203-210) toma `scrollHeight` con los skeletons (~248 px) YA insertados, y `setIsLoadingMore(false)` + `setPersistedEntries([...])` se commitean en commits separados (microtasks distintos: `.then()` y `.finally()`, ver §4.2). La aritmética `delta = scrollHeight_now − scrollHeight_captured` es incorrecta en ambos extremos. Pre-FU3 (`useEffect`, post-paint) el browser ya había aplicado native `overflow-anchor:auto` y el JS sobre-escribía con un valor que ahora *casi coincidía*; post-FU3 (`useLayoutEffect`, pre-paint) JS gana la carrera contra el anchor nativo y mete un `scrollTop` ~+2752 px que rebasa el contenido restante.
- **Consenso de Gemini + Codex**: ambos confirman AC20-A y AC21 con root cause idéntico (smooth-scroll-vs-async-growth y stale baseline / native-anchor-vs-JS-fight). Divergen en la solución: Gemini propone radical declarativismo (`scrollIntoView` + CSS `overflow-anchor`, eliminar Effects 4+5); Codex propone state-machine con captura en `onLoadMore` callback (pre-skeleton) y bottom-lock observer compartido entre hydration + append.
- **Recomendación**: solución híbrida (Codex's prepend-fix + Gemini's append-fix). Unificar Effect 1 + Effect 3 en un solo "scroll-to-bottom" effect con ResizeObserver compartido; mover la captura de prepend de Effect 4 a `onLoadMore` callback (pre-skeleton); mantener Effect 5 como `useLayoutEffect` ya con baseline correcta. **Tier estimado: STANDARD** (no Complex porque la mecánica es bien entendida; no Simple porque toca 3+ archivos y requiere E2E coverage para validar lo que jsdom no puede).

---

## 2. System mental model — the 6 effects

### 2.1 Catalog

| # | Effect | Hook | Deps | Reads | Writes | Timing rel. to paint |
|---|--------|------|------|-------|--------|----------------------|
| 0 | Scroll listener | `useEffect` | `[]` | `scrollTop`, `clientHeight`, `scrollHeight` | `wasNearBottomRef.current` | Async (browser scroll event) |
| 1 | Hydration scroll | `useLayoutEffect` | `[entries.length]` | `entries.length`, `hasScrolledToBottomOnHydrationRef.current` | `scrollTo({instant})`, `hydrationObserverRef.current`, `hasScrolledToBottomOnHydrationRef.current` | **PRE-paint** (sync scrollTo) + post-paint (ResizeObserver re-fires for 500 ms) |
| 2 | Unmount cleanup | `useEffect` | `[]` | `hydrationObserverRef.current` | `observer.disconnect()`, `hasScrolledToBottomOnHydrationRef.current = false` | On unmount only |
| 3 | Append smooth | `useEffect` | `[entries.length]` | `entries.length`, `prevEntriesLengthRef.current`, `wasNearBottomRef.current`, `scrollHeight` | `scrollTo({smooth})`, `prevEntriesLengthRef.current` | **POST-paint** (post-commit useEffect) |
| 4 | LoadMore capture | `useEffect` | `[isLoadingMore]` | `scrollHeight`, `scrollTop` | `prevScrollHeightRef.current`, `prevScrollTopRef.current` | **POST-paint** (post-commit useEffect) |
| 5 | LoadMore restore | `useLayoutEffect` | `[isLoadingMore]` | `scrollHeight`, `prevScrollHeightRef.current`, `prevScrollTopRef.current` | `container.scrollTop = prevScrollTopRef + delta` | **PRE-paint** (FU3 swap) |

### 2.2 Timing diagrams (ASCII)

#### (a) Initial mount — reload `/hablar` with persisted entries

```
[t=0]   React render with entries=[]
[t=1]   Browser paints empty feed
[t=2]   useSearchHistory mount fetch → returns 10 persisted entries
[t=3]   HablarShell setPersistedEntries(N=10) → setEntries([...10])
[t=4]   Render commit (entries.length 0→10)
[t=5]   PRE-PAINT phase:
          Effect 1 (useLayoutEffect) fires → scrollTo({instant, top: scrollHeight_initial})
          Effect 1 attaches ResizeObserver, 500ms timer set
[t=6]   Browser paints feed at bottom
[t=7]   Async NutritionCard layout settles (fonts, conditional sections)
[t=8]   ResizeObserver fires → scrollTo({instant, top: scrollHeight_new})
        (repeats N times during the 500ms window)
[t=500] Timer fires → observer.disconnect()
[t=...] Effect 3 (useEffect) ALSO fires once for entries.length growth
        BUT wasNearBottomRef defaults to true → smooth scrollTo({smooth, scrollHeight})
        ✅ benign no-op because ResizeObserver kept the bottom anchored.
```
✅ AC19 PASS.

#### (b) Session append (search submitted while at bottom)

```
[t=0]   User at bottom; wasNearBottomRef.current === true
[t=1]   executeQuery('paella') → setEntries(prev=>[...prev, pendingEntry])
        pendingEntry.isLoading=true, shimmer h-[100px] rendered
[t=2]   React commit (entries.length grew by 1)
[t=3]   POST-PAINT phase:
          Effect 3 (useEffect) → scrollTo({smooth, top: scrollHeight_with_shimmer})
          scrollHeight_with_shimmer ≈ scrollHeight_before + 100px shimmer + header
[t=4..1000ms+] Smooth animation runs, reaches target
[t=2000ms] API returns
[t=2001] setEntries(prev=>prev.map(...isLoading=false, result=data))
[t=2002] React commit (entries.length DID NOT GROW — same pendingEntry mutated)
[t=2003] Effect 3 short-circuits (entryCountGrew === false)
[t=2004] NutritionCard renders. scrollHeight grows from
         shimmer_h(100) → card_h(~300). +200px UNCOMPENSATED.
[t=2005] Browser paints final layout. Card bottom is BELOW the viewport.
        ❌ AC20-A FAIL.
```

#### (c) loadMore prepend (current FU3 state)

```
[t=0]   User scrolled to top. scrollTop ≈ 0; scrollHeight ≈ S0
[t=1]   IntersectionObserver fires onLoadMore → useSearchHistory.loadMore
[t=2]   loadMore sets isLoadingMore=true. React commit.
[t=3]   <HistoryLoadMoreSentinel isLoadingMore={true}> renders skeletons
        (~248px above the entries).
[t=4]   Browser paints. scrollHeight = S0 + 248.
        Native overflow-anchor:auto pins anchor element — scrollTop ≈ 248
        (or stays 0 depending on anchor algorithm).
[t=5]   POST-PAINT phase:
          Effect 4 (useEffect) captures:
            prevScrollHeightRef = S0 + 248  ← POLLUTED
            prevScrollTopRef    = scrollTop_after_anchor  ← UNRELIABLE
[t=500] fetch returns. .then() callback runs synchronously w.r.t. microtask:
          setPersistedEntries([...older, ...prev])    ← React 18 batches
        .finally() runs in next microtask:
          setIsLoadingMore(false)                      ← but this is a separate microtask
        Whether these are 1 commit or 2 depends on the React version + sync scheduling.
        On real browsers: typically 2 commits (.then resolution and .finally completion
        cross microtask boundaries; React 18 automatic batching only batches synchronous
        callbacks within a single tick).
[t=501] Commit 1: entries grew by N. Skeletons still visible. scrollHeight = S0 + 248 + N*300.
          Effect 4 dep didn't change → noop.
          Effect 5 dep didn't change → noop.
          Effect 3 entries.length grew BUT this is a prepend, not a real append.
          wasNearBottomRef = false (user at top) → noop. ✅
[t=502] Commit 2: setIsLoadingMore(false) → skeletons removed. scrollHeight = S0 + N*300.
          PRE-PAINT phase:
            Effect 5 (useLayoutEffect) fires:
              delta = (S0 + N*300) − (S0 + 248) = N*300 − 248
              scrollTop = prevScrollTopRef + (N*300 − 248)
            But prevScrollTopRef was captured AFTER skeleton insertion + AFTER browser
            applied native anchoring → potentially ≈ 248, not 0.
            New scrollTop ≈ 248 + N*300 − 248 = N*300.
            For N=10, scrollTop ≈ 3000px → past the new content's anchor → user lands
            near the bottom of the new prepended section, NOT at their original anchor.
          Browser cannot apply native anchoring because JS already wrote scrollTop pre-paint.
[t=503] Browser paints. User sees a "big jump", missing intermediate entries, lands at
        first element area or beyond.
        ❌ AC21 FAIL.
```

#### (d) Clear-all then new search

```
[t=0]   entries=[10 persisted] post-hydration. hasScrolledToBottomOnHydrationRef = true.
[t=1]   User clicks ClearHistoryButton → handleClearAll → setEntries(prev =>
        prev.filter(!isPersisted)) → entries=[].
[t=2]   Commit. Effect 3: entries.length shrank → prevEntriesLengthRef updated, no scroll.
        Effect 1: entries.length === 0 → early return.
[t=3]   User submits search → setEntries([pendingEntry]).
[t=4]   Commit. Effect 1: entries.length>0 but hasScrolledToBottomOnHydrationRef=true → early return.
        Effect 3: entries.length grew (0→1), wasNearBottomRef=true → scrollTo smooth. ✅
[t=...] API returns. Same race as AC20-A: shimmer→card growth, no re-scroll.
        ❌ Same defect as AC20-A.
```

#### (e) React 18 Strict Mode mount → cleanup → mount

```
[t=0]   First mount. Effect 1 deferred. Effect 0 mounts scroll listener.
[t=1]   Effect 1 (useLayoutEffect) → if entries.length > 0, scroll + observer attach,
        hasScrolledToBottomOnHydrationRef = true.
[t=2]   StrictMode synthetic cleanup:
          Effect 2 cleanup runs (resets hasScrolledToBottomOnHydrationRef = false,
                                  disconnects observer).
          Effect 0 cleanup runs (removes scroll listener).
[t=3]   Synthetic remount:
          Effect 1 fires again. hasScrolledToBottomOnHydrationRef is false (reset by Effect 2 cleanup),
          so observer re-attaches and scroll re-fires. ✅
        Note: this is the EXPLICIT reason Effect 2 cleanup resets the ref
        (TranscriptFeed.tsx:158, line 165).
```

---

## 3. AC20-A — definitive diagnosis

### 3.1 Frame-by-frame root cause

The race in append context is **the same race** that FU2 already solved for hydration via ResizeObserver:

- t=0: user at bottom → `wasNearBottomRef.current = true`.
- t=1: search submitted → `setEntries([...prev, {isLoading:true, ...}])`. `entries.length` grew. Effect 3 fires.
- t=2: Effect 3 reads `scrollHeight` AT THE SHIMMER STATE. Smooth scrollTo target = `scrollHeight_shimmer`.
- t=3 → t=animationEnd: browser animates the smooth scroll. Target stays fixed (smooth API does not re-evaluate target during animation).
- t=animationEnd + late: API returns → in-place mutation → NutritionCard replaces shimmer → `scrollHeight` grows ~200 px → **Effect 3 does NOT re-fire** (entries.length did not change).

The card's bottom now sits below `scrollHeight_shimmer` (the animation's target) but the viewport bottom is anchored at `scrollHeight_shimmer + paddingBottom_144px`, so the card's bottom is hidden behind the input bar.

`TranscriptFeed.tsx:194` literally calls `scrollTo({ top: container.scrollHeight, behavior: 'smooth' })` once — there is no follow-up mechanism. The append path has no analog to the hydration's `HYDRATION_RESCROLL_WINDOW_MS` ResizeObserver.

### 3.2 Why FU2's MAJOR-2 deferral was wrong

FU2 ticket (`docs/tickets/F-WEB-HISTORY-FU2-feed-scroll-settle.md:514`) states the deferral rationale:

> "Initial implementation (`isHydrationWindowActive` via `observer !== null`) broke 7 valid append-path tests because it blocked ALL appends during the 500ms window … the smooth call is optimized to no-op by browsers because the position already matches."

Two mistakes:

1. The "optimized to no-op" assumption is **only true when the smooth target equals the final position**. With shimmer→card growth happening AFTER the animation completes, smooth's target (`scrollHeight_shimmer`) is permanently below the final scrollHeight. The browser cannot retroactively re-target.
2. The "blocked 7 valid append-path tests" issue was a *test-coupling* concern, not a correctness concern. The correct surgically precise fix wasn't `isHydrationWindowActive` — it was either (a) parallel append-ResizeObserver, or (b) re-key Effect 3 to a content-shape signal (e.g., `entries.map(e=>e.isLoading).join(',')`) that captures the shimmer→card transition.

### 3.3 Cleanest fix (consensus + recommendation)

**Codex picks (a) ResizeObserver on append (parallel to hydration). Gemini picks (d) scrollIntoView({behavior:'smooth', block:'end'}) on the last entry's DOM ref.** Recommendation: **(a) ResizeObserver on append with a short bottom-lock window (~1500 ms, longer than hydration's 500 ms because the shimmer→card transition lives on the API response time).**

Why (a) over (d):

- `scrollIntoView({block:'end'})` on the LAST entry's ref does NOT account for the fixed input bar's 144 px padding — the browser scrolls the element's bottom edge to the container's bottom edge, which is BEHIND the input bar (the padding is INSIDE the scroll container, not below it). Gemini's recommendation is theoretically clean but mismatches our layout.
- A 1500 ms append bottom-lock observer parallels hydration's mechanism cleanly. The observer is keyed to "user was near bottom when append started" — captured once, no re-evaluation during the window.

**Test impact on the 8 `behavior:'smooth'` tests**: The first smooth scroll still happens; the ResizeObserver may add additional `'instant'` corrections during the 1500 ms window. Tests that check `scrollToMock` was called with `behavior: 'smooth'` at least once → still PASS. Tests that check `scrollToMock.mock.calls.length === 1` → fail (these are AC10b, AC10c assertion `expect(scrollToMock).toHaveBeenCalledTimes(1)`). Count: ~2-3 of the 8 need to be updated to accept ≥1 call, with the first call still asserted as `behavior:'smooth'`.

---

## 4. AC21 — definitive diagnosis (the regression)

### 4.1 Frame-by-frame breakdown

See §2.2(c) for the full trace. The math break:

- **Step (iii) — skeleton in DOM**: `scrollHeight` jumps by ~248 px. Browser applies `overflow-anchor:auto`; depending on anchor selection algorithm, the user's `scrollTop` may be incremented to keep the anchor element in place. Per MDN [Scroll Anchoring](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_anchoring) spec, the anchor is selected on the most recently rendered frame and adjustment fires automatically on layout shift.
- **Step (iv) — Effect 4 captures (post-paint useEffect)**: `prevScrollHeightRef.current = scrollHeight_with_skeletons`, `prevScrollTopRef.current = scrollTop_after_anchor_adjustment`.
- **Step (v) — fetch resolves**: `.then` and `.finally` resolve in different microtasks. React 18 automatic batching applies WITHIN a microtask, not across. So `setPersistedEntries` and `setIsLoadingMore(false)` typically commit as **2 separate renders** in the browser (this is the critical observation that contradicts the simpler "1 batched commit" assumption).
- **Step (vi) — Commit 1**: `entries` grew (skeletons still visible, `isLoadingMore=true`). Effect 5 dep `[isLoadingMore]` did not change → no fire. Browser paints with skeletons + prepended entries both visible briefly.
- **Step (vii) — Commit 2**: `isLoadingMore=false` → skeletons unmount. Effect 5 dep changes → fires PRE-PAINT.
- **Step (viii) — Effect 5 useLayoutEffect**:
  - `delta = scrollHeight_now − prevScrollHeightRef`. `scrollHeight_now` = entries-only height (skeletons gone, ~S0 + N*300). `prevScrollHeightRef` = (S0 + 248) [polluted by skeletons that no longer exist].
  - `delta = N*300 − 248` ≈ 2752 for N=10.
  - `scrollTop = prevScrollTopRef + delta`. If anchor-adjustment in step (iii) had moved `scrollTop` to ~248, then new `scrollTop = 248 + 2752 = 3000`. That puts the viewport ~3000 px from top, which for a feed of `S0 + N*300` may be past the user's original anchor entry or even past the original first entry.
- **Step (ix) — Browser paints**: JS-written `scrollTop` wins. Native anchor adjustment was preempted by the layout-effect's pre-paint write.

### 4.2 Why FU3 revealed it (precise)

Pre-FU3, Effect 5 was `useEffect` (post-paint). The order was:
1. Commit 2 → React applies DOM diff → browser computes layout → browser applies `overflow-anchor:auto` to keep anchor element stable → browser **paints** with corrected `scrollTop`.
2. `useEffect` callback runs. It reads `scrollHeight` (correct, final) and computes the same buggy delta, then writes the same buggy `scrollTop`.

The "almost works" pre-FU3 behavior is the conjunction of:
- The user briefly sees the correctly-anchored paint (browser's anchor adjustment).
- The buggy JS write happens AFTER paint — most users wouldn't perceive the second-frame correction if it landed close.

But the math was ALREADY wrong pre-FU3. The flicker fix in FU3 (swap to `useLayoutEffect`) **exposed** that math break because now JS writes BEFORE paint, the browser never gets a chance to apply its native correction, and the visible result is the full magnitude of the broken delta math.

This is a textbook example of "stacked bugs": FU3 didn't introduce the math break, it removed the band-aid (browser anchor adjustment) that was masking it.

### 4.3 Cleanest fix (consensus + recommendation)

**Codex picks (c) Capture in `onLoadMore` callback BEFORE skeletons appear. Gemini picks (b) Remove JS restore entirely and rely on CSS `overflow-anchor:auto`.**

Recommendation: **(c) with a small tweak**:
1. Move capture out of Effect 4 (`useEffect[isLoadingMore]`) into the `onLoadMore` prop handler in `TranscriptFeed.tsx`. Wrap the original `onLoadMore` from props in a local callback that captures `container.scrollHeight` and `container.scrollTop` synchronously **BEFORE** calling the parent's `onLoadMore` (which sets `isLoadingMore=true` → triggers skeleton render).
2. Effect 5 stays `useLayoutEffect` (so the flicker fix from FU3 holds for the corrected baseline) but now reads from a known-good baseline.
3. As a defensive measure, set `overflow-anchor: none` explicitly on the scroll container so JS owns the restoration unambiguously (Codex risk #2 in §5).

Why not (b) [Gemini's pure-CSS path]: native `overflow-anchor:auto` cannot handle the skeleton flicker correctly because the anchor element selection algorithm may pick a skeleton element as the anchor (it picks the first "stably positioned" element in the viewport, and a 124px skeleton might satisfy that). When the skeleton then disappears, the anchor is lost. Pure-CSS works for steady-state DOM mutations but is unreliable when the placeholder itself unmounts in the same frame as the real content arrives.

---

## 5. Meta-pattern — why did we iterate 3 times?

### 5.1 What we missed in FU1

- Spec did not enumerate the failure modes by *category of mutation*. We had "append", "loadMore", "hydrate" but no axis for "what happens when an entry's content changes height post-commit without changing entries.length". The shimmer→card transition was invisible to the spec.

### 5.2 What we missed in FU2

- The cross-model `/review-plan` (Codex P-C1) did surface "what about appends during the hydration window" → got modeled and tested. But "what about appends OUTSIDE the hydration window when the appended entry itself grows post-commit" was not modeled. The hydration ResizeObserver pattern was treated as a hydration-specific fix instead of a generalizable pattern.
- MAJOR-2 deferral was a **process failure**: it framed the defect as "currently benign" when the operator empirical test would have invalidated that within a day. The deferral rationale ("smooth scroll is optimized to no-op") was unverified by either a browser test or by re-reading the actual smooth-scroll spec (which does NOT re-target during animation).

### 5.3 What we missed in FU3

- The scope was framed as "useEffect → useLayoutEffect, mechanical 2-line swap, Path A no review-spec/review-plan". The implicit assumption: "the math in Effect 5 is correct; only the timing is wrong." That assumption was never validated against the skeleton-pollution case. A 30-second mental trace of "what does Effect 4 capture when skeletons are visible" would have flagged the issue.
- Path A bug-workflow is appropriate for truly mechanical swaps. This wasn't truly mechanical: changing the phase of a layout-writing effect changes the contract with the browser's anchor adjustment. The Path A criteria need to add: "swap of useEffect↔useLayoutEffect that writes scroll geometry MUST run full Path B with cross-model review."

### 5.4 Methodology lesson for memory

`feedback_layout_effect_phase_swap_needs_full_review`:
> Swapping `useEffect` ↔ `useLayoutEffect` for ANY effect that writes layout geometry (`scrollTop`, `scrollLeft`, transform, position) is NEVER a mechanical change. It alters the contract with the browser's native scroll anchoring + transition algorithms. ALWAYS run Path B (cross-model + code review) and ALWAYS include an explicit operator AC verifying the *visible result* in a real browser before merge. Path A's "mechanical 2-line swap" criterion does not apply to scroll/layout phase swaps. Pair this lesson with `feedback_jsdom_layout_ac_gap` — jsdom collapses both phases so unit tests CANNOT validate the swap.

---

## 6. Cross-model consensus

### 6.1 AC20-A diagnosis

**ALIGNED** — both confirm.
- Gemini: "Confirmed. The diagnosis is correct. Effect 3's `scrollTo` is called once, targeting the `scrollHeight` when the new entry is a short shimmer."
- Codex: "Confirmed. The failure is exactly: Effect 3 scrolls to the shimmer-era `scrollHeight`, then the real card expands later and no follow-up scroll occurs because `entries.length` did not change."

### 6.2 AC20-A fix recommendation

**DIVERGENT**.
- Gemini (d): `scrollIntoView({behavior:'smooth', block:'end'})` on the last entry's DOM ref, optionally with a ResizeObserver on the last entry for late growth.
- Codex (a): ResizeObserver on the container during a short append-bottom-lock window, parallel to hydration. "0 tests should change if the first append scroll remains `behavior:'smooth'`."

Recommendation sides with **Codex (a)** for our codebase because of the input-bar padding mismatch with `scrollIntoView({block:'end'})` (see §3.3). Gemini's recommendation is correct in the abstract but breaks against our specific `pb-[calc(9rem+env(safe-area-inset-bottom))]` padding.

### 6.3 AC21 diagnosis

**ALIGNED** — both confirm. Codex provides the most precise frame-by-frame.
- Gemini: "Confirmed. The 'JS fights native overflow-anchor:auto' theory is correct."
- Codex: "Confirmed. This is both JS fighting native overflow-anchor:auto AND Bad capture/restore endpoints because capture happens after skeleton insertion."

Codex adds the second axis (polluted baseline) that Gemini missed. This is materially important because Gemini's fix (b — pure CSS) does NOT address the skeleton-pollution axis; only Codex's (c — pre-skeleton capture) does.

### 6.4 AC21 fix recommendation

**DIVERGENT**.
- Gemini (b): Remove JS restore + rely on CSS `overflow-anchor:auto`. "Delete the 4 loadMore tests."
- Codex (c): Capture in `onLoadMore` callback before skeletons. "Update all 4 loadMore tests."

Recommendation sides with **Codex (c)**. Gemini's pure-CSS fix is unreliable when the placeholder (skeleton) unmounts at the same frame as the real content arrives, because the anchor element selection algorithm cannot guarantee it picks a stable post-mount entry. Browser support for `overflow-anchor` also varies (Safari only enabled in iOS 17+ as `overflow-anchor: none` was the historical iOS default for the past decade).

### 6.5 Unified design

**DIVERGENT, but compatible**.
- Gemini: Eliminate Effects 4+5; use `scrollIntoView` + native `overflow-anchor`. Simpler topology but uses untested-on-iOS browser features as the load-bearing primitive.
- Codex: One scroll state machine; share bottom-lock observer between hydration + append; capture-on-callback for prepend; JS owns restoration unambiguously.

Recommendation: **Codex's state-machine architecture**, with one borrowing from Gemini: **set `overflow-anchor: none` explicitly on the container** so the JS path is unambiguously the source of truth (no race with browser native anchor for the prepend path).

### 6.6 Meta-lesson

**ALIGNED** — both diagnose imperative-JS-fighting-the-browser as the core anti-pattern; both flag jsdom as enabling false confidence.
- Gemini: "fighting the browser's layout engine with brittle JavaScript arithmetic instead of leveraging modern, built-in browser solutions."
- Codex: "optimized **effect timing** instead of defining **scroll ownership and lifecycle**."

---

## 7. Recommended unified solution

### 7.1 Architecture (pseudo-code)

```
TranscriptFeed receives onLoadMore from parent.

Refs:
  feedRef                — container DOM ref
  wasNearBottomRef       — bool, updated by scroll listener (unchanged)
  prevEntriesLengthRef   — number, last entries.length (unchanged)
  hasScrolledToBottomOnHydrationRef — bool guard (unchanged)
  scrollLockRef          — discriminated union, ONE of:
    { mode: 'idle' }
    { mode: 'bottom-lock', deadline: timestamp, observer: ResizeObserver }
    { mode: 'prepending', prevScrollHeight: number, prevScrollTop: number }

Container style:
  overflow-anchor: none  (explicit — JS owns restoration)

Wrapper for onLoadMore (passed to HistoryLoadMoreSentinel):
  handleLoadMore = () => {
    container = feedRef.current
    scrollLockRef.current = {
      mode: 'prepending',
      prevScrollHeight: container.scrollHeight,
      prevScrollTop: container.scrollTop,
    }
    props.onLoadMore()  // triggers setIsLoadingMore(true) in parent → skeletons appear
  }

Effect A (scroll listener — unchanged from current Effect 0):
  on scroll → wasNearBottomRef.current = nearBottom(...)

Effect B (unified hydration + append bottom-lock):
  deps: [entries.length]

  detect mutation type:
    if entries.length === 0: return
    if !hasScrolledToBottomOnHydrationRef.current:
      // hydration path
      hasScrolledToBottomOnHydrationRef.current = true
      scrollTo({top: scrollHeight, behavior: 'instant'})
      startBottomLock(deadline = now + 1500ms)
      return
    if entries.length > prevEntriesLengthRef.current and wasNearBottomRef.current:
      // append path
      scrollTo({top: scrollHeight, behavior: 'smooth'})
      startBottomLock(deadline = now + 1500ms)
    if entries.length > prevEntriesLengthRef.current and !wasNearBottomRef.current:
      // user scrolled up; do not scroll
      pass
    prevEntriesLengthRef.current = entries.length

  startBottomLock(deadline):
    if scrollLockRef.current.mode === 'bottom-lock':
      scrollLockRef.current.deadline = max(current.deadline, deadline)  // extend
      return
    observer = new ResizeObserver(() => {
      if scrollLockRef.current.mode !== 'bottom-lock': return
      if Date.now() > scrollLockRef.current.deadline:
        observer.disconnect()
        scrollLockRef.current = { mode: 'idle' }
        return
      scrollTo({top: scrollHeight, behavior: 'instant'})
    })
    observer.observe(feedRef.current)
    scrollLockRef.current = { mode: 'bottom-lock', deadline, observer }

Effect C (loadMore restore — useLayoutEffect, deps [isLoadingMore]):
  if isLoadingMore: return
  if scrollLockRef.current.mode !== 'prepending': return
  prev = scrollLockRef.current
  container = feedRef.current
  delta = container.scrollHeight - prev.prevScrollHeight
  if delta > 0:
    container.scrollTop = prev.prevScrollTop + delta
  scrollLockRef.current = { mode: 'idle' }

Effect D (unmount — unchanged from current Effect 2):
  return () => {
    if scrollLockRef.current.mode === 'bottom-lock':
      scrollLockRef.current.observer.disconnect()
    scrollLockRef.current = { mode: 'idle' }
    hasScrolledToBottomOnHydrationRef.current = false
  }
```

Effect count: **4 effects** (down from 6). One unified mutation effect (B) replaces Effects 1+3. One unified restore (C) replaces Effects 4+5 in concept (capture moves out of effects into `handleLoadMore` callback).

### 7.2 Edge-case matrix

| Scenario | Effect A (scroll) | Effect B (hydration+append) | Effect C (loadMore restore) | Outcome |
|----------|-------------------|------------------------------|-------------------------------|---------|
| (a) Initial mount | listener attaches | hydration branch fires + bottom-lock 1500 ms | idle | Lands at bottom; AC19 ✅ |
| (b) Async hydration ([] → [N]) | tracks user | hydration branch fires + bottom-lock 1500 ms | idle | Lands at bottom; AC19 ✅ |
| (c) Session append at bottom | wasNearBottom=true | append branch: smooth + bottom-lock 1500 ms; observer catches shimmer→card growth | idle | Card fully visible; **AC20-A ✅** |
| (d) Session append scrolled-up | wasNearBottom=false | append branch early-return (no scroll, no lock) | idle | User position preserved; AC20-B ✅ |
| (e) loadMore prepend | tracks user | append branch: entries grew at front but wasNearBottom=false → no scroll, no lock | restore from `handleLoadMore`-captured baseline (correct) | Anchor preserved; **AC21 ✅** |
| (f) clear-all then search | tracks user | hydration ref-locked → goes through append path with wasNearBottomRef value | idle | Same as (c) |
| (g) Strict Mode mount→cleanup→mount | listener re-attaches | hydration ref reset by Effect D cleanup → re-fires on remount | idle | Dev parity with prod ✅ |
| (h) loadMore + session append within bottom-lock window | tracks user | append fires; lock may overlap with prepending mode | restore runs after; lock idle | Discriminated union prevents conflict — only one mode at a time |
| (i) Late shimmer→card growth >1500 ms post-append | tracks user | bottom-lock timed out; no re-scroll | idle | Card may land partially off — escalate window if operator surfaces (FU like FU3 for hydration) |

### 7.3 Test surgery estimate (file-by-file)

`packages/web/src/__tests__/components/TranscriptFeed.test.tsx` (current 996 lines):
- AC10 (mount): `scrollToMock.mock.calls.length === 1` assertion may need updating to `≥ 1` if bottom-lock observer fires. **Update: 1**.
- AC10b (async hydration): same. **Update: 1**.
- AC10c (loadMore prepend): The `feed.scrollTop === 600` assertion may now be checked against the `handleLoadMore`-captured baseline. **Update: 1**.
- AC11 (regression coexistence): Still asserts `behavior:'smooth'` once — likely still passes. **Update: 0-1**.
- AC12 (scrolled-up, no scroll): unchanged. **Update: 0**.
- AC13 (hydration behavior:'instant' on LAST call): now also has bottom-lock 'instant' re-fires — the "last call" assertion still holds. **Update: 0**.
- Step 4 AC8/AC9/AC10/AC11 (append wasNearBottomRef tests): all assert one `behavior:'smooth'` call; with bottom-lock added, smooth still fires first. **Update: 0-2**.
- Step 5 AC12/AC13b/AC13c (coexistence + cleanup): Existing observer disconnect tests need to be generalized to "bottom-lock observer" not just "hydration observer". **Update: 2**.
- Step 3 AC1-AC6 (ResizeObserver hydration): generalize naming to "bottom-lock observer (hydration path)" — semantically same. **Update: 0-3** (rename only).

`packages/web/src/__tests__/components/TranscriptFeed.edge-cases.test.tsx` (current 414 lines):
- EC-DELETE-1 / EC-DELETE-2: deletion path unchanged. **Update: 0**.
- EC-CLEAR-1 / EC-CLEAR-2: ref-guard semantics unchanged. **Update: 0**.
- EC-SCROLL-DURING-WINDOW-1: window window concept generalizes. **Update: 0-1**.
- EC-RAPID-1: rapid loadMore+append within hydration window — now needs to assert both modes coexist (prepending state machine). **Update: 1**.

`packages/web/src/components/HistoryLoadMoreSentinel.tsx`: unchanged.

`packages/web/src/components/TranscriptFeed.tsx`: full refactor.

**New tests to add (~4-6)**:
- "Append + late content growth: card fully visible after settle" (jsdom-limited; mock ResizeObserver fire after smooth scrollTo).
- "Prepend capture occurs synchronously in handleLoadMore, before isLoadingMore=true commit" (assert refs set BEFORE rerender with isLoadingMore=true).
- "Prepend with batched older + skeleton-removal commits preserves anchor" (use FU2 race-aware pattern from bugs.md:48 to model 2 commits).
- "Concurrent append + prepend transitions: state machine prevents conflict" (set prepending mode, then trigger append — assert append doesn't clobber prepend baseline).

**Total estimate**:
- TranscriptFeed.test.tsx: **5-8 updates** (mostly count assertions + naming).
- edge-cases.test.tsx: **1-2 updates**.
- New tests: **4-6 additions**.
- Net: ~13-16 total test touches. Acceptable surgery.

### 7.4 Fallback path for older browsers

- ResizeObserver: supported everywhere since Safari 13.1 (2020); existing fallback in `TranscriptFeed.tsx:127` already handles `typeof ResizeObserver === 'undefined'` → instant scroll, no observer. Generalizes to bottom-lock.
- `overflow-anchor: none`: setting it works on all browsers (browsers that don't recognize it default to `auto`, which doesn't conflict because we own restoration via JS regardless). Safe to set unconditionally.
- `scrollTo({behavior:'instant'})`: native since 2023 (Safari 15.4+). Older Safari falls back to instant default. Wrapped in try/catch already.

### 7.5 Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Bottom-lock observer over-corrects when user scrolls during the window | M | M | Bottom-lock auto-cancels if `wasNearBottomRef` flips to false during the window (add guard inside ResizeObserver callback) |
| R2 | State machine conflict if loadMore and append happen rapidly | L | H | Discriminated union `mode` enforces single-state-at-a-time; assert + log if mode transition is illegal |
| R3 | 1500 ms append window not long enough for slow networks (3G + cold font cache) | M | M | Extend deadline if the in-flight pending entry's `isLoading=false` transition arrives after 1500 ms (re-arm window with shorter timer for "card-just-settled" follow-up) |
| R4 | `overflow-anchor: none` removes a safety net for any future DOM mutations we don't currently model | L | M | Document the explicit `overflow-anchor:none` in the container className with rationale link to this research doc |
| R5 | jsdom cannot validate the state machine's correctness end-to-end | H | M | Add Playwright e2e coverage for AC20-A + AC21 (operator ACs become automated). MUST happen in same FU as the code change. |
| R6 | Pre-existing 771 tests pass green but the operator still sees a bug (Strict-Mode-style false positive) | L | H | Spec includes explicit operator AC with frame-by-frame description + screenshot expectations |

---

## 8. Alternative solutions considered & rejected

### Alt 1: Gemini's pure-declarative path (`scrollIntoView` + native `overflow-anchor`)
- **Why rejected**: `scrollIntoView({block:'end'})` does not respect inner-padding bottom (the 144 px input-bar clearance). The element's bottom would align to the container's bottom edge → still hidden behind the input bar. Could be salvaged with `scrollIntoView({block:'end', inline:'nearest'}) + scrollMarginBottom` CSS, but that creates a hidden coupling between the entry's CSS and the input bar's height — fragile. Native `overflow-anchor:auto` for prepend is also unreliable when skeletons unmount in the same frame (anchor selection algorithm may choose a skeleton).

### Alt 2: Switch to a virtualized list (react-window / react-virtuoso)
- **Why rejected**: Overkill. Operator has ≤200 entries persisted; perf is not the concern. Adds a heavy dep, fights React Server Component boundary, and replaces a layout problem with an even harder "virtualized list + scroll anchoring" problem. Virtuoso has its own `followOutput` / `firstItemIndex` props for the exact AC21 use case, but onboarding cost exceeds the win.

### Alt 3: Render skeletons WHERE the prepended entries will land (not in sentinel slot)
- **Why rejected**: This requires the sentinel component to know how many older entries will arrive, which it doesn't. Predicting page size (10) is a brittle coupling. Worse, the skeleton heights would still mismatch the real card heights post-settle, so the prepend baseline is still polluted (just by a different value).

### Alt 4: Defer prepend commit until after fetch (no skeletons during loading)
- **Why rejected**: User loses feedback that loading is happening. Sentinel currently shows skeletons specifically for accessibility (`aria-busy="true"` in HistoryLoadMoreSentinel.tsx:57). Removing that regresses W18 UX guidelines.

---

## 9. Next SDD cycle scope

### 9.1 Recommended Spec scope

**Feature name**: `F-WEB-HISTORY-FU4-scroll-state-machine` (or, if the owner prefers, fold into `F-WEB-HISTORY-FU4-scroll-architecture-refactor`).

**Scope**:
1. Refactor TranscriptFeed.tsx to the 4-effect state machine in §7.1.
2. Move loadMore capture from Effect 4 → `handleLoadMore` callback (pre-skeleton).
3. Add bottom-lock observer parallel to hydration observer (share infrastructure).
4. Set `overflow-anchor: none` explicitly on the scroll container.
5. Re-key Effect B detection so it identifies "append" (length grew at end) vs "prepend" (length grew at front) using a comparison of first/last entryId, not entries.length alone.
6. Add Playwright e2e tests for AC20-A and AC21 (the FIRST e2e tests for this component).
7. Update unit tests per §7.3.
8. Update ui-components.md spec to describe the state machine.

**Cross-model rounds**: **MANDATORY** for this scope.
- `/review-spec`: Gemini + Codex. Specifically ask each to challenge the state-machine transitions, the 1500 ms window choice, the `overflow-anchor:none` decision, and whether to include Playwright coverage in scope.
- `/review-plan`: Gemini + Codex. Specifically ask each to validate the test surgery count and find edge cases the matrix in §7.2 missed.
- `code-review-specialist` after implementation. NO MAJOR deferrals this time (the precedent from FU2 MAJOR-2 deferral cost us FU3 + this analysis).

### 9.2 Complexity tier

**STANDARD** (not Simple, not Complex).

Rationale:
- **Not Simple**: touches 3+ files (TranscriptFeed.tsx + 2 test files + spec doc + new playwright config + HistoryLoadMoreSentinel if we pass `handleLoadMore` from feed instead of directly from HablarShell), and introduces a state machine that needs its own invariant tests.
- **Not Complex**: the mechanics are well-understood (ResizeObserver + scroll geometry + state machine — none are novel patterns); no cross-team / cross-package concerns; no infrastructure changes (no new shared utilities); behavior is observable via Playwright.

### 9.3 Estimated effort

- Spec + `/review-spec` cross-model: ~1.5 hours.
- Implementation: ~2 hours.
- Unit test updates + new tests: ~2 hours.
- Playwright setup (first time for this feature, assume harness exists in repo) + 2 e2e tests: ~2 hours.
- `/review-plan` cross-model + code-review + fix-loop: ~1.5 hours.
- Total: **~9 hours** (~1 work day).

### 9.4 Definition-of-done additions vs prior FUs

- AC19 + AC20-A + AC20-B + AC21 ALL pass operator-browser smoke ON THE SAME PR before merge (no deferrals).
- Playwright e2e tests for AC20-A + AC21 run in CI on every PR.
- ADR or research-doc link in the Spec referencing the `overflow-anchor:none` rationale.
- Memory entry `feedback_layout_effect_phase_swap_needs_full_review` saved post-merge (see §5.4).

---

> **Closing note 2026-06-06:** This research doc documented the FU4-era 4-effect state machine design. Per `F-WEB-HISTORY-FU6` (architectural rewrite to `react-virtuoso`), the manual approach has been superseded. The definitive resolution is in `docs/tickets/F-WEB-HISTORY-FU6-virtuoso-rewrite.md`.
