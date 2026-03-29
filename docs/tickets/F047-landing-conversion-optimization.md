# F047: Landing — Conversion Optimization

**Feature:** F047 | **Type:** Fullstack | **Priority:** High
**Status:** In Progress | **Branch:** feature/F047-landing-conversion-optimization
**Created:** 2026-03-29 | **Dependencies:** F046 (done)

---

## Spec

### Description

Optimize the nutriXplorer landing page for conversion based on the cross-model audit (2026-03-28). This feature addresses all remaining Sprint 1 (P1) items that were not covered by F045 (bug fixes) or F046 (waitlist persistence).

**Items in scope** (from audit Sprint 1):

| # | Issue | Audit ref | Est. time |
|---|-------|-----------|-----------|
| 1 | GA4 initialization — dataLayer not bootstrapped, gtag() not called before events | I4 | 1-2h |
| 2 | Mobile hamburger menu — nav links hidden on mobile | I2 | 1-2h |
| 3 | Auto-prepend +34 on phone field | I6 | 30min |
| 4 | Read ?waitlist=success for no-JS feedback | I9 | 1h |
| 5 | Reduce waitlist forms to 2 max (hero + final CTA) | S7 | 30min |
| 6 | Social proof — waitlist counter or trust signal | I7 | 1-2h |
| 7 | Benefit-oriented CTA copy | S4 | 15min |
| 8 | Fix text-slate-400 contrast to slate-500 | S11 | 10min |

### API Changes

#### `GET /waitlist/count` (public, no auth)

Small addition to packages/api to support the social proof counter.

**Response** (200):
```json
{
  "success": true,
  "data": { "count": 42 }
}
```

- **Rate limiting**: Anonymous tier (30/15min/IP, global default)
- **Caching**: Redis server-side cache (5 min TTL via `cacheGet/cacheSet`) + `Cache-Control: public, max-age=300` HTTP header
- **Error**: Standard error envelope on DB failure (500)
- **Route**: Add to `packages/api/src/routes/waitlist.ts` (existing plugin)
- **No Zod schema needed** — no query params or body

### Data Model Changes

None.

### UI Changes

#### 1. GA4 Initialization (I4)

The current CookieBanner loads the GA4 script but never initializes `dataLayer` or calls `gtag('js', new Date())` before config. Fix:

- In `CookieBanner.tsx`, before loading the GA4 script:
  1. Initialize `window.dataLayer = window.dataLayer || []`
  2. Define `window.gtag = function() { dataLayer.push(arguments) }`
  3. Call `gtag('js', new Date())` before `gtag('config', GA_ID)`
- In `analytics.ts`, `trackEvent` already pushes to `dataLayer` — no changes needed there.
- The GA4 script tag must have `id` attribute for the onLoad callback.

#### 2. Mobile Hamburger Menu (I2)

Currently, nav links are hidden on mobile (`hidden md:flex`), leaving only a "Acceso" CTA button. Add a hamburger menu:

- Keep `SiteHeader` as a Server Component for minimal JS payload
- Extract a `MobileMenu` Client Component (`'use client'`) for the interactive hamburger toggle
- `MobileMenu` receives nav links + CTA text as props (no hardcoded content)
- Hamburger button (3-line icon) visible only on mobile (`md:hidden`)
- Toggle mobile dropdown panel with nav links + CTA on click
- Close on link click, outside click, or Escape key
- Use `aria-expanded`, `aria-controls` for accessibility
- Animate: slide-down or fade-in (CSS transition, no framer-motion)
- Mobile panel: full-width dropdown below header with nav links stacked vertically

#### 3. Phone Auto-Prepend +34 (I6)

Spanish users don't naturally type `+34`. In `WaitlistForm.tsx`:

- When the phone input is focused and empty, auto-fill `+34` as a starting value (no trailing space — existing regex `^\+\d{7,15}$` strips spaces before validation)
- If the user types a 9-digit number (without +34), auto-prepend `+34` on blur
- On blur, if the value is just `+34` (bare prefix, no digits), clear the field back to empty
- Don't overwrite if user already typed a different country code (e.g., `+1`)

#### 4. No-JS Waitlist Success Feedback (I9)

When JS is disabled, the form POSTs and the API redirects to `/?waitlist=success`. Currently, the page doesn't read this param.

- Create a `WaitlistSuccessBanner` Client Component that uses `useSearchParams()` to read the `waitlist` param
- If `waitlist === 'success'`, render a visible banner at the top of the page:
  ```
  ✓ ¡Te has apuntado a la waitlist! Te avisaremos cuando lancemos.
  ```
- Style: green background, white text, dismiss button (client-side only)
- Place the component in `page.tsx` after `SiteHeader`
- Using a Client Component with `useSearchParams()` avoids forcing the entire page into Dynamic Rendering (which would disable SSG/caching)
- For true no-JS users: the banner won't render (since it's a Client Component), but the URL param is visible confirmation. This is an acceptable tradeoff vs. degrading SSG for all visitors.

#### 5. Reduce Waitlist Forms to 2 (S7)

The page shows up to 4 waitlist forms. Reduce to exactly 2: hero CTA and final WaitlistCTASection. Remove:

- Any inline WaitlistForm instances in variant layouts (page.tsx) that are NOT in the hero or WaitlistCTASection
- Keep `PostSimulatorCTA` (it shows after interaction, so it's contextual, not duplicative)

Review each variant layout (A, C, F) and remove extra form instances. The hero area should have just one WaitlistForm.

**Note**: The Footer component does NOT contain a WaitlistForm — it only has links. No changes needed there.

#### 6. Social Proof — Waitlist Counter (I7)

Add a "joined" counter in the WaitlistCTASection to create social proof:

- Fetch the real count from `GET /admin/waitlist?limit=1&offset=0` (total field) — but this requires admin auth
- **Alternative**: Add a simple `GET /waitlist/count` public endpoint to the landing's Next.js app that proxies to the API... but we deleted the Next.js API routes in F046.
- **Simplest approach**: Use a threshold counter: "Más de 50 personas ya se han apuntado" once the count exceeds a threshold. The actual count is fetched client-side from a simple public endpoint.
- **Decided approach**: Add a `GET /waitlist/count` endpoint to the Fastify API (packages/api) that returns `{ success: true, data: { count: number } }` — public, no auth, Redis-cached 5 minutes + Cache-Control header. On the landing, fetch this count client-side and display "Ya se han apuntado X personas" in the WaitlistCTASection. If count < 10, don't show the counter (avoids showing low numbers).

**Note**: This requires a small backend addition to packages/api. This is acceptable since F047 depends on F046 which already has the waitlist infrastructure.

#### 7. Benefit-Oriented CTA Copy (S4)

Replace generic CTA text:
- Hero CTA button: "Pedir acceso anticipado" → "Quiero saber qué como"
- WaitlistCTASection headline: Current generic → "Descubre exactamente qué comes en tu restaurante favorito"
- SiteHeader CTA: "Pedir acceso anticipado" → "Probar gratis"
- SiteHeader mobile CTA: "Acceso" → "Probar"

#### 8. Fix text-slate-400 Contrast (S11)

`text-slate-400` (#94a3b8) fails WCAG AA on white backgrounds (3.0:1 ratio vs 4.5:1 required). Replace with `text-slate-500` (#64748b) which passes AA at 5.6:1.

Apply selectively — only on white/light backgrounds:
- `WaitlistCTASection.tsx`: lines 56, 61
- `WaitlistForm.tsx`: lines 228, 247
- `ProductDemo.tsx`: line 52
- `ComparisonSection.tsx`: line 37

Do NOT change in Footer (dark background — slate-400 has sufficient contrast on dark).
Do NOT change in SearchSimulator (icon color — decorative, not text content).

### Edge Cases & Error Handling

- **GA4**: If `NEXT_PUBLIC_GA_MEASUREMENT_ID` is empty, do not initialize GA4 at all (existing behavior)
- **Mobile menu**: Must not break SSR — use `'use client'` directive, hydration-safe
- **Phone +34**: Don't overwrite if user already typed a different country code (e.g., +1). Clear bare `+34` on blur (no digits entered).
- **Waitlist success**: Banner only shows for `?waitlist=success`, not other values. Client-side dismiss only.
- **Waitlist count**: If count < 10, don't show counter (avoids showing low numbers)
- **Waitlist count**: If fetch fails, don't show the counter (graceful degradation)
- **CTA copy**: Must be in Spanish, natural phrasing
- **Contrast**: Only fix on light backgrounds — dark backgrounds (Footer) are fine

---

## Implementation Plan

### Backend Implementation Plan

#### Existing Code to Reuse

- `packages/api/src/routes/waitlist.ts` — add the new route handler directly inside `waitlistRoutesPlugin` (same plugin, same file)
- `packages/api/src/lib/cache.ts` — `buildKey`, `cacheGet`, `cacheSet` (import already available in the project)
- `packages/api/src/__tests__/f046.waitlist.route.test.ts` — mock setup (`vi.hoisted` Redis + Prisma mocks, `mockWaitlistCount`, `buildApp` pattern) is already in place; the new test file extends this setup
- `mockWaitlistCount` mock is already declared in `f046.waitlist.route.test.ts` (line 38) and set to `mockResolvedValue(1)` in `beforeEach` — reuse the same mock variable in the new test file

#### Files to Modify

- `packages/api/src/routes/waitlist.ts` — add `GET /waitlist/count` handler inside the existing `waitlistRoutesPlugin`. Import `buildKey`, `cacheGet`, `cacheSet` from `../lib/cache.js`.

#### Files to Create

- `packages/api/src/__tests__/f047.waitlist-count.route.test.ts` — unit tests for the new `GET /waitlist/count` endpoint (mocked Prisma + Redis, same boilerplate as `f046.waitlist.route.test.ts`)

#### Implementation Order (TDD)

1. **Write the test file first** (`f047.waitlist-count.route.test.ts`)
   - Copy the full mock boilerplate from `f046.waitlist.route.test.ts` (Redis, Prisma, Kysely, estimation mocks, `buildApp` import)
   - Test: cache miss → calls `prisma.waitlistSubmission.count()` → returns `{ success: true, data: { count: N } }` with status 200
   - Test: cache miss → sets `Cache-Control: public, max-age=300` response header
   - Test: cache hit → returns cached count, does NOT call `mockWaitlistCount`
   - Test: DB error → returns 500 with standard error envelope `{ success: false, error: { code: 'INTERNAL_ERROR' } }`
   - Redis mock for cache miss: `mockRedisGet.mockResolvedValue(null)` in the test; for cache hit: `mockRedisGet.mockResolvedValue(JSON.stringify(42))`
   - Cache key to assert: `fxp:waitlist:count` (built via `buildKey('waitlist', 'count')`)
   - Run tests — all should fail (route does not exist yet)

2. **Implement the route** (`packages/api/src/routes/waitlist.ts`)
   - Add imports at the top: `import { buildKey, cacheGet, cacheSet } from '../lib/cache.js';`
   - Add `GET /waitlist/count` handler after the existing `POST /waitlist` handler and before `GET /admin/waitlist`
   - No custom `rateLimit` config block — omit entirely so the global anonymous default (30/15 min/IP) applies
   - Handler logic:
     1. Build cache key: `buildKey('waitlist', 'count')`
     2. `cacheGet<number>(key, request.log)` — on hit, set `Cache-Control` header and return cached value
     3. On miss: `await prisma.waitlistSubmission.count()`
     4. `cacheSet(key, count, request.log, { ttl: 300 })`
     5. Set `reply.header('Cache-Control', 'public, max-age=300')`
     6. Return `{ success: true, data: { count } }` with status 200
   - Let unexpected errors propagate — the root-level error handler returns the standard 500 envelope
   - Add OpenAPI schema annotation: `tags: ['Waitlist']`, `summary: 'Public waitlist count'`
   - Run tests — all should pass

3. **Verify**
   - Run `pnpm --filter api test` to confirm all existing tests (F046 suite) still pass alongside the new F047 suite
   - Run `pnpm --filter api typecheck` (or `tsc --noEmit`) to confirm no TypeScript errors

#### Testing Strategy

**File**: `packages/api/src/__tests__/f047.waitlist-count.route.test.ts`

**Mock strategy** (identical to F046 pattern):
- Redis: `vi.mock('../lib/redis.js')` with `mockRedisGet` / `mockRedisSet` via `vi.hoisted`
- Prisma: `vi.mock('../lib/prisma.js')` with `mockWaitlistCount` via `vi.hoisted`
- Kysely + estimation mocks: copy verbatim from `f046.waitlist.route.test.ts` (required by `buildApp` transitive imports)

**Key test scenarios**:
- Happy path (cache miss): `mockRedisGet` returns `null` → expect `mockWaitlistCount` called once → response `{ success: true, data: { count: 1 } }` with status 200 and `Cache-Control: public, max-age=300` header
- Cache hit: `mockRedisGet` returns `JSON.stringify(42)` → expect `mockWaitlistCount` NOT called → response `{ success: true, data: { count: 42 } }` with status 200
- DB error: `mockWaitlistCount.mockRejectedValue(new Error('DB down'))` → expect status 500 and `{ success: false, error: { code: 'INTERNAL_ERROR' } }`

#### Key Patterns

- Cache key convention: `fxp:<entity>:<id>` — use `buildKey('waitlist', 'count')` → `"fxp:waitlist:count"` (see `packages/api/src/lib/cache.ts` line 32)
- `cacheGet` / `cacheSet` require `request.log` (the Fastify per-request logger) as second argument — do not pass `app.log`
- No `rateLimit` config block on the new route: the global anonymous tier (30/15 min/IP) is applied automatically when no per-route config is set
- The plugin is wrapped with `fastify-plugin` so the root-level error handler applies — no local try/catch needed for DB errors; let them propagate
- `Cache-Control` header is set via `reply.header(...)` before `reply.send(...)` (or included in the return statement — Fastify sets headers before sending)

### Frontend Implementation Plan

---

#### Existing Code to Reuse

- **`packages/landing/src/components/SiteHeader.tsx`** — Server Component, stays Server; modify only to add `<MobileMenu>` import, update CTA copy constants, and remove the standalone mobile `<a>` CTA
- **`packages/landing/src/components/analytics/CookieBanner.tsx`** — Client Component, fix GA4 init sequence in-place inside the existing `onLoad` callback
- **`packages/landing/src/components/features/WaitlistForm.tsx`** — Client Component, add phone auto-prepend handlers to existing phone field; fix contrast on lines 228, 247
- **`packages/landing/src/components/sections/WaitlistCTASection.tsx`** — Client Component (`'use client'` already present), add `useEffect` fetch for counter; fix contrast on lines 56, 61
- **`packages/landing/src/app/page.tsx`** — Server Component, add `<WaitlistSuccessBanner>` wrapped in `<Suspense>` after `<SiteHeader>`; audit variant layouts for extra form instances
- **`packages/landing/src/lib/i18n/locales/es.ts`** — Dictionary, add `siteHeader` key, update `waitlistCta.headline`, update `hero.cta`
- **`packages/landing/src/components/sections/ComparisonSection.tsx`** — contrast fix only (line 37)
- **`packages/landing/src/components/ProductDemo.tsx`** — contrast fix only (line 52)
- **Existing test mock patterns**: `jest.mock('@/lib/analytics', ...)`, `global.fetch = mockFetch`, `jest.mock('next/script', ...)` — follow as established in existing test files

---

#### Files to Create

| File | Purpose |
|------|---------|
| `packages/landing/src/components/MobileMenu.tsx` | `'use client'` — hamburger toggle, dropdown panel, keyboard/outside-click dismiss; receives nav links + CTA text as props |
| `packages/landing/src/components/features/WaitlistSuccessBanner.tsx` | `'use client'` — reads `?waitlist=success` via `useSearchParams()`, renders dismissible green banner |
| `packages/landing/src/__tests__/MobileMenu.test.tsx` | Unit tests: toggle open/close, close on link click, close on outside click, Escape key, aria attributes |
| `packages/landing/src/__tests__/WaitlistSuccessBanner.test.tsx` | Unit tests: banner shown for `?waitlist=success`, hidden for other values, dismiss button |
| `packages/landing/src/__tests__/WaitlistCTASection.test.tsx` | Unit tests: counter shown when count >= 10, hidden when count < 10, hidden on fetch failure |
| `packages/landing/src/__tests__/edge-cases.f047.test.tsx` | Integration edge cases: CTA copy strings present, form count per variant, contrast classes |

---

#### Files to Modify

| File | Changes |
|------|---------|
| `packages/landing/src/components/SiteHeader.tsx` | Import `<MobileMenu>`; update `WAITLIST_CTA` constant to `'Probar gratis'`; add `MOBILE_CTA_TEXT = 'Probar'`; remove standalone mobile `<a>` CTA (lines 48-55); render `<MobileMenu navLinks={NAV_LINKS} ctaText={WAITLIST_CTA} mobileCta={MOBILE_CTA_TEXT} />` inside the flex shell div |
| `packages/landing/src/components/analytics/CookieBanner.tsx` | Add `id="ga4-script"` to the `<Script>` tag; in the `onLoad` callback: (1) `window.dataLayer = window.dataLayer \|\| []`; (2) `window.gtag = function(){ dataLayer.push(arguments) }`; (3) `window.gtag('js', new Date())`; (4) `window.gtag('config', GA_ID)` — all guarded by `GA_ID.length > 0` (already guaranteed by the outer conditional). Test via spy on `window.dataLayer.push` |
| `packages/landing/src/components/features/WaitlistForm.tsx` | Add optional `submitLabel` prop (default: `'Únete a la waitlist'`); add `handlePhoneFocus`: when `phone === ''` set `'+34'`; update `onBlur` for phone: clear if `phone === '+34'`, prepend if 9-digit bare number, leave if already starts with `+` and not `+34`; fix `text-slate-400` → `text-slate-500` on lines 228, 247 |
| `packages/landing/src/components/sections/WaitlistCTASection.tsx` | Add `useState<number \| null>(null)` for `waitlistCount`; add `useEffect` that fetches `GET ${process.env['NEXT_PUBLIC_API_URL']}/waitlist/count` and sets count if `data.data.count >= 10`; render count paragraph conditionally; fix `text-slate-400` → `text-slate-500` on lines 56, 61 |
| `packages/landing/src/app/page.tsx` | Import `WaitlistSuccessBanner` and `Suspense`; add `<Suspense fallback={null}><WaitlistSuccessBanner /></Suspense>` after `<SiteHeader />`; audit A/C/F variant layouts to confirm max 2 `WaitlistForm` instances per variant |
| `packages/landing/src/lib/i18n/locales/es.ts` | Add `siteHeader: { cta: 'Probar gratis', mobileCta: 'Probar' }`; update `waitlistCta.headline` → `'Descubre exactamente qué comes en tu restaurante favorito'`; update `hero.cta` → `'Quiero saber qué como'` |
| `packages/landing/src/components/sections/ComparisonSection.tsx` | Replace `text-slate-400` with `text-slate-500` on the `versus` label (line 37 area — verify exact line) |
| `packages/landing/src/components/ProductDemo.tsx` | Replace `text-slate-400` with `text-slate-500` on the step label (line 52 area — verify exact line) |
| `packages/landing/src/__tests__/SiteHeader.test.tsx` | Update CTA copy assertions to match new text ("Probar gratis", "Probar"); add test that MobileMenu renders (hamburger button present) |
| `packages/landing/src/__tests__/CookieBanner.test.tsx` | Add tests: after accept, `window.dataLayer` is initialised; `window.gtag` is called with `'js'` as first arg; `window.gtag` is called with `'config'` and GA_ID |
| `packages/landing/src/__tests__/WaitlistForm.test.tsx` | Add tests for phone auto-prepend (see Testing Strategy section) |

---

#### Implementation Order

Follow TDD throughout: write the test first, watch it fail, implement, watch it pass.

1. **Contrast fix** — `WaitlistCTASection.tsx`, `WaitlistForm.tsx`, `ComparisonSection.tsx`, `ProductDemo.tsx` — replace `text-slate-400` with `text-slate-500` on light backgrounds. No test needed beyond the edge-cases assertion file, but write that assertion first.

2. **CTA copy + i18n** — `es.ts` → update `waitlistCta.headline`, add `siteHeader.cta / mobileCta`, update `hero.cta`; propagate into `SiteHeader.tsx`. Write assertions in `edge-cases.f047.test.tsx` first.

3. **GA4 initialization** — Write new tests in `CookieBanner.test.tsx` first; implement in `CookieBanner.tsx`.

4. **Phone auto-prepend** — Write new tests in `WaitlistForm.test.tsx` first; implement in `WaitlistForm.tsx`.

5. **Reduce forms to 2** — Write count assertion in `edge-cases.f047.test.tsx` first; audit and fix `page.tsx` if needed.

6. **WaitlistSuccessBanner** — Write `WaitlistSuccessBanner.test.tsx` first; create `WaitlistSuccessBanner.tsx`; add to `page.tsx` inside `<Suspense>`.

7. **Waitlist counter** — Write `WaitlistCTASection.test.tsx` first; implement fetch + render in `WaitlistCTASection.tsx`.

8. **MobileMenu** — Write `MobileMenu.test.tsx` first; create `MobileMenu.tsx`; update `SiteHeader.tsx`; update `SiteHeader.test.tsx`.

---

#### Testing Strategy

**Test files to create:**

- `packages/landing/src/__tests__/MobileMenu.test.tsx`
- `packages/landing/src/__tests__/WaitlistSuccessBanner.test.tsx`
- `packages/landing/src/__tests__/WaitlistCTASection.test.tsx`
- `packages/landing/src/__tests__/edge-cases.f047.test.tsx`

**Test files to extend:**

- `packages/landing/src/__tests__/CookieBanner.test.tsx`
- `packages/landing/src/__tests__/WaitlistForm.test.tsx`
- `packages/landing/src/__tests__/SiteHeader.test.tsx`

**Key test scenarios:**

_MobileMenu:_
- Hamburger button renders in DOM (role="button" or via aria-label)
- Button has `aria-expanded="false"` by default
- Clicking hamburger: nav links become visible, `aria-expanded="true"`
- Clicking hamburger again: nav links hidden, `aria-expanded="false"`
- Clicking a nav link: panel closes
- Clicking outside the panel element: panel closes
- Pressing Escape key: panel closes
- `aria-controls` on button matches the `id` of the panel element

_WaitlistSuccessBanner:_
- `useSearchParams()` returns `?waitlist=success` → banner text renders
- `useSearchParams()` returns no `waitlist` param → banner does not render
- `useSearchParams()` returns `?waitlist=other` → banner does not render
- Clicking dismiss button removes the banner from DOM
- Banner has accessible role (`role="status"` or `role="alert"`)

_WaitlistCTASection:_
- Fetch returns `{ success: true, data: { count: 42 } }` → counter paragraph renders with "42"
- Fetch returns `{ success: true, data: { count: 5 } }` (count < 10) → counter not rendered
- Fetch rejects (network error) → counter not rendered, no uncaught error
- Fetch returns non-ok response → counter not rendered

_CookieBanner GA4 additions:_
- After clicking "Aceptar" (with GA_ID set): `window.dataLayer` is an array
- `window.gtag` is defined as a function
- `window.gtag` was called with `'js'` as first argument (gtag('js', new Date()))
- `window.gtag` was called with `'config'` and the GA_ID string

_WaitlistForm phone additions:_
- Focusing on empty phone input sets value to `+34`
- Blurring with value exactly `+34` clears to `''`
- Blurring with `612345678` (9 digits, no prefix) sets value to `+34612345678`
- Blurring with `+1 2125550100` leaves value unchanged (non-+34 code)
- Blurring with `+34 612 345 678` leaves value unchanged (already has +34 with digits)

_edge-cases.f047.test.tsx:_
- Render LandingPage with each variant (a, c, f) and assert at most 2 `WaitlistForm` instances per page (test through the full page, not individual unexported layout functions)
- SiteHeader contains "Probar gratis" text
- `waitlistCta.headline` in `es.ts` matches expected string

**Mocking strategy:**

- `useSearchParams`: `jest.mock('next/navigation', () => ({ useSearchParams: jest.fn(() => new URLSearchParams()) }))` — override per test with `(useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('waitlist=success'))`
- Waitlist count fetch: `global.fetch = jest.fn()` in `beforeEach`, restore in `afterEach`; mock resolved value as `{ ok: true, json: async () => ({ success: true, data: { count: 42 } }) }`
- `next/script`: already mocked in `CookieBanner.test.tsx` via `jest.mock('next/script', () => function MockScript({ onLoad }) { if (onLoad) onLoad(); return null; })`
- Keep `jest.mock` paths using `@/` alias (project already resolves these in Jest config)

---

#### Key Patterns

**MobileMenu Client Component shape:**

```
interface MobileMenuProps {
  navLinks: { label: string; href: string }[];
  ctaText: string;
  mobileCta: string;
}
```

Use `useRef<HTMLDivElement>(null)` for the container. Attach `mousedown` listener on `document` in `useEffect` — call `setIsOpen(false)` if `!ref.current?.contains(event.target as Node)`. Attach `keydown` listener for `'Escape'`. Return cleanup in `useEffect`. CSS transition for the panel: `className={isOpen ? 'block' : 'hidden'}` or `max-h` transition.

**WaitlistSuccessBanner + Suspense requirement:**

`useSearchParams()` in App Router requires the component to be inside a `<Suspense>` boundary, otherwise Next.js will make the entire route dynamic. In `page.tsx`:

```tsx
import { Suspense } from 'react';
import { WaitlistSuccessBanner } from '@/components/features/WaitlistSuccessBanner';

// Inside the return:
<Suspense fallback={null}>
  <WaitlistSuccessBanner />
</Suspense>
```

**SiteHeader stays Server Component** — `SiteHeader.tsx` must NOT gain `'use client'`. Constants `NAV_LINKS`, `WAITLIST_CTA`, `MOBILE_CTA_TEXT` remain in the file and are passed as props into `<MobileMenu>`. Since `SiteHeader` is a Server Component and `MobileMenu` is a Client Component, Next.js handles the boundary automatically.

**Phone auto-prepend logic (exact):**

```
handlePhoneFocus: if (phone === '') setPhone('+34')
handlePhoneBlur:
  if (phone === '+34') { setPhone(''); return; }
  if (/^\d{9}$/.test(phone.trim())) { setPhone('+34' + phone.trim()); return; }
  // otherwise leave unchanged (already has a country code, etc.)
```

Do NOT add a trailing space after `+34`. The existing `phoneSchema` strips spaces before the regex test, so `+34612345678` and `+34 612 345 678` both pass.

**Waitlist counter fetch pattern** (follow `frontend-standards.mdc` 3-state pattern):

```
const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
useEffect(() => {
  fetch(`${process.env['NEXT_PUBLIC_API_URL']}/waitlist/count`)
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
      if (data?.success && typeof data.data?.count === 'number' && data.data.count >= 10) {
        setWaitlistCount(data.data.count);
      }
    })
    .catch(() => { /* graceful degradation — counter stays null */ });
}, []);
```

Render: `{waitlistCount !== null && <p>Ya se han apuntado {waitlistCount} personas</p>}`

**Contrast fix scope** — do NOT modify `Footer.tsx` (dark background) or `SearchSimulator.tsx` (icon color, decorative). Only the 4 files listed.

---

#### Constraints & Gotchas

- `WaitlistSuccessBanner` uses `useSearchParams()` — **must** be in `<Suspense>` in `page.tsx` or Next.js will disable SSG for the entire route.
- The existing mobile CTA `<a>` in `SiteHeader.tsx` (currently renders "Acceso" on mobile) must be **removed** when MobileMenu is added — otherwise there will be two mobile CTAs.
- `es.ts` does not currently have a `siteHeader` key. Adding it means the `Dictionary` type (inferred via `typeof es`) gains the key automatically — no separate type update needed. The `en.ts` locale should receive the same key for completeness.
- Verify exact line numbers in `ComparisonSection.tsx` and `ProductDemo.tsx` before editing — linting or prior changes may have shifted them from what the spec documents.
- `WaitlistCTASection.tsx` already has `'use client'` — no directive change needed; just add `useState` + `useEffect` imports if not already present.
- The variant layout audit in `page.tsx`: current code shows HeroSection contains a WaitlistForm internally (not visible as a direct `<WaitlistForm>` in page.tsx), and WaitlistCTASection contains one. No standalone `<WaitlistForm>` tags appear in the variant layout functions — confirm during implementation before making changes.
- `MobileMenu.test.tsx` should mock `next/link` if needed: `jest.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))`

---

## Acceptance Criteria

- [ ] GA4 properly initialized: dataLayer bootstrapped, gtag('js', new Date()) called before config
- [ ] Mobile hamburger menu shows nav links + CTA on mobile viewports
- [ ] Mobile menu is accessible (aria-expanded, aria-controls, Escape to close, close on link click, close on outside click)
- [ ] Phone field auto-prepends +34 when focused empty and on blur for 9-digit numbers
- [ ] ?waitlist=success shows client-rendered success banner (dismissible)
- [ ] Maximum 2 WaitlistForm instances per variant (hero + final CTA) plus PostSimulatorCTA
- [ ] Waitlist counter displayed in WaitlistCTASection (fetched from API)
- [ ] GET /waitlist/count public endpoint returns count (5min cache)
- [ ] CTA copy updated to benefit-oriented Spanish text
- [ ] text-slate-400 replaced with text-slate-500 on light backgrounds
- [ ] All existing tests pass
- [ ] New tests for: mobile menu toggle, GA4 init, phone auto-prepend, success banner, waitlist count
- [ ] Build succeeds with no TypeScript errors

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [ ] Step 0: `spec-creator` executed, specs updated
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: `frontend-planner` executed, plan approved
- [ ] Step 3: `frontend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-29 | Ticket created | 8 conversion optimizations from audit Sprint 1 |
| 2026-03-29 | Spec reviewed by Gemini+Codex | Gemini: 2C+3I+2S, Codex: 5I+2S. Both REVISE. 8 issues fixed: type→fullstack, API contract documented, phone prefix no-space, banner→Client Component, API envelope, MobileMenu extracted, Footer clarified, +34 bare prefix clear |
| 2026-03-29 | Plan reviewed by Gemini+Codex | Gemini: 2I+2S, Codex: 5I+2S. Both REVISE. 5 issues fixed: WaitlistForm submitLabel prop, test through LandingPage not unexported layouts, GA4 script id, backend mock duplication noted, no-JS tradeoff accepted |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |

---

*Ticket created: 2026-03-29*
