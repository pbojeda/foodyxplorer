# F093: Web Assistant — Landing Integration + Analytics

**Feature:** F093 | **Type:** Frontend-Feature | **Priority:** High
**Status:** Spec | **Branch:** feature/F093-landing-web-integration
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
    window.dataLayer?.push({
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

These fire via `window.gtag` directly (no shared analytics module in the web package — keep it simple).

| Event Name | Trigger | Parameters |
|---|---|---|
| `hablar_page_view` | `/hablar` route mounts (client-side) | `utm_source`, `utm_medium`, `utm_campaign` (from URL, if present) |
| `hablar_query_sent` | User submits a query in HablarShell | _(none — no PII, no query text)_ |

**`hablar_page_view` implementation note:** Fires in `HablarAnalytics` useEffect on mount. Reads UTM params from `window.location.search`. Only fires if `window.gtag` is defined.

**`hablar_query_sent` implementation note:** Fires inside the existing submit handler in `HablarShell`. Only fires if `window.gtag` is defined. No query text, no user identifiers.

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
7. **Analytics — web page view:** Loading `/hablar` fires `hablar_page_view` via `window.gtag`. UTM params from the URL are included in the event payload when present.
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

_To be filled by planner agent._

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
- [ ] Step 1: Branch created, ticket generated, tracker updated
- [ ] Step 2: Plan created, reviewed
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
