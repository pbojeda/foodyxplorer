# F093: Web Assistant — Landing Integration + Analytics

**Feature:** F093 | **Type:** Frontend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F093-landing-web-integration
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-08 | **Dependencies:** F090 (web assistant /hablar), F112 (web usage metrics), F060 (GA4 landing integration)

---

## Spec

### Description

F093 connects the marketing landing page (`packages/landing/`) to the web assistant (`packages/web/`). Currently there are no navigation paths from the landing to `/hablar`. Users who click "Probar gratis" in the header are scrolled to the waitlist form.

F093 adds three CTA entry points in the landing that direct users to the web assistant, tracks analytics events for the cross-domain transition in both packages, and introduces GA4 to the web package for cross-domain measurement continuity. The waitlist flow is left untouched — the new CTAs are supplementary, not replacements.

**Cross-domain constraint:** Landing (`nutrixplorer.com`) and web (`packages/web/`) are separate Vercel projects. All links from landing to web must use absolute external URLs, not Next.js `<Link>` components. The web URL is configurable per environment via `NEXT_PUBLIC_WEB_URL`.

**Graceful degradation principle:** When `NEXT_PUBLIC_WEB_URL` is unset (e.g., in a preview branch not yet wired to a web deployment), all three CTAs silently fall back to `#waitlist`. No error is thrown; no broken link is exposed.

---

### Architecture Decisions

- **No shared header/footer** between landing and web — out of scope; deferred to future feature.
- **No Vercel rewrites or custom domain setup** — infrastructure work handled separately.
- **No consent banner in web** — the web assistant is a functional tool, not a marketing surface. GA4 fires unconditionally when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set.
- **No PII in any analytics event** — queries sent to `/hablar` are NOT included in `hablar_query_sent`.
- **Same GA Measurement ID** in both packages — enables UTM-based campaign attribution across landing and web. This is NOT true cross-domain session linking (no GA4 linker configuration). The goal is funnel-level analytics (how many landing visitors try /hablar), not user-level session continuity.
- **SiteHeader stays a Server Component** — but the desktop CTA with `onClick` analytics handler must be extracted into a thin Client Component (`HeaderCTA.tsx`). SiteHeader resolves the URL and passes it down.
- **MobileMenu** — already a Client Component. Receives `ctaHref` and `variant` as props from SiteHeader for analytics events.
- **UTM params per component** — `page.tsx` passes only the base URL (`NEXT_PUBLIC_WEB_URL + '/hablar'`). Each component appends its own `utm_source=landing&utm_medium=<placement>` to avoid cross-contamination.
- **Cross-domain analytics** — F093 uses UTM parameter attribution only (not true GA4 cross-domain session linking). The same GA Measurement ID in both packages enables campaign-level funnel analysis, not user-level session continuity.
- **Trailing slash normalization** — `NEXT_PUBLIC_WEB_URL` must be stripped of trailing slashes before use to avoid `//hablar` paths.

---

### File Structure

**Landing — modified files:**

```
packages/landing/
├── src/
│   ├── components/
│   │   ├── SiteHeader.tsx              — Passes hablarBaseUrl + variant; renders HeaderCTA
│   │   ├── HeaderCTA.tsx               — NEW Client Component: desktop CTA with onClick analytics
│   │   ├── MobileMenu.tsx              — New props: ctaHref + variant
│   │   └── sections/
│   │       └── WaitlistCTASection.tsx  — New "O pruébalo ahora gratis →" link below form
│   ├── types/index.ts                  — New AnalyticsEventName values
│   └── app/
│       └── page.tsx                    — Pass hablarUrl to HeroSection (Variant A)
├── .env.local.example                  — New: NEXT_PUBLIC_WEB_URL
```

**Note on HeroSection:** Variant A has a hero form. The "Pruébalo ahora" secondary CTA is added inside `HeroSection` for Variant A only. HeroSection already accepts `variant` and `dict` props — a new `hablarUrl` prop is added.

**Web — modified files:**

```
packages/web/
├── src/
│   └── app/
│       ├── layout.tsx                  — New: conditional GA4 script block
│       └── hablar/
│           └── page.tsx                — New: GA4 page_view + UTM param capture on mount
├── .env.local.example                  — New: NEXT_PUBLIC_GA_MEASUREMENT_ID
```

---

### Environment Variables

**`packages/landing/.env.local.example` — new entry:**

```
# Base URL of the web assistant (e.g., https://hablar.nutrixplorer.com).
# When unset, header/hero/bottom CTAs fall back to #waitlist anchor.
NEXT_PUBLIC_WEB_URL=
```

**`packages/web/.env.local.example` — new entry:**

```
# GA4 Measurement ID — same property as landing, enables cross-domain funnel.
# When unset, GA4 is disabled silently.
NEXT_PUBLIC_GA_MEASUREMENT_ID=
```

---

### Component Changes

#### SiteHeader (landing) — modified

**Type:** Layout | **Client:** No (Server Component — stays server)

**New props:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarBaseUrl | `string \| null` | Yes | — | Base web URL or null when unconfigured |
| variant | `string` | Yes | — | Current A/B variant for analytics |

**Change:** SiteHeader resolves the desktop CTA href and extracts the onClick analytics into a new thin Client Component `HeaderCTA`. SiteHeader remains a Server Component.

**Desktop CTA:** Replace the inline `<a href="#waitlist">` with `<HeaderCTA hablarBaseUrl={hablarBaseUrl} variant={variant} />`. The `HeaderCTA` Client Component:
- Builds `href` from `hablarBaseUrl + '?utm_source=landing&utm_medium=header_cta'` or falls back to `#waitlist`
- Adds `target="_blank" rel="noopener noreferrer"` when URL is external
- Fires `cta_hablar_click` on `onClick` (before navigation, which opens a new tab)
- Styling unchanged: `rounded-full bg-botanical px-4 py-2 text-sm font-semibold text-white`

**MobileMenu prop change:**
- SiteHeader passes `ctaHref` (resolved URL with header_cta UTM) and `variant` to `<MobileMenu>`

---

#### MobileMenu (landing) — modified

**Type:** Feature | **Client:** Yes (`'use client'` — no change)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| ctaHref | `string` | Yes | — | Resolved URL for the mobile CTA button (may be `#waitlist` or external URL) |
| variant | `string` | Yes | — | Current A/B variant for analytics event |

**Change:** The hardcoded `href="#waitlist"` on the mobile CTA `<a>` is replaced with `ctaHref` from props. `target` and `rel` attributes are set conditionally: if `ctaHref.startsWith('http')` then `target="_blank" rel="noopener noreferrer"`, else omitted. On click, fires `cta_hablar_click` with `source: 'header'` and the received `variant`.

**Existing props unchanged:** `navLinks`, `ctaText`, `mobileCta`.

---

#### HeroSection (landing) — modified (Variant A only)

**Type:** Feature | **Client:** Yes (`'use client'` — no change)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Resolved web assistant URL. When absent or `#waitlist`, CTA is not rendered. |

**Change:** For Variant A only, render a secondary "Pruébalo ahora" `<a>` below the `<WaitlistForm>`. This CTA is only rendered when `hablarUrl` is a non-`#waitlist` value (i.e., web URL is configured). Variants C and F do not receive this prop and are not modified.

**New element (Variant A, below WaitlistForm):**

```
<a href={hablarUrl} target="_blank" rel="noopener noreferrer"
   data-cta-source="hero" onClick={handleHeroCTAClick}>
  Pruébalo ahora →
</a>
```

**Style:** `text-sm font-medium text-botanical underline underline-offset-2 hover:text-botanical/80` — subtle, secondary to the waitlist form.

**Interaction:** `onClick` fires `cta_hablar_click` event (see Analytics Events section).

---

#### WaitlistCTASection (landing) — modified

**Type:** Feature | **Client:** Yes (`'use client'` — no change)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Resolved web assistant URL. When absent or `#waitlist`, link is not rendered. |

**Change:** Below the social proof counter and above the trust note, add a subtle text link. Only rendered when `hablarUrl` is a non-`#waitlist` value.

**New element (below social proof counter):**

```
<a href={hablarUrl} target="_blank" rel="noopener noreferrer"
   data-cta-source="bottom" onClick={handleBottomCTAClick}>
  O pruébalo ahora gratis →
</a>
```

**Style:** `text-sm text-botanical hover:underline` — intentionally subtle. Must not compete visually with the waitlist form.

**Interaction:** `onClick` fires `cta_hablar_click` event.

---

#### LandingPage / page.tsx (landing) — modified

**Change:** Resolve base `hablarUrl` at the Server Component level (no UTM params — each component appends its own):

```
const rawUrl = process.env['NEXT_PUBLIC_WEB_URL'] ?? '';
const hablarBaseUrl: string | null = rawUrl
  ? rawUrl.replace(/\/+$/, '') + '/hablar'
  : null;
```

Pass `hablarBaseUrl` (or `null` when unset) to components:
- `<SiteHeader hablarBaseUrl={hablarBaseUrl} variant={variant} />`
- `<HeroSection hablarUrl={hablarBaseUrl} variant={variant} />` — only for Variant A
- `<WaitlistCTASection hablarUrl={hablarBaseUrl} variant={variant} />` — all variants

Each component appends its own UTM params:

| Component | `utm_medium` | Result URL |
|-----------|-------------|------------|
| HeaderCTA (SiteHeader) | `header_cta` | `/hablar?utm_source=landing&utm_medium=header_cta` |
| HeroSection | `hero_cta` | `/hablar?utm_source=landing&utm_medium=hero_cta` |
| WaitlistCTASection | `bottom_cta` | `/hablar?utm_source=landing&utm_medium=bottom_cta` |

Helper function `buildHablarUrl(baseUrl: string, source: string): string` shared across components (or inline — each component appends `?utm_source=landing&utm_medium=${source}`).

---

#### RootLayout / layout.tsx (web) — modified

**Type:** Layout | **Client:** No (Server Component — no change)

**Change:** Add a conditional GA4 script block using Next.js `<Script>` component. Only rendered when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set.

**Implementation:** Use `next/script` with `strategy="afterInteractive"` (avoids hydration warnings from raw `<script>` tags):

```tsx
import Script from 'next/script';
const GA_ID = process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'];

// In layout JSX, conditionally render:
{GA_ID && (
  <>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
    <Script id="gtag-init" strategy="afterInteractive">
      {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false});`}
    </Script>
  </>
)}
```

`send_page_view: false` — page views are fired manually per route to include UTM params.

**GA4 readiness for first-load events:** Since gtag.js loads async, `window.gtag` may not exist when `useEffect` runs on first mount. The `dataLayer.push` pattern is used as fallback: events pushed to `window.dataLayer` before gtag loads are automatically replayed once it initializes. `HablarAnalytics` uses `window.dataLayer.push` instead of `window.gtag` directly.

No consent banner. The web assistant is a functional tool; analytics is operational.

---

#### HablarPage / hablar/page.tsx (web) — modified

**Type:** Page | **Client:** Partial — the existing `HablarShell` is already `'use client'`. The page component itself may remain Server, but UTM capture and GA4 event firing require client-side execution.

**Change:** Create a `HablarAnalytics` Client Component mounted inside `hablar/page.tsx`:
1. Uses `useSearchParams()` (Next.js App Router) to read UTM params reliably
2. Fires `hablar_page_view` via `window.dataLayer.push` on mount (not `window.gtag` — dataLayer queue guarantees delivery even if gtag hasn't loaded yet)

The existing `HablarShell` component is the correct place to hook GA4 `hablar_query_sent` since it already has the query submission handler. Add a `window.dataLayer?.push` call inside the existing submit callback — no new props needed.

**`HablarAnalytics` component:**
```tsx
'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export function HablarAnalytics() {
  const params = useSearchParams();
  useEffect(() => {
    (window.dataLayer = window.dataLayer || []).push({
      event: 'hablar_page_view',
      utm_source: params.get('utm_source') ?? undefined,
      utm_medium: params.get('utm_medium') ?? undefined,
      utm_campaign: params.get('utm_campaign') ?? undefined,
    });
  }, [params]);
  return null;
}
```

---

### Analytics Events

#### Landing — GA4 (new events, landing package)

All events use the existing `trackEvent()` from `packages/landing/src/lib/analytics.ts`. All are subject to the existing consent check (`window.__nxConsentDenied`).

**New `AnalyticsEventName` values (add to `packages/landing/src/types/index.ts`):**

| Event Name | Trigger | Parameters |
|---|---|---|
| `cta_hablar_click` | User clicks any of the 3 landing → web CTAs | `source: 'header' \| 'hero' \| 'bottom'`, `variant: Variant`, `utm_medium: string` |

Note: `hablar_url_configured` (mentioned in requirements) is dropped from the spec. It adds operational noise and the same signal can be derived from `cta_hablar_click` impressions. A misconfigured URL is caught in CI via smoke test, not analytics.

**Event payload shape for `cta_hablar_click`:**

```typescript
trackEvent({
  event: 'cta_hablar_click',
  variant,          // current A/B variant
  lang: 'es',
  source,           // 'header' | 'hero' | 'bottom'
  utm_medium,       // 'header_cta' | 'hero_cta' | 'bottom_cta'
})
```

**Firing timing:** Events fire in the `onClick` handler BEFORE navigation. Because the CTA opens in a new tab (`target="_blank"`), there is no risk of the navigation cancelling the event — the current tab remains open and the event completes normally.

#### Web — GA4 (new events, web package)

These fire via `window.dataLayer.push` (queued for GA4 replay — no shared analytics module in the web package, keep it simple).

| Event Name | Trigger | Parameters |
|---|---|---|
| `hablar_page_view` | `/hablar` route mounts (client-side) | `utm_source`, `utm_medium`, `utm_campaign` (from URL, if present) |
| `hablar_query_sent` | User submits a query in HablarShell | _(none — no PII, no query text)_ |

**`hablar_page_view` implementation note:** Fires in `HablarAnalytics` useEffect on mount. Reads UTM params via `useSearchParams()`. Uses `(window.dataLayer = window.dataLayer || []).push(...)` pattern for guaranteed delivery.

**`hablar_query_sent` implementation note:** Fires inside the existing submit handler in `HablarShell`. Uses `(window.dataLayer = window.dataLayer || []).push(...)` pattern. No query text, no user identifiers.

---

### Types Changes (landing)

**`packages/landing/src/types/index.ts` — add to `AnalyticsEventName` union:**

```typescript
| 'cta_hablar_click'
```

---

### Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| `NEXT_PUBLIC_WEB_URL` unset in landing | Header CTA (desktop + mobile) falls back to `href="#waitlist"`. Hero and Bottom supplementary CTAs are NOT rendered (they only appear when web URL is configured). No analytics event fired on fallback clicks. |
| `NEXT_PUBLIC_WEB_URL` set but web app is down | Link navigates to dead page. Landing is unaffected. No fallback — this is a deployment concern, not a frontend concern. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` unset in web | GA4 script block not injected. `window.gtag` undefined. Both `hablar_page_view` and `hablar_query_sent` are silently skipped. |
| Consent denied in landing (cookie banner) | `window.__nxConsentDenied = true`. `trackEvent()` returns early. `cta_hablar_click` is NOT sent to GA4. |
| User opens `/hablar` directly (no UTM params) | `hablar_page_view` fires with no UTM parameters — just the event name. GA4 handles missing dimensions gracefully. |
| Mobile CTA in MobileMenu | Uses same `hablarUrl` resolution. `target="_blank"` when URL is external. Closes menu on click (existing `onClick={close}` behavior preserved alongside the analytics handler). |
| Variant C and F hero sections | No "Pruébalo ahora" secondary CTA — only Variant A receives the `hablarUrl` prop in the hero. WaitlistCTASection bottom link applies to all variants. |
| `utm_source=landing` collides with other traffic sources | UTM params are only appended to CTA hrefs built in this feature. Organic landing navigation is unaffected. |
| `NEXT_PUBLIC_WEB_URL` has trailing slash | Stripped with `.replace(/\/+$/, '')` before building URL — prevents `//hablar` paths. |

---

### Acceptance Criteria

1. **Header CTA (desktop):** When `NEXT_PUBLIC_WEB_URL` is set, clicking "Probar gratis" opens `/hablar?utm_source=landing&utm_medium=header_cta` in a new tab.
2. **Header CTA (mobile):** When `NEXT_PUBLIC_WEB_URL` is set, clicking "Probar" in the mobile menu opens the same URL in a new tab and closes the menu.
3. **Hero CTA (Variant A only):** A secondary "Pruébalo ahora →" link appears below the waitlist form. It does not appear in Variants C or F. It is not rendered when `NEXT_PUBLIC_WEB_URL` is unset.
4. **Bottom CTA (all variants):** An "O pruébalo ahora gratis →" link appears in `WaitlistCTASection` below the social proof counter. It is not rendered when `NEXT_PUBLIC_WEB_URL` is unset.
5. **Fallback:** When `NEXT_PUBLIC_WEB_URL` is unset, the header CTA (desktop + mobile) renders with `href="#waitlist"`. The Hero and Bottom supplementary CTAs are not rendered. No broken links, no errors.
6. **Analytics — landing:** Clicking any of the three CTAs fires `cta_hablar_click` with correct `source` and `utm_medium`. Event is NOT sent when consent is denied.
7. **Analytics — web page view:** Loading `/hablar` fires `hablar_page_view` via `window.dataLayer.push` (queued for GA4 replay). UTM params from the URL are included in the event payload when present.
8. **Analytics — web query:** Each query submission fires `hablar_query_sent` with no query text or PII.
9. **GA4 script in web:** When `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set, the `gtag.js` script is injected in the web layout. When unset, no script is injected and no JS errors occur.
10. **No change to waitlist flow:** `WaitlistForm` submission, success, error, and phone auto-fill behaviors are unchanged.
11. **No UI change to web assistant:** `HablarShell` visual layout is unchanged. Only analytics events are added.
12. **TypeScript strict:** No new `any` types. `AnalyticsEventName` union updated. All new props are typed.

---

## Notes

- `hablar_url_configured` analytics event was considered and dropped. Deployment verification belongs in CI (smoke test against env-specific URL), not in runtime analytics.
- The Hero CTA for Variant A uses a text-link style (`underline`, `text-botanical`) deliberately — it must be visually subordinate to the waitlist form, which is the primary conversion action for the marketing site.
- The Bottom CTA in `WaitlistCTASection` uses the same text-link style for the same reason.
- Only the header CTA uses the primary button style (`bg-botanical rounded-full`) since it is the primary nav action.
- F093 does not configure the web assistant's production domain or Vercel project — those steps are handled outside the codebase.
- Future: When the web assistant has its own cookie consent (if ever needed for GDPR compliance), revisit the "no consent banner" decision for the web GA4 integration.

---

## Implementation Plan

### Existing Code to Reuse

**Landing (`packages/landing/`):**
- `src/types/index.ts` — `AnalyticsEventName` union, `Variant`, `Locale`, `AnalyticsEventPayload` types
- `src/lib/analytics.ts` — `trackEvent()` function (handles consent check, gtag, event queue); reuse directly in `HeaderCTA`, `HeroSection`, `WaitlistCTASection`
- `src/components/SiteHeader.tsx` — modified in place; no new file for Server Component shell
- `src/components/MobileMenu.tsx` — modified in place; already `'use client'`, already has `close` callback pattern
- `src/components/sections/HeroSection.tsx` — modified in place; already `'use client'`, already has `variant` and `dict` props; add `hablarUrl` prop to `HeroSection` and thread into `HeroVariantA` only
- `src/components/sections/WaitlistCTASection.tsx` — modified in place; already `'use client'`
- `src/app/page.tsx` — modified in place; already resolves `process.env` at server level, already passes props to `SiteHeader` and section components
- `src/__tests__/SiteHeader.test.tsx` — extended (not replaced)
- `src/__tests__/MobileMenu.test.tsx` — extended (not replaced)
- `src/__tests__/sections/WaitlistCTASection.test.tsx` — extended (not replaced)
- `src/__tests__/sections/HeroSection.test.tsx` — extended (not replaced)

**Web (`packages/web/`):**
- `src/app/layout.tsx` — modified in place; already a Server Component, already imports from `next/font`
- `src/app/hablar/page.tsx` — modified in place; already imports `HablarShell`
- `src/components/HablarShell.tsx` — modified in place; already `'use client'`, already has `executeQuery`/`handleSubmit` callback pattern; add `window.dataLayer?.push` call inside `handleSubmit`
- `src/__tests__/components/HablarShell.test.tsx` — extended (not replaced)

---

### Files to Create

```
packages/landing/src/components/HeaderCTA.tsx
  — New 'use client' thin component. Receives hablarBaseUrl + variant,
    builds UTM href, renders the desktop <a> CTA with onClick analytics.

packages/landing/src/__tests__/HeaderCTA.test.tsx
  — Unit tests for HeaderCTA: href construction, fallback to #waitlist,
    target/_blank attrs, analytics event fired on click.

packages/landing/src/__tests__/edge-cases.f093.test.tsx
  — Integration-level edge cases: URL unset → no hero/bottom CTA rendered,
    header falls back to #waitlist, consent denied → trackEvent not called,
    trailing slash stripping, variant C/F don't receive hablarUrl in hero.

packages/web/src/components/HablarAnalytics.tsx
  — New 'use client' analytics sentinel. Uses useSearchParams + useEffect
    to push hablar_page_view to window.dataLayer on mount. Returns null.

packages/web/src/__tests__/components/HablarAnalytics.test.tsx
  — Unit tests: fires hablar_page_view on mount, includes utm_source/medium
    when present in URL params, fires with no UTM params when absent,
    does not throw when window.dataLayer is undefined.
```

---

### Files to Modify

```
packages/landing/src/types/index.ts
  — Add 'cta_hablar_click' to AnalyticsEventName union.

packages/landing/src/components/SiteHeader.tsx
  — Add hablarBaseUrl: string | null and variant: Variant props.
    Remove inline <a href="#waitlist"> desktop CTA.
    Render <HeaderCTA hablarBaseUrl={hablarBaseUrl} variant={variant} />.
    Pass ctaHref (with header_cta UTM) and variant to <MobileMenu>.

packages/landing/src/components/MobileMenu.tsx
  — Add ctaHref: string and variant: Variant props to MobileMenuProps.
    Replace hardcoded href="#waitlist" on mobile CTA <a> with ctaHref.
    Add conditional target="_blank" rel="noopener noreferrer" when ctaHref.startsWith('http').
    Add onClick handler that calls trackEvent('cta_hablar_click', source='header') then close(). Guard: only fire trackEvent when `ctaHref.startsWith('http')` — no analytics on `#waitlist` fallback clicks.

packages/landing/src/components/sections/HeroSection.tsx
  — Add hablarUrl?: string prop to HeroSectionProps.
    Thread into HeroVariantA only (not VariantC or VariantF).
    In HeroVariantA, add handleHeroCTAClick that calls trackEvent cta_hablar_click source='hero'.
    Render <a> below <WaitlistForm> only when hablarUrl is truthy and not '#waitlist'.

packages/landing/src/components/sections/WaitlistCTASection.tsx
  — Add hablarUrl?: string prop to WaitlistCTASectionProps.
    Add handleBottomCTAClick that calls trackEvent cta_hablar_click source='bottom'.
    Render <a> below social proof counter only when hablarUrl is truthy and not '#waitlist'.

packages/landing/src/app/page.tsx
  — Resolve hablarBaseUrl at server level (NEXT_PUBLIC_WEB_URL env var, strip trailing slash).
    Pass hablarBaseUrl and variant to <SiteHeader>.
    Pass hablarBaseUrl to <HeroSection> for Variant A layout only (VariantALayout).
    Pass hablarBaseUrl to <WaitlistCTASection> in all variant layouts.

packages/landing/.env.local.example
  — Add NEXT_PUBLIC_WEB_URL= entry with comment.

packages/web/src/app/layout.tsx
  — Import Script from 'next/script'.
    Read NEXT_PUBLIC_GA_MEASUREMENT_ID at server level.
    Conditionally render gtag.js <Script strategy="afterInteractive"> + init <Script>.
    Add window.dataLayer type declaration (or extend existing global Window type).

packages/web/src/app/hablar/page.tsx
  — Import HablarAnalytics.
    Wrap page in <Suspense fallback={null}> and mount <HablarAnalytics /> alongside <HablarShell>.

packages/web/src/components/HablarShell.tsx
  — Inside handleSubmit (which calls executeQuery), add window.dataLayer?.push({ event: 'hablar_query_sent' }) call after the query is dispatched (not inside the try/catch — fires immediately on submit regardless of result).

packages/web/.env.local.example
  — Add NEXT_PUBLIC_GA_MEASUREMENT_ID= entry with comment.
```

---

### Implementation Order

Follow Red-Green-Refactor for each step. Write the failing test first, then implement.

1. **`packages/landing/src/types/index.ts`**
   Add `'cta_hablar_click'` to `AnalyticsEventName`. Also add the corresponding payload shape to `AnalyticsEventPayload` (or the associated type map) with fields: `source: 'header' | 'hero' | 'bottom'`, `variant: Variant`, `lang: string`, `utm_medium: string`. No test needed — TypeScript compiler is the test; other tests will fail to compile if the type is wrong.

2. **`packages/landing/src/components/HeaderCTA.tsx`** (new file)
   Write `HeaderCTA.test.tsx` first (RED). Implement `HeaderCTA` Client Component (GREEN).
   - Props: `hablarBaseUrl: string | null`, `variant: Variant`
   - Builds `href = hablarBaseUrl + '?utm_source=landing&utm_medium=header_cta'` when non-null
   - Falls back to `href="#waitlist"` when `hablarBaseUrl` is null
   - Sets `target="_blank" rel="noopener noreferrer"` when href starts with `http`
   - `onClick` calls `trackEvent(...)` ONLY when `hablarBaseUrl` is non-null (i.e., href starts with `http`). When fallback `#waitlist` is used, no analytics event fires.
   - When firing: `trackEvent({ event: 'cta_hablar_click', source: 'header', variant, lang: 'es', utm_medium: 'header_cta' })`

3. **`packages/landing/src/components/SiteHeader.tsx`** (modified)
   Extend `SiteHeader.test.tsx` first with new prop scenarios (RED).
   - Add `hablarBaseUrl` and `variant` props
   - Replace inline `<a href="#waitlist">` with `<HeaderCTA hablarBaseUrl={hablarBaseUrl} variant={variant} />`
   - Build `ctaHref` inline: `hablarBaseUrl ? hablarBaseUrl + '?utm_source=landing&utm_medium=header_cta' : '#waitlist'`
   - Pass `ctaHref` and `variant` to `<MobileMenu>`

4. **`packages/landing/src/components/MobileMenu.tsx`** (modified)
   Extend `MobileMenu.test.tsx` first with new prop/behavior tests (RED).
   - Add `ctaHref: string` and `variant: Variant` to `MobileMenuProps`
   - Replace `href="#waitlist"` with `{ctaHref}`
   - Add conditional `target`/`rel` attrs
   - Add `onClick` that fires analytics then calls `close()`

5. **`packages/landing/src/components/sections/HeroSection.tsx`** (modified)
   Extend `HeroSection.test.tsx` first (RED).
   - Add `hablarUrl?: string` to `HeroSectionProps`
   - Thread prop into `HeroVariantA` only; `HeroVariantC` and `HeroVariantF` do NOT receive it
   - In `HeroVariantA`: render secondary `<a>` below `<WaitlistForm>` when `hablarUrl` is truthy and not `'#waitlist'`
   - `onClick` fires `trackEvent({ event: 'cta_hablar_click', source: 'hero', variant, lang: 'es', utm_medium: 'hero_cta' })`

6. **`packages/landing/src/components/sections/WaitlistCTASection.tsx`** (modified)
   Extend `WaitlistCTASection.test.tsx` first (RED).
   - Add `hablarUrl?: string` and `variant?: Variant` to `WaitlistCTASectionProps`
   - Render `<a>` below social proof counter (before trust note) when `hablarUrl` is truthy and not `'#waitlist'`
   - `onClick` fires `trackEvent({ event: 'cta_hablar_click', source: 'bottom', variant, lang: 'es', utm_medium: 'bottom_cta' })`

7. **`packages/landing/src/app/page.tsx`** (modified)
   Write `edge-cases.f093.test.tsx` for page-level behavior first (RED).
   - In `LandingPage` server component, resolve `hablarBaseUrl`:
     ```ts
     const rawUrl = process.env['NEXT_PUBLIC_WEB_URL'] ?? '';
     const hablarBaseUrl: string | null = rawUrl ? rawUrl.replace(/\/+$/, '') + '/hablar' : null;
     ```
   - Pass `hablarBaseUrl` and `variant` to `<SiteHeader>`
   - Pass `hablarBaseUrl` to `<HeroSection>` in `VariantALayout` only
   - Pass `hablarBaseUrl ?? undefined` to `<HeroSection>` and `<WaitlistCTASection>` (convert `null` → `undefined` for optional props)
   - Pass `variant` to `<WaitlistCTASection>` in all three variant layouts

8. **`packages/landing/.env.local.example`** (modified)
   Add `NEXT_PUBLIC_WEB_URL=` entry. No test needed.

9. **`packages/web/src/components/HablarAnalytics.tsx`** (new file)
   Write `HablarAnalytics.test.tsx` first (RED). Implement `HablarAnalytics` (GREEN).
   - `'use client'`
   - `useSearchParams()` to read UTM params
   - `useEffect` pushes `{ event: 'hablar_page_view', utm_source, utm_medium, utm_campaign }` to `window.dataLayer` using `(window.dataLayer = window.dataLayer || []).push(...)` pattern (NOT optional chaining — guarantees queue exists before gtag loads)
   - Returns `null`

10. **`packages/web/src/app/hablar/page.tsx`** (modified)
    Update existing page test or write targeted test (RED).
    - Import `HablarAnalytics`
    - Wrap with `<Suspense fallback={null}>` (required for `useSearchParams`)
    - Render `<HablarAnalytics />` alongside `<HablarShell />`

11. **`packages/web/src/components/HablarShell.tsx`** (modified)
    Extend `HablarShell.test.tsx` (RED).
    - Inside `handleSubmit`, immediately before calling `executeQuery`, add:
      ```ts
      (window.dataLayer = window.dataLayer || []).push({ event: 'hablar_query_sent' });
      ```
   - Use `(window.dataLayer = window.dataLayer || []).push(...)` pattern (NOT optional chaining) — guarantees the queue exists even if gtag hasn't loaded yet
    - No PII, no query text in the payload

12. **`packages/web/src/app/layout.tsx`** (modified)
    No RTL test for layout (Server Component with Script tags); rely on build check.
    - Import `Script` from `'next/script'`
    - Read `process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID']` at module level
    - Conditionally render two `<Script strategy="afterInteractive">` tags
    - Add `window.dataLayer` to the global Window type in `layout.tsx` or a dedicated `web.d.ts` type file

13. **`packages/web/.env.local.example`** (modified)
    Add `NEXT_PUBLIC_GA_MEASUREMENT_ID=` entry. No test needed.

---

### Testing Strategy

**Test files to create:**

| File | Package | Purpose |
|------|---------|---------|
| `src/__tests__/HeaderCTA.test.tsx` | landing | New Client Component full coverage |
| `src/__tests__/edge-cases.f093.test.tsx` | landing | Page-level integration edge cases |
| `src/__tests__/components/HablarAnalytics.test.tsx` | web | New analytics sentinel component |

**Test files to extend (add new `describe` block or `it` cases):**

| File | New tests |
|------|-----------|
| `src/__tests__/SiteHeader.test.tsx` | Renders HeaderCTA with correct href when hablarBaseUrl set; falls back to #waitlist when null; passes ctaHref+variant to MobileMenu |
| `src/__tests__/MobileMenu.test.tsx` | ctaHref prop used as href; external URL → target="_blank"; internal → no target; fires cta_hablar_click on click; menu closes after CTA click |
| `src/__tests__/sections/HeroSection.test.tsx` | Variant A renders hablar CTA when hablarUrl set; Variant A hides CTA when hablarUrl absent/null; Variants C and F never render hablar CTA |
| `src/__tests__/sections/WaitlistCTASection.test.tsx` | Renders "O pruébalo ahora gratis →" when hablarUrl set; does not render when hablarUrl absent |
| `src/__tests__/components/HablarShell.test.tsx` | hablar_query_sent pushed to window.dataLayer on submit; not pushed when dataLayer undefined |

**Key test scenarios:**

- `HeaderCTA`: when `hablarBaseUrl` is null → renders `href="#waitlist"`, no `target`, no analytics on click
- `HeaderCTA`: when `hablarBaseUrl` is set → correct UTM href, `target="_blank"`, fires `cta_hablar_click` with `source='header'`
- `MobileMenu`: when `ctaHref` starts with `http` → `target="_blank"` and `rel="noopener noreferrer"` present; fires analytics + closes menu
- `HeroSection`: when `variant='c'` or `variant='f'` and `hablarUrl` set → hablar CTA NOT rendered
- `HeroSection`: when `variant='a'` and `hablarUrl` is `'#waitlist'` → hablar CTA NOT rendered
- `WaitlistCTASection`: hablar CTA is rendered BELOW social proof counter and ABOVE trust note
- `WaitlistCTASection`: existing waitlist form submission behavior is unchanged (regression)
- `HablarAnalytics`: `hablar_page_view` fired once on mount; UTM params included when present in search params; no error when `window.dataLayer` is undefined
- `HablarShell`: `window.dataLayer?.push` called with `{ event: 'hablar_query_sent' }` when form submitted

**Mocking strategy:**

- Landing tests: `jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), getUtmParams: jest.fn(() => ({})) }))` — already established pattern in `WaitlistCTASection.test.tsx`
- Web `HablarAnalytics` tests: mock `next/navigation` → `jest.mock('next/navigation', () => ({ useSearchParams: jest.fn() }))`, set `window.dataLayer = []` in `beforeEach`
- Web `HablarShell` tests: extend existing mocks; set `window.dataLayer = []` in `beforeEach`, assert `.push` called

---

### Key Patterns

**`'use client'` directive required for:**
- `packages/landing/src/components/HeaderCTA.tsx` — new file, onClick + analytics
- `packages/web/src/components/HablarAnalytics.tsx` — new file, useSearchParams + useEffect

**`'use client'` NOT needed (stays Server Component):**
- `packages/landing/src/components/SiteHeader.tsx` — delegates interactivity to `HeaderCTA` and `MobileMenu`
- `packages/web/src/app/layout.tsx` — uses `next/script` which is SSR-compatible
- `packages/web/src/app/hablar/page.tsx` — renders Server Component shell; `HablarAnalytics` and `HablarShell` are client children

**Patterns to follow (with file references):**

1. **trackEvent call shape** — see `packages/landing/src/components/sections/HeroSection.tsx` lines 37–40: spread `getUtmParams()` result. For F093 CTA events, do NOT spread `getUtmParams()` — the UTM medium is predetermined per component, not from the URL.

2. **Env var access in Server Components** — see `packages/landing/src/app/page.tsx` line 220: use `process.env['NEXT_PUBLIC_WEB_URL']` bracket notation (ESLint rule enforced in this project).

3. **Conditional rendering of optional features** — see `WaitlistCTASection.tsx` lines 76–79: guard render with `{condition && (...)}`. Follow the same pattern for hablarUrl CTAs.

4. **MobileMenu close + action** — see `MobileMenu.tsx` lines 106–109: `onClick={close}` on nav links. For the CTA, compose: `onClick={() => { trackEvent(...); close(); }}`.

5. **`next/script` with `strategy="afterInteractive"`** — the web layout must use this strategy. Raw `<script>` tags in Server Components cause hydration warnings. This is the same strategy the landing package uses for GA4 (see `packages/landing/src/app/layout.tsx` if it exists, or follow the spec verbatim).

6. **`useSearchParams` requires `<Suspense>` boundary** — Next.js App Router throws if `useSearchParams` is used without wrapping the consuming component in `<Suspense>`. The `hablar/page.tsx` must wrap `<HablarAnalytics>` in `<Suspense fallback={null}>`. See the existing pattern in `packages/landing/src/app/page.tsx` line 257 for `WaitlistSuccessBanner`.

7. **dataLayer.push not window.gtag** — The web package uses `window.dataLayer?.push(...)` (optional chaining) rather than calling `window.gtag` directly. This guarantees delivery even when the gtag.js script hasn't loaded yet, because gtag replays the dataLayer queue on initialization. See spec Architecture Decisions section.

8. **Test file location convention** — Landing tests live at `packages/landing/src/__tests__/`. Web tests live at `packages/web/src/__tests__/components/`. Follow the existing paths exactly (no subdirectory for landing component tests at the root level).

9. **jest.mock with relative paths** — Web tests use `jest.mock('../../lib/apiClient', ...)` (relative). Landing tests use `jest.mock('@/lib/analytics', ...)` (alias). Follow the established pattern per package — check existing test files before choosing.

**Gotchas:**

- `SiteHeader` renders both the desktop `HeaderCTA` and the `MobileMenu`. After the change, `SiteHeader.test.tsx` must mock `HeaderCTA` or pass `hablarBaseUrl` and `variant` props in every test render call — update the `setup` / `render` invocations in the existing test to include the new required props.
- `MobileMenu` currently has `ctaText: _ctaText` (unused, prefixed with `_`). The new `ctaHref` and `variant` props are additions, not replacements. `mobileCta` (the button label) is still used.
- `HeroSection` has three sub-components: `HeroVariantA`, `HeroVariantC`, `HeroVariantF`. Only `HeroVariantA` receives `hablarUrl`. The prop must be threaded from `HeroSection` → `HeroVariantA` only. `HeroVariantC` and `HeroVariantF` signatures must NOT be changed.
- `window.dataLayer` does not exist on the global `Window` type in TypeScript. Add a type augmentation in `packages/web/src/types/global.d.ts` (create if needed) or inline in `layout.tsx`: `declare global { interface Window { dataLayer?: Record<string, unknown>[]; } }`.
- The `hablar_query_sent` event fires in `handleSubmit` (sync), not inside the async `executeQuery` try/catch. This means it fires on every submit attempt regardless of API success/failure — consistent with the intent (query intent tracking, not result tracking).
- **`null` vs `undefined` prop mismatch:** `hablarBaseUrl` is resolved as `string | null` in `page.tsx`, but `HeroSection` and `WaitlistCTASection` expect `hablarUrl?: string` (i.e., `string | undefined`). Pass `hablarBaseUrl ?? undefined` when threading to these components.
- **No analytics on fallback clicks:** When `hablarBaseUrl` is null (URL unset), header CTA falls back to `#waitlist`. The `onClick` handler in `HeaderCTA` and `MobileMenu` must NOT call `trackEvent` for `#waitlist` clicks — guard with `href.startsWith('http')`.
- **`dataLayer` initialization pattern:** Always use `(window.dataLayer = window.dataLayer || []).push(...)` instead of `window.dataLayer?.push(...)`. Optional chaining silently drops events if `dataLayer` hasn't been initialized by the layout script yet.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] No linting errors
- [ ] Build succeeds (landing and web packages)
- [ ] Visual coherence verified (CTAs match design system)

---

## Workflow Checklist

- [ ] Step 0: Spec created, reviewed
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: Plan created, reviewed
- [ ] Step 3: Implementation complete
- [ ] Step 4: Quality gates pass, committed
- [ ] Step 5: PR, code-review-specialist, qa-engineer executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-08 | Step 0: Spec | Spec drafted by spec-creator agent |
| 2026-04-08 | Spec review | Reviewed by Gemini + Codex. 2 CRITICAL + 5 IMPORTANT + 3 SUGGESTION. All addressed: HeaderCTA extraction, UTM per-component, variant prop threading, fallback clarification, dataLayer queue, cross-domain wording, Script component, trailing slash, useSearchParams |
| 2026-04-08 | Step 2: Plan | Plan written by frontend-planner agent. 13 implementation steps. |
| 2026-04-08 | Plan review | Reviewed by Gemini + Codex. 1 CRITICAL + 5 IMPORTANT + 2 SUGGESTION. All addressed: dataLayer init pattern, null→undefined prop conversion, no analytics on fallback clicks, variant prop for WaitlistCTA, payload type mapping, spec/plan gtag→dataLayer consistency |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.**

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | |
| 1. Mark all items | [ ] | |
| 2. Verify product tracker | [ ] | |
| 3. Update key_facts.md | [ ] | |
| 4. Update decisions.md | [ ] | |
| 5. Commit documentation | [ ] | |
| 6. Verify clean working tree | [ ] | |
| 7. Verify branch up to date | [ ] | |
