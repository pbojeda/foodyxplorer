# F039: Landing Page — nutriXplorer

**Feature:** F039 | **Type:** Frontend-Feature | **Priority:** High
**Status:** In Progress | **Branch:** feature/F039-landing-page
**Created:** 2026-03-25 | **Dependencies:** None

---

## Spec

### Description

Create a marketing landing page for nutriXplorer as a new `landing/` package in the monorepo. The landing validates market interest, captures waitlist leads, and positions the product for SEO. Target: production-ready on Vercel.

**Stack:** Next.js 14 (App Router) + TypeScript strict + Tailwind CSS + Framer Motion
**Deploy:** Vercel
**Package:** `landing/` added to root workspaces

Key requirements:
- Mobile-first responsive design
- A/B testing via `?variant=a|b` query param with cookie persistence (7 days); when no param and no cookie, random 50/50 assignment (`Math.random() < 0.5 ? 'a' : 'b'`) is used. The cookie is written client-side by CookieBanner ONLY after GDPR consent is granted.
- SEO: metadata API, JSON-LD (WebSite + SoftwareApplication), sitemap.ts, robots.ts
- Analytics: @vercel/analytics + @vercel/speed-insights + GA4 dataLayer events
- Events to track: landing_view, variant_assigned, scroll_depth (25/50/75/100), section_view, hero_cta_click (hero form only), waitlist_cta_click (non-hero forms, with source), waitlist_submit_start/success/error
- Waitlist form with `/api/waitlist` placeholder endpoint
- All code in English, user-facing copy in Spanish

**Sections (in order):**
1. **Hero** — "Conoce lo que comes" eyebrow + "Come fuera con tranquilidad" headline + WaitlistForm + product image with floating badge. Two A/B variants.
2. **Problem** — Pure text, no image. "Cuando comes fuera, decides casi a ciegas"
3. **HowItWorks** — 3 steps: Busca → Entiende → Decide
4. **TrustEngine** — Dark background (slate-950). 3 confidence levels (HIGH/MEDIUM/LOW) as cards + allergen guardrail callout integrated
5. **ForWho** — 4 user profiles as cards (fitness, family/allergies, senior/health, professional)
6. **EmotionalBlock** — Social/emotional scenes with real scenarios
7. **Comparison** — Cards comparing vs fitness apps, vs restaurant apps, vs guessing
8. **WaitlistCTA** — Final conversion section with waitlist form
9. **Footer** — Legal, links, secondary waitlist

> **Note:** FAQ section deferred to future F040. No FaqSection component in this feature.

**Design direction:**
- Palette: botanical green #2D5A27, energetic orange #FF8C42, slate, ivory #FDFBF7
- Typography: Inter (next/font, display: swap)
- Style: Modern wellness + premium tech. NOT aggressively fitness, NOT clinical, NOT overhyped
- A UI/UX design skill will be available during implementation to ensure premium visual quality
- Must NOT look AI-generated: asymmetric layouts, varied rhythm, subtle micro-interactions, personality in copy

**Available images (~30 high-quality 2048px AI-generated):**
- Telegram bot mockups in restaurant contexts
- Menu del día with phone overlay
- Overhead food shots with nutritional data
- Burger/tortilla with holographic split views
- Mother+child with "Sin Gluten" verified badge
- CrossFit user analyzing food

### API Changes (if applicable)

New placeholder endpoint in the `landing/` package (not in `packages/api`):

- `POST /api/waitlist` — Two content types handled:
  - `application/json`: Accepts `{ email: string }`, returns `{ success: true }` (status 200). Placeholder implementation logs email to console.
  - `application/x-www-form-urlencoded` (native form POST when JS is disabled): reads `variant` from formData, responds with 303 redirect to `/?variant=${variant}&waitlist=success` on valid email or `/?variant=${variant}&waitlist=error` on invalid email. The variant is preserved so the page re-renders with the correct A/B variant.
  To be wired to a real backend in a future feature.

### Data Model Changes (if applicable)

None. The waitlist endpoint is a placeholder; no database integration in this feature.

### UI Changes (if applicable)

New `landing/` workspace. See component hierarchy below and the updated `docs/specs/ui-components.md`.

**Landing page component hierarchy:**
```
Landing App
├── RootLayout (Server) — fonts, metadata, analytics
├── LandingPage (Server) — reads searchParams, JSON-LD
│   ├── HeroSection (Client) — A/B variants, Framer Motion
│   │   ├── WaitlistForm (Client) — email input, submit states
│   │   └── FloatingBadge (Server) — trust indicator overlay
│   ├── ProblemSection (Server) — text only
│   ├── HowItWorksSection (Server) — 3-step visual
│   ├── TrustEngineSection (Server) — 3 level cards + allergen callout
│   ├── ForWhoSection (Server) — 4 profile cards
│   ├── EmotionalBlock (Server) — social scenarios
│   ├── ComparisonSection (Server) — competitive cards
│   ├── WaitlistCTASection (Client) — final form
│   └── Footer (Server) — links, legal, secondary WaitlistForm
│       └── WaitlistForm (Client) — secondary waitlist with ctaLocation='footer'
├── CookieBanner (Client) — GDPR consent; gates GA4 events and A/B cookie
├── ScrollTracker (Client) — scroll depth analytics
└── SectionObserver (Client) — intersection observer per section (mounted in page.tsx, not layout.tsx)
```

**Primitives to create (shadcn/Radix pattern):**
- Button — primary (orange), secondary (outline), ghost
- Input — email input with label and error state
- Badge — confidence level indicators (high/medium/low)
- Card — flexible container for sections

**Additional client components:**
- `CookieBanner (Client)` — displays GDPR cookie consent banner on first visit. Stores user choice in `localStorage`. Analytics (GA4 dataLayer events) and the A/B variant cookie are only set AFTER the user consents. Vercel Analytics (`@vercel/analytics`) is cookieless and does NOT require consent — it runs unconditionally.

### Edge Cases & Error Handling

- Empty email submission → validation error displayed inline
- Network failure on waitlist submit → error state with retry button
- No `?variant` param and no cookie → random 50/50 assignment (`Math.random() < 0.5 ? 'a' : 'b'`) for each request until user consents. Cookie is written (7 days) by CookieBanner client-side ONLY after GDPR consent.
- Cookie exists but URL has different variant → URL wins, update cookie
- JavaScript disabled → native form POST sends `application/x-www-form-urlencoded`; `/api/waitlist` detects this content type and responds with 303 redirect to `/?waitlist=success` or `/?waitlist=error`
- Slow connection → hero image with `priority` prop, rest lazy loaded
- Screen reader → proper heading hierarchy, aria-labels, focus management

### Design Notes

> Full specification: [`docs/specs/design-guidelines.md`](../specs/design-guidelines.md)

**Visual direction:** Modern Wellness + Premium Tech. The page must NOT look AI-generated — use asymmetric layouts, varied vertical padding per section, and section-specific micro-interactions. Reference: design-guidelines.md sections 1, 11, 12.

**Color usage:**
- Ivory `#FDFBF7` as default page background (warm, premium breathing room)
- Dark sections (`bg-slate-950`) used ONLY for TrustEngine and Footer — creates dramatic contrast bookending
- CTA buttons are always `#FF8C42` (brand-orange) regardless of light/dark section
- Confidence badges use semantic colors (emerald/amber/rose) per design-guidelines.md section 2.2

**Typography:**
- Single font: Inter via `next/font`. Load weights 400, 600, 800 only (performance constraint)
- Hero H1: `64px` desktop / `36px` mobile, `font-extrabold`, tight tracking (`-0.025em`)
- Section H2s: `44px` desktop / `28px` mobile, `font-bold`
- All body text at `16px` minimum (prevents iOS zoom, accessibility)

**Section rhythm (varied padding — critical for avoiding AI-generated feel):**
- Hero: `128px` / `96px` top/bottom (desktop). Most generous
- TrustEngine + WaitlistCTA: `112px` / `112px`. Dramatic, spacious
- Problem + EmotionalBlock: `96px` / `96px`. Breathing room
- HowItWorks + ForWho + Comparison: `80px` / `80px`. Standard
- Footer: `64px` / `48px`. Compact, grounded

**Layout breaks (anti-template):**
- Hero Variant A: asymmetric 55/45 split (text left, image right)
- Problem: centered text-only, no image, max-width `640px`
- ForWho: headline LEFT-aligned (breaks centered pattern), 2x2 grid
- EmotionalBlock: alternating image left/right per scenario (NOT a card grid)
- TrustEngine: full-width dark band, only section with dark background mid-page

**Animations:**
- Hero elements stagger in on mount (0.15s intervals, 0.7s duration)
- Section headlines + cards animate on scroll via Framer Motion `whileInView` (fire once only)
- TrustEngine cards: dramatic scale-in entrance with 0.15s stagger
- Hero product image: subtle CSS float animation (6s infinite)
- All animations disabled when `prefers-reduced-motion: reduce`

**Performance targets:** LCP < 2.5s, CLS < 0.1, total page weight < 500KB gzip, JS bundle < 150KB gzip. Hero image uses `priority` + `fetchPriority="high"`.

**Image assignment:** See design-guidelines.md section 13 for the mapping of specific image files to sections. Key: `1.png` for Hero A, `4.png` for Hero B, `5.png` and `7.png` for TrustEngine, `2.png` for EmotionalBlock.

---

## Implementation Plan

### Existing Code to Reuse

This is a new `landing/` package — there is no existing frontend code. However, the following project-wide conventions and resources apply:

- `tsconfig.base.json` at monorepo root — extend from it in `landing/tsconfig.json`
- `eslint.config.mjs` at monorepo root — inherit ESLint configuration
- `docs/specs/ui-components.md` — already defines all component specs for this feature
- Available images at `/Users/pb/Developer/FiveGuays/foodXPlorerResources/` (2048px AI-generated) — copy into `landing/public/images/` during Phase 3
- No shared Zod schemas needed (landing is standalone; `@foodxplorer/shared` is not imported)

---

### Files to Create

```
landing/
├── package.json                                        # Workspace config: @foodxplorer/landing, Next.js 14, Tailwind, Framer Motion
├── next.config.ts                                      # Image domains, strict mode
├── tsconfig.json                                       # Extends ../tsconfig.base.json, strict: true, paths alias @/*
├── jest.config.ts                                      # jsdom env, @/* alias, next/jest transformer, jest.setup.ts
├── jest.setup.ts                                       # @testing-library/jest-dom + IntersectionObserver mock
├── tailwind.config.ts                                  # Design tokens: colors, fonts, radii, shadows
├── postcss.config.js                                   # Tailwind + autoprefixer
├── .env.local.example                                  # NEXT_PUBLIC_GA_MEASUREMENT_ID (required for GA4 script), NEXT_PUBLIC_SITE_URL
├── src/
│   ├── app/
│   │   ├── layout.tsx                                  # RootLayout: Inter font, Analytics, SpeedInsights, html lang="es"
│   │   ├── page.tsx                                    # LandingPage: reads searchParams.variant, JSON-LD, all sections
│   │   ├── globals.css                                 # CSS custom properties for design tokens, base resets
│   │   ├── sitemap.ts                                  # Dynamic sitemap (/ only — no /en route in F039)
│   │   ├── robots.ts                                   # robots.txt: allow all, sitemap pointer
│   │   ├── opengraph-image.tsx                         # Server-generated OG image
│   │   └── api/
│   │       └── waitlist/
│   │           └── route.ts                            # POST /api/waitlist placeholder (logs email, returns { success: true })
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx                              # Primitive: primary (orange), secondary (outline), ghost; accepts asChild
│   │   │   ├── Input.tsx                               # Primitive: email input with label, error state
│   │   │   ├── Badge.tsx                               # Primitive: high (green), medium (amber), low (rose) confidence variants
│   │   │   └── Card.tsx                                # Primitive: flexible container with header/content/footer slots
│   │   ├── sections/
│   │   │   ├── HeroSection.tsx                         # Client: A/B variants, Framer Motion, WaitlistForm, FloatingBadge
│   │   │   ├── ProblemSection.tsx                      # Server: text-only, large typography, ivory bg
│   │   │   ├── HowItWorksSection.tsx                   # Server: 3-step visual (Busca/Entiende/Decide)
│   │   │   ├── TrustEngineSection.tsx                  # Server: dark bg (slate-950), 3 ConfidenceCard + allergen guardrail
│   │   │   ├── ForWhoSection.tsx                       # Server: 4 profile cards with images
│   │   │   ├── EmotionalBlock.tsx                      # Server: asymmetric layout, image left/right, 3 scenarios
│   │   │   ├── ComparisonSection.tsx                   # Server: 3 comparison cards
│   │   │   ├── WaitlistCTASection.tsx                  # Client (contains WaitlistForm): final conversion
│   │   │   └── Footer.tsx                              # Server: logo, links, legal, GitHub, "Hecho en España"
│   │   ├── features/
│   │   │   ├── WaitlistForm.tsx                        # Client: email input, idle/loading/success/error states, GA4 events
│   │   │   ├── FloatingBadge.tsx                       # Server: trust indicator overlay on product image
│   │   │   ├── ConfidenceCard.tsx                      # Server: single confidence level card (HIGH/MEDIUM/LOW)
│   │   │   └── ProfileCard.tsx                         # Server: ForWho profile card with image
│   │   └── analytics/
│   │       ├── ScrollTracker.tsx                       # Client: scroll depth events at 25/50/75/100%
│   │       ├── SectionObserver.tsx                     # Client: IntersectionObserver per section, fires section_view
│   │       └── CookieBanner.tsx                        # Client: GDPR consent banner; gates GA4 + A/B cookie on consent
│   ├── lib/
│   │   ├── analytics.ts                                # trackEvent(), dataLayer.push() wrapper, typed event payloads
│   │   ├── ab-testing.ts                               # resolveVariant(), VARIANT_COOKIE_NAME, VARIANT_COOKIE_MAX_AGE
│   │   ├── i18n/
│   │   │   ├── index.ts                                # getDictionary(locale), Locale type
│   │   │   └── locales/
│   │   │       ├── es.ts                               # All Spanish copy strings (default)
│   │   │       └── en.ts                               # English copy strings (prepared, not yet linked to routes)
│   │   └── seo.ts                                      # generateJsonLd() for WebSite + SoftwareApplication schemas
│   └── types/
│       └── index.ts                                    # Variant type, Locale type, WaitlistPayload type, AnalyticsEvent type
└── __tests__/
    ├── WaitlistForm.test.tsx                           # Unit: validation, states, analytics events
    ├── ScrollTracker.test.tsx                          # Unit: scroll threshold logic
    ├── SectionObserver.test.tsx                        # Unit: IntersectionObserver fires once per section
    ├── CookieBanner.test.tsx                           # Unit: renders on first visit, stores consent, disappears after choice
    ├── analytics.test.ts                               # Unit: trackEvent payload shape
    ├── ab-testing.test.ts                              # Unit: resolveVariant() logic (URL wins over cookie, default 'a')
    └── api/
        └── waitlist.test.ts                            # Unit: POST /api/waitlist returns { success: true }
```

---

### Files to Modify

| File | Change |
|------|--------|
| `package.json` (root) | Add `"landing"` to the `workspaces` array |
| `docs/specs/ui-components.md` | Already updated (F039 section added in Step 0) — update again at end of Step 3 to reflect any implementation divergences |
| `docs/project_notes/product-tracker.md` | Update Active Session step after each phase |

---

### Implementation Order

#### Phase 0 — Design System + Project Setup

**Step 0.1 — Run ui-ux-designer skill**
- Before any code, invoke the `ui-ux-designer` skill. The skill will read `docs/project_notes/key_facts.md`, `docs/specs/ui-components.md`, and receive project context (PRDs from `initialDoc/`, images from `foodXPlorerResources/`). It generates `docs/specs/design-guidelines.md` with concrete values for colors, typography, spacing, animations, and anti-patterns.
- All subsequent component implementation must reference `docs/specs/design-guidelines.md` for visual decisions (spacing values, animation curves, section-level layout choices).
- Dependency: None. Must complete before Step 0.3.

**Step 0.2 — Initialize Next.js project**
- Files: `landing/package.json`, `landing/next.config.ts`, `landing/postcss.config.js`
- `package.json`: name `@foodxplorer/landing`, dependencies: `next@14`, `react@18`, `react-dom@18`, `framer-motion`, `zod`, `@vercel/analytics`, `@vercel/speed-insights`. `next-intl` is NOT used — use simple dictionary pattern instead. Dev deps: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jest`, `jest-environment-jsdom`, `ts-jest` (or `@swc/jest` for faster transforms), `@types/jest`, `@types/react`, `@types/node`, `tailwindcss`, `autoprefixer`, `typescript`. Scripts: `"dev"`, `"build"`, `"start"`, `"test"`, `"test:watch"`, `"typecheck"`
- `next.config.ts`: `reactStrictMode: true`, image `remotePatterns: []` (all images are local)
- Root `package.json` workspaces: add `"landing"`
- TDD: N/A (scaffolding step). Verify with `npm run build -w @foodxplorer/landing` (expect compile success, no pages yet)
- Dependency: None

**Step 0.2b — Jest configuration**
- Files: `landing/jest.config.ts`, `landing/jest.setup.ts`
- `jest.config.ts`: `testEnvironment: 'jsdom'`; `setupFilesAfterFramework: ['<rootDir>/jest.setup.ts']`; `moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }`; `transform` using `next/jest` transformer (call `createJestConfig` from `next/jest`)
- `jest.setup.ts`: `import '@testing-library/jest-dom'`; define `IntersectionObserver` mock class that calls callback immediately with `isIntersecting: true` (used by SectionObserver tests)
- TDD: N/A (configuration step). Verify with `npm test -w @foodxplorer/landing` runs without "jest not found" error
- Dependency: Step 0.2

**Step 0.3 — Configure Tailwind design tokens**
- Files: `landing/tailwind.config.ts`, `packages/landing/src/app/globals.css`
- Tailwind `theme.extend.colors`: `brand-green: '#2D5A27'`, `brand-orange: '#FF8C42'`, `ivory: '#FDFBF7'`
- Tailwind `theme.extend.fontFamily`: `sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans]`
- Tailwind `theme.extend.borderRadius`: `'2xl': '1rem'`, `'3xl': '1.5rem'`
- Tailwind `theme.extend.boxShadow`: `soft: '0 2px 16px 0 rgb(0 0 0 / 0.08)'`, `layered: '0 4px 32px 0 rgb(0 0 0 / 0.12)'`
- `globals.css`: `@tailwind base/components/utilities`, CSS vars `--font-inter`, base `body { background-color: #FDFBF7; color: #334155; }`
- TDD: no test. Verify by checking Tailwind IntelliSense picks up `bg-brand-green` and `text-brand-orange`
- Dependency: Step 0.2

**Step 0.4 — TypeScript config + path alias**
- Files: `landing/tsconfig.json`
- `tsconfig.base.json` exists at the monorepo root. Since `landing/` is a direct child of the repo root, extends should be `"../tsconfig.base.json"`. Add `compilerOptions.strict: true`, `paths: { "@/*": ["./src/*"] }` (the only path alias — no other paths are defined), `plugins: [{ name: "next" }]`
- TDD: `npm run typecheck -w @foodxplorer/landing` must exit 0
- Dependency: Step 0.2

**Step 0.5 — Create UI primitives**
- Files: `packages/landing/src/components/ui/Button.tsx`, `Input.tsx`, `Badge.tsx`, `Card.tsx`
- **Button**: variants `primary` (bg-brand-orange text-white hover:opacity-90), `secondary` (border border-slate-300 bg-transparent), `ghost` (no border no bg); accepts `asChild?: boolean` for rendering as `<a>`; forwards all native button props; sizes `sm/md/lg`; `disabled` state reduces opacity and disables pointer events; `isLoading` state shows inline spinner (animate-spin) and disables
- **Input**: controlled; props `label`, `id`, `error?: string`, all native input props; renders `<label>` + `<input>` + conditional error `<p>` with `role="alert"`; error state: `border-red-500 focus:ring-red-500`; default state: `border-slate-300 focus:ring-brand-green`
- **Badge**: variants `high` (bg-emerald-100 text-emerald-800 border-emerald-200), `medium` (bg-amber-100 text-amber-800 border-amber-200), `low` (bg-rose-100 text-rose-800 border-rose-200); renders as `<span>` with `border rounded-full px-2 py-0.5 text-xs font-semibold`
- **Card**: renders `<div>` with `rounded-2xl bg-white shadow-soft border border-slate-100`; accepts `className` for overrides; children pass-through
- TDD (write tests first): `__tests__/ui/Button.test.tsx`, `Input.test.tsx`, `Badge.test.tsx`, `Card.test.tsx`
  - Button: renders children, applies correct classes per variant, calls onClick, shows spinner when isLoading, is disabled when loading
  - Input: renders label, renders error message with role="alert", controlled value changes propagate
  - Badge: renders correct class per variant
  - Card: renders children
- Dependency: Steps 0.3, 0.4

**Step 0.6 — i18n dictionary setup**
- Files: `packages/landing/src/lib/i18n/index.ts`, `packages/landing/src/lib/i18n/locales/es.ts`, `packages/landing/src/lib/i18n/locales/en.ts`
- `es.ts`: export `const es = { hero: { eyebrow, headlineA, headlineB, subtitleA, subtitleB, cta, microcopy }, problem: { eyebrow, headline, p1, p2, p3 }, howItWorks: { ... }, trustEngine: { ... }, forWho: { ... }, emotionalBlock: { ... }, comparison: { ... }, waitlistCta: { ... }, footer: { ... } }` — all Spanish copy from the spec
- `en.ts`: same structure with English translation stubs (prepared for future EN support; NOT linked to any route in F039 — no `/en` route is created)
- `index.ts`: `export type Locale = 'es' | 'en'`; `export function getDictionary(locale: Locale = 'es')` returns the corresponding locale object synchronously
- Spanish copy sourced from `initialDoc/prompt-brief-landing-nutritrack.md` sections 9 (Message Direction) and 11 (Content Elements). The frontend-developer must read that file to extract exact copy for each section before writing `es.ts`.
- TDD: none needed; types catch errors at compile time
- Dependency: Step 0.4

---

#### Phase 1 — Infrastructure + Core Sections

**Step 1.1 — Types**
- Files: `packages/landing/src/types/index.ts`
- `export type Variant = 'a' | 'b'`
- `export type Locale = 'es' | 'en'` (re-exported from i18n)
- `export type WaitlistPayload = { email: string }`
- `export type WaitlistResponse = { success: boolean; error?: string }`
- `export type AnalyticsEventName = 'landing_view' | 'variant_assigned' | 'scroll_depth' | 'section_view' | 'hero_cta_click' | 'waitlist_cta_click' | 'waitlist_submit_start' | 'waitlist_submit_success' | 'waitlist_submit_error'`
- `export type AnalyticsEventPayload = { event: AnalyticsEventName; variant: Variant; lang: Locale; referrer?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; [key: string]: unknown }`
- TDD: N/A (types only). `npm run typecheck` must pass
- Dependency: None

**Step 1.2 — Analytics library**
- Files: `packages/landing/src/lib/analytics.ts`
- Declares `declare global { interface Window { dataLayer: unknown[] } }`
- `export function trackEvent(payload: AnalyticsEventPayload): void` — pushes to `window.dataLayer` if available, falls back to `console.debug` in development
- `export function getUtmParams(): Pick<AnalyticsEventPayload, 'utm_source' | 'utm_medium' | 'utm_campaign'>` — reads from `window.location.search`
- TDD (write test first): `__tests__/analytics.test.ts`
  - `trackEvent` pushes to `window.dataLayer`
  - `trackEvent` does not throw when `window.dataLayer` is undefined
  - `getUtmParams` parses UTM params from query string correctly
  - `getUtmParams` returns empty object when no UTMs present
- Dependency: Step 1.1

**Step 1.2b — CookieBanner**
- Files: `packages/landing/src/components/analytics/CookieBanner.tsx`
- `'use client'`
- Props: `variant: Variant` — used to write the A/B cookie after consent
- Renders on first visit when `localStorage.getItem('nx-cookie-consent')` is absent
- On accept:
  1. Stores `nx-cookie-consent=accepted` in `localStorage`
  2. Writes A/B variant cookie: `document.cookie = \`${VARIANT_COOKIE_NAME}=${variant}; max-age=${VARIANT_COOKIE_MAX_AGE}; path=/; samesite=lax\`` (this is the ONLY place the cookie is written — Server Components cannot write cookies in Next.js 14)
  3. Dynamically loads GA4 script via `next/script`: `<Script src={\`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}\`} strategy="afterInteractive" onLoad={() => { window.gtag?.('config', GA_ID) }} />`
  4. Before consent: `dataLayer.push()` calls are queued but GA4 is not active (script not loaded). After consent: script loads and processes queued events.
- On reject: stores `nx-cookie-consent=rejected`; no GA4 script is loaded, no A/B cookie is written.
- Vercel Analytics (`@vercel/analytics`) is cookieless and runs unconditionally — it does not depend on consent state.
- Dismisses after choice and does not reappear on subsequent visits.
- Add `NEXT_PUBLIC_GA_MEASUREMENT_ID` to `.env.local.example`
- TDD (write test first): `__tests__/CookieBanner.test.tsx`
  - Renders banner when no consent stored in localStorage
  - Does not render when consent is already stored
  - Stores 'accepted' in localStorage on accept click
  - Writes A/B cookie to document.cookie on accept click
  - Stores 'rejected' in localStorage on reject click
  - Does not write A/B cookie on reject click
  - Disappears after choice
- Dependency: Step 1.2

**Step 1.3 — A/B testing library**
- Files: `packages/landing/src/lib/ab-testing.ts`
- `export const VARIANT_COOKIE_NAME = 'nx-variant'`
- `export const VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 7` (7 days in seconds)
- `export function resolveVariant(searchParamVariant: string | undefined, cookieVariant: string | undefined, random?: () => number): Variant` — URL param wins over cookie; if neither is present or valid, performs random 50/50 assignment (`(random ?? Math.random)() < 0.5 ? 'a' : 'b'`); valid values are `'a'` and `'b'` only; the optional `random` param enables deterministic testing
- This function is pure (no side effects). Cookie writing does NOT happen in `page.tsx` — Server Components in Next.js 14 can read cookies but NOT write them. The A/B cookie is written by CookieBanner (Client Component) via `document.cookie` ONLY after the user grants GDPR consent. Until consent, variant is resolved server-side on every request (random assignment for new users with neither cookie nor URL param).
- TDD (write test first): `__tests__/ab-testing.test.ts`
  - Returns 'a' when both are undefined and injected random returns 0.3 (< 0.5)
  - Returns 'b' when both are undefined and injected random returns 0.7 (>= 0.5) — test both branches by injecting deterministic values; do NOT assert a fixed default of 'a'
  - Returns 'b' when searchParam is 'b' and cookie is 'a'
  - Returns 'a' when searchParam is 'a' and cookie is 'b' (URL wins)
  - Returns cookie value when searchParam is undefined and cookie is 'b'
  - Returns random result (via injected function) for invalid values ('c', '', 'B')
- Dependency: Step 1.1

**Step 1.4 — SEO utilities + JSON-LD**
- Files: `packages/landing/src/lib/seo.ts`
- `export function generateWebSiteSchema()` — returns JSON-LD object for schema.org/WebSite
- `export function generateSoftwareApplicationSchema()` — returns JSON-LD object for schema.org/SoftwareApplication
- Both use `NEXT_PUBLIC_SITE_URL` env var for URLs; fall back to `'https://nutrixplorer.com'`
- TDD: none required; output is static data
- Dependency: Step 1.1

**Step 1.5 — Root layout**
- Files: `packages/landing/src/app/layout.tsx`
- Server Component (no directive)
- Load `Inter` from `next/font/google`: `subsets: ['latin']`, `display: 'swap'`, `variable: '--font-inter'`
- Set `<html lang="es" className={inter.variable}>` and `<body className="bg-ivory text-slate-700 antialiased">`
- Mount `<Analytics />` from `@vercel/analytics/react` and `<SpeedInsights />` from `@vercel/speed-insights/next`
- Mount `<ScrollTracker />` — this is a Client Component. Do NOT mount `<CookieBanner />` here — CookieBanner needs the resolved `variant` prop and is mounted in `page.tsx` instead. Do NOT mount `<SectionObserver />` here either; it is mounted per-section in `page.tsx`
- `export const metadata: Metadata` with title template, description, keywords, metadataBase, openGraph, twitter
- Title: `"nutriXplorer | Información nutricional de restaurantes en España"`
- No `hreflang` alternate links — F039 is Spanish-only; no `/en` route. The `en.ts` dictionary file is a stub prepared for future use but not wired to any route in this feature.
- TDD: smoke render test in `__tests__/layout.test.tsx` — renders children without error (mock Analytics and SpeedInsights)
- Dependency: Steps 0.3, 1.2

**Step 1.6 — LandingPage (page.tsx)**
- Files: `packages/landing/src/app/page.tsx`
- Server Component
- Receives `{ searchParams }: { searchParams: { variant?: string } }` (Next.js 14 — searchParams is synchronous, NOT a Promise)
- Calls `resolveVariant(searchParams.variant, cookies().get(VARIANT_COOKIE_NAME)?.value)` directly (no `await`). `cookies()` is used READ-ONLY here (Server Components in Next.js 14 cannot write cookies — doing so throws an error).
- Does NOT call `cookies().set(...)` — cookie writing is handled client-side by CookieBanner after GDPR consent.
- Injects two `<script type="application/ld+json">` tags: one for WebSite schema, one for SoftwareApplication schema
- Composes all section components in order: HeroSection, ProblemSection, HowItWorksSection, TrustEngineSection, ForWhoSection, EmotionalBlock, ComparisonSection, WaitlistCTASection, Footer
- Passes `variant` prop to: HeroSection, WaitlistCTASection, Footer, SectionObserver (all instances), and **CookieBanner** (so it can write the cookie after consent)
- Each section is wrapped with `<SectionObserver sectionId="..." variant={variant}>` in `page.tsx`. SectionObserver is NOT mounted at the layout level.
- Mounts `<CookieBanner variant={variant} />` in this page (not in layout.tsx) so the resolved variant is available for cookie writing after consent
- Calls `getDictionary('es')` and passes `dict` (or relevant slice) to each section
- TDD: `__tests__/page.test.tsx`
  - Renders all 9 section landmarks
  - Uses injected random function: when random returns 0.3 → variant 'a', when random returns 0.7 → variant 'b'
  - Passes variant='b' when searchParams.variant='b'
  - JSON-LD scripts are present in the document
- Dependency: Steps 1.3, 1.4, 1.5, 0.6

**Step 1.7 — ScrollTracker + SectionObserver**
- Files: `packages/landing/src/components/analytics/ScrollTracker.tsx`, `SectionObserver.tsx`
- **ScrollTracker** (`'use client'`):
  - `useEffect` on mount: attaches `scroll` listener using `requestAnimationFrame` debounce
  - Tracks which thresholds (25/50/75/100) have fired in a `useRef<Set<number>>`
  - On each RAF tick: calculates `(window.scrollY + window.innerHeight) / document.body.scrollHeight * 100`
  - When threshold crossed: calls `trackEvent({ event: 'scroll_depth', depth: threshold, variant, lang: 'es', ...getUtmParams() })`
  - Receives `variant` as a React prop from LandingPage Server Component — no client-side cookie parsing
  - Cleanup: removes listener on unmount
- **SectionObserver** (`'use client'`):
  - Props: `sectionId: string`, `variant: Variant` — included in `section_view` analytics payload
  - `useRef` on the wrapper `<div>`
  - `useEffect`: creates `IntersectionObserver({ threshold: 0.5 })`; on first intersection fires `trackEvent({ event: 'section_view', section: sectionId, variant, lang: 'es', ...getUtmParams() })` and immediately disconnects
  - Renders a plain `<div ref={ref}>` wrapping children (no `display: contents` — use `forwardRef` approach to avoid layout side effects, or keep a plain block wrapper that does not affect layout via explicit `className` omission)
  - Children prop: `children: React.ReactNode`
- TDD (write tests first): `__tests__/ScrollTracker.test.tsx`, `__tests__/SectionObserver.test.tsx`
  - ScrollTracker: fires scroll_depth at 25% threshold; does not fire the same threshold twice; removes event listener on unmount
  - SectionObserver: calls trackEvent with section_view when IntersectionObserver triggers; does not call trackEvent a second time
  - Mock `IntersectionObserver` in test setup
- Dependency: Steps 1.2, 1.5

**Step 1.8 — WaitlistForm**
- Files: `packages/landing/src/components/features/WaitlistForm.tsx`
- `'use client'`
- Props: `source: 'hero' | 'cta' | 'footer'` — included in all analytics payloads; `variant: Variant` — included in all analytics payloads
- State: `email: string`, `status: 'idle' | 'loading' | 'success' | 'error'`, `errorMessage: string | null`
- Email validation: Zod schema `z.string().email()` — validate on submit AND on blur (only after first blur attempt)
- On focus: fires `trackEvent({ event: 'waitlist_submit_start', source, variant })` — only once (use `useRef` flag)
- On submit:
  1. Validate email; if invalid set error and return
  2. Set status 'loading'
  3. Fire analytics CTA event: if `source === 'hero'`, fire `hero_cta_click`; for all other sources (`'cta'`, `'footer'`), fire `waitlist_cta_click` with `source` included in payload
  4. `fetch('/api/waitlist', { method: 'POST', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } })`
  5. If response.ok: set status 'success', fire `waitlist_submit_success`
  6. If error: set status 'error', set errorMessage from response or generic fallback, fire `waitlist_submit_error`
- Renders:
  - idle/error/loading: `<Input>` + `<Button type="submit" isLoading={status==='loading'}>Únete a la waitlist</Button>` + microcopy "Sin spam. Solo lanzamiento y acceso temprano." + `errorMessage && <p role="alert">`
  - success: confirmation message "¡Apuntado! Te avisamos en el lanzamiento." with checkmark icon
- Progressive enhancement: `<form action="/api/waitlist" method="POST">` with a hidden input `<input type="hidden" name="variant" value={variant} />` — native form submission works without JS (API endpoint handles `application/x-www-form-urlencoded` too)
- `aria-live="polite"` on the status area for screen readers
- TDD (write tests first): `__tests__/WaitlistForm.test.tsx`
  - Shows validation error on submit with empty email
  - Shows validation error on submit with invalid email
  - Shows loading state while submitting
  - Shows success message after successful submission
  - Shows error state on network failure
  - Fires waitlist_submit_start on first focus (not on second focus)
  - Fires hero_cta_click on submit attempt when source='hero'
  - Fires waitlist_cta_click (not hero_cta_click) on submit attempt when source='cta'
  - Fires waitlist_cta_click with source='footer' on submit attempt when source='footer'
  - Fires waitlist_submit_success on success
  - Fires waitlist_submit_error on error
  - Retry: form re-enabled after error state
- Dependency: Steps 0.5, 1.2, 1.1

**Step 1.9 — /api/waitlist route**
- Files: `packages/landing/src/app/api/waitlist/route.ts`
- `export async function POST(request: Request)`: detects `Content-Type` header to branch behavior:
  - `application/json`: reads JSON body, validates with Zod (`WaitlistPayload`: `z.object({ email: z.string().email() })`), logs email to console, returns `Response.json({ success: true }, { status: 200 })`. On validation error: `Response.json({ success: false, error: 'Invalid email' }, { status: 400 })`.
  - `application/x-www-form-urlencoded` (native form POST, JS disabled): reads `request.formData()`, validates email, reads `variant` from formData (the hidden input added by WaitlistForm), on success returns 303 redirect to `/?variant=${variant}&waitlist=success`, on failure returns 303 redirect to `/?variant=${variant}&waitlist=error`. This preserves the A/B variant assignment across the no-JS redirect.
- TDD (write test first): `__tests__/api/waitlist.test.ts` — mock `Request`; test: valid JSON email returns 200; invalid JSON email returns 400; valid form POST returns 303 to `/?variant=a&waitlist=success` (variant preserved); invalid form POST returns 303 to `/?variant=a&waitlist=error`
- Dependency: Step 1.1

**Step 1.10 — HeroSection**
- Files: `packages/landing/src/components/sections/HeroSection.tsx`
- `'use client'`
- Props: `variant: Variant`, `dict: Dict['hero']`
- `useEffect` on mount: fires `trackEvent({ event: 'landing_view', variant })` and `trackEvent({ event: 'variant_assigned', variant })`
- Framer Motion: wrap headline and subtitle with `motion.div` using `initial={{ opacity: 0, y: 20 }}`, `animate={{ opacity: 1, y: 0 }}`, staggered with `delay: 0.1` increments per element. Use `useReducedMotion()` to skip animation if user prefers reduced motion.
- **Variant A layout** (default): 2-column on lg+, left column: eyebrow + H1 + subtitle + WaitlistForm + trust pills, right column: `<Image>` from `1.png` with `<FloatingBadge>` overlay
- **Variant B layout**: single centered column, larger H1 (text-5xl lg:text-7xl), `<Image>` from `5.png` (burger split-view) below the form, wider container
- Trust pills (both variants): 3 `<Badge variant="high">` items: "Dato oficial", "Estimación visible", "Guardrail de alérgenos" — rendered in a flex-wrap row below the form
- Images: `<Image src="/images/1.png" alt="..." width={800} height={800} priority className="rounded-3xl object-cover" sizes="(max-width: 768px) 100vw, 50vw" />`
- HeroSection does NOT wrap itself with `<SectionObserver>` — all SectionObserver wrapping happens exclusively in `page.tsx`. Do not add SectionObserver inside any section component.
- Background: subtle radial gradient via Tailwind `bg-gradient-radial from-orange-50 to-ivory` (define as custom gradient in tailwind.config)
- TDD: `__tests__/sections/HeroSection.test.tsx`
  - Renders variant A content when variant='a'
  - Renders variant B content when variant='b'
  - Fires landing_view on mount
  - Fires variant_assigned on mount
  - Contains WaitlistForm
  - Contains 3 trust pills
  - Uses priority on hero image
- Dependency: Steps 1.7, 1.8, 0.5, 0.6

**Step 1.11 — ProblemSection**
- Files: `packages/landing/src/components/sections/ProblemSection.tsx`
- Server Component (no directive)
- Props: `dict: Dict['problem']`
- Layout: ivory background, `max-w-3xl mx-auto`, centered text, generous vertical padding (py-24 lg:py-32)
- Renders: eyebrow `<p>` (text-brand-orange font-semibold tracking-wide uppercase text-sm), `<h2>` (text-4xl lg:text-5xl font-bold text-slate-900 mt-4), three `<p>` paragraphs (text-xl text-slate-600 leading-relaxed mt-6 each)
- No image. This section is intentionally text-only for visual breathing room.
- Wraps with `data-section="problem"` attribute (SectionObserver is mounted in page.tsx wrapping this element)
- TDD: `__tests__/sections/ProblemSection.test.tsx` — renders eyebrow, renders H2, renders all 3 paragraphs
- Dependency: Steps 0.3, 0.6

**Step 1.12 — HowItWorksSection**
- Files: `packages/landing/src/components/sections/HowItWorksSection.tsx`
- Server Component
- Props: `dict: Dict['howItWorks']`
- Layout: neutral bg (bg-slate-50), 3-column grid on lg+ (gap-8), single column on mobile with step numbers as large numerals
- Each step: large step number in brand-green (text-7xl font-black opacity-10 absolute), icon (SVG), step title (text-xl font-semibold), description (text-slate-600)
- Step 1: "Busca el plato" — search icon
- Step 2: "Entiende la respuesta" — chart/macros icon
- Step 3: "Decide con más calma" — checkmark icon
- Optional image: `2.png` (menu del día with phone overlay) rendered on the right side at lg+, hidden on mobile
- TDD: `__tests__/sections/HowItWorksSection.test.tsx` — renders 3 steps, each has a title and description
- Dependency: Steps 0.3, 0.5, 0.6

---

#### Phase 2 — Differentiation + Emotional Sections

**Step 2.1 — FloatingBadge + ConfidenceCard**
- Files: `packages/landing/src/components/features/FloatingBadge.tsx`, `packages/landing/src/components/features/ConfidenceCard.tsx`
- **FloatingBadge**: Server Component; props `label: string`, `variant: 'high' | 'medium' | 'low'`; renders as `<div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-layered flex items-center gap-2">` with `<Badge variant={variant}>` and label text; used as overlay on product images
- **ConfidenceCard**: Server Component; props `level: 'HIGH' | 'MEDIUM' | 'LOW'`, `title: string`, `description: string`, `dict: Dict['trustEngine']['cards'][number]`; renders on dark background with `<Badge>` for level + title + description; HIGH: emerald accents; MEDIUM: amber accents; LOW: rose accents; subtle top border in accent color (`border-t-2`)
- TDD: `__tests__/features/ConfidenceCard.test.tsx` — renders level badge, title, description; correct color class per level
- Dependency: Steps 0.5

**Step 2.2 — TrustEngineSection**
- Files: `packages/landing/src/components/sections/TrustEngineSection.tsx`
- Server Component
- Props: `dict: Dict['trustEngine']`
- Layout: full-width `bg-slate-950 text-white` section; inner `max-w-6xl mx-auto px-6 py-24 lg:py-32`
- Eyebrow: text-orange-300 (not brand-orange — lightened for dark bg)
- H2: text-white text-4xl lg:text-5xl font-bold
- Subtitle: text-slate-400
- 3 `<ConfidenceCard>` components in a responsive grid: `grid-cols-1 md:grid-cols-3 gap-6 mt-12`
- Allergen guardrail callout (below cards): `border border-orange-500/40 bg-orange-500/10 rounded-2xl p-6 mt-8`; orange icon; "Guardrail de alérgenos" title in text-orange-300; description in text-slate-300
- Optional image: `4.png` (huevos rotos with L1 badge) floated on the right at xl+; `<Image>` with `rounded-3xl object-cover`; hidden on tablet/mobile to avoid clutter
- TDD: `__tests__/sections/TrustEngineSection.test.tsx` — renders dark section, 3 confidence cards, allergen callout, allergen text present
- Dependency: Step 2.1, 0.6

**Step 2.3 — ForWhoSection**
- Files: `packages/landing/src/components/sections/ForWhoSection.tsx`, `packages/landing/src/components/features/ProfileCard.tsx`
- Both Server Components
- **ProfileCard** props: `title: string`, `description: string`, `imageSrc: string`, `imageAlt: string`
- ProfileCard layout: `rounded-2xl overflow-hidden bg-white shadow-soft`; image at top (`aspect-[4/3] object-cover`); content area with title (font-semibold text-lg) and description (text-slate-600 text-sm)
- **ForWhoSection**: ivory background; 2x2 grid on lg+ (`grid-cols-2 gap-8`), single column on mobile; `max-w-5xl mx-auto`
- 4 profiles and their images:
  - "El foodie consciente" — `Gemini_Generated_Image_epj9se*.png` (CrossFit guy)
  - "La familia segura" — `7.png` (mother+child, "Sin Gluten" badge)
  - "Quien cuida su salud" — placeholder from available images (use `3.png` — pulpo overhead — as fallback; note in code that a senior-profile image is preferred for future iteration)
  - "El profesional que viaja" — placeholder (use `4.png` as fallback; note future image needed)
- All images: `<Image>` with explicit `width/height`, `alt` describing the scene, `loading="lazy"` (no priority here)
- TDD: `__tests__/sections/ForWhoSection.test.tsx` — renders 4 profile cards; each card has a title and an image with alt text
- Dependency: Steps 0.5, 2.1, 0.6

**Step 2.4 — EmotionalBlock**
- Files: `packages/landing/src/components/sections/EmotionalBlock.tsx`
- Server Component
- Layout: **asymmetric** — NOT centered. On lg+: 2-column where left column (7/12 width) has text content and right column (5/12) has the image. On mobile: image first, then text stacked. Use CSS Grid or Flexbox with explicit `lg:col-span-7` / `lg:col-span-5`.
- Background: ivory or very subtle warm gradient
- H2: `text-4xl lg:text-5xl font-bold text-slate-900` (no eyebrow on this section — it's a pause, not a pitch)
- 3 scenario items: each rendered as `<li>` with a large soft checkmark (text-brand-green) and the scenario text in text-xl text-slate-700
- Scenarios (from `es.ts`): "Mirar la carta con más calma, sin calcular de cabeza." / "No improvisar delante del grupo cuando estás a dieta." / "Elegir lo que encaja contigo sin sentirte fuera del plan."
- Image: `3.png` (pulpo á feira overhead, warm atmosphere); `rounded-3xl object-cover`; `sizes="(max-width: 1024px) 100vw, 41vw"`
- TDD: `__tests__/sections/EmotionalBlock.test.tsx` — renders H2, renders all 3 scenarios, renders image with alt text
- Dependency: Steps 0.3, 0.6

**Step 2.5 — ComparisonSection**
- Files: `packages/landing/src/components/sections/ComparisonSection.tsx`
- Server Component
- Layout: 3 cards side by side on lg+ (`grid-cols-3 gap-6`), stacked on mobile; bg-slate-50 section
- Each card: `<Card>` with header (competitor name + category label), problem description (text-slate-600), and a "vs nutriXplorer" callout at the bottom with brand-green accent
- Cards:
  1. "Apps de nutrición" (MyFitnessPal, Fitia) — "Pensadas para casa. Fuera de casa, datos parciales y errores del 41%." — nutri adds: nivel de confianza explicit
  2. "Apps de restaurantes" (TheFork, TripAdvisor) — "Reseñas y reservas, sí. Información nutricional, ninguna." — nutri adds: información nutricional integrada
  3. "Improvisar" — "Estimar de memoria. Sin saber si aciertas. Sin nivel de confianza." — nutri adds: estimación transparente con nivel explícito
- Each card has a subtle "❌" indicator for the competitor downside and "✓ nutriXplorer" for the differentiator
- TDD: `__tests__/sections/ComparisonSection.test.tsx` — renders 3 cards; each has a competitor name; each has a differentiator message
- Dependency: Steps 0.5, 0.6

---

#### Phase 3 — Conversion + SEO + Polish

**Step 3.1 — WaitlistCTASection**
- Files: `packages/landing/src/components/sections/WaitlistCTASection.tsx`
- `'use client'` (because it contains WaitlistForm)
- Props: `dict: Dict['waitlistCta']`
- Layout: full-width section; background options (from `ai-specs/design-guidelines.md`): either botanical green gradient or a darkened overlay of the tortilla image (`Gemini_Generated_Image_wlmwae*.png`). Default to a gradient from `bg-brand-green to-slate-900` if design guidelines not yet available.
- Content: centered, max-w-2xl, H2 (text-white), subtitle (text-white/80), `<WaitlistForm source="cta" />`, final trust element: "Proyecto open source. Transparente por diseño." (text-white/60 text-sm)
- TDD: `__tests__/sections/WaitlistCTASection.test.tsx` — renders H2, renders WaitlistForm, renders trust element text
- Dependency: Steps 1.8, 0.6

**Step 3.2 — Footer**
- Files: `packages/landing/src/components/sections/Footer.tsx`
- Server Component (note: contains `<WaitlistForm>` Client Component as child — serializable props only across the boundary)
- Props: `variant: Variant`, `dict: Dict['footer']`
- Layout: dark bg (bg-slate-900 text-slate-400); `py-16 px-6`; inner divided into top row (logo + links), secondary waitlist area, and bottom row (legal + copyright)
- Logo: "nutriXplorer" in text-white font-bold with small green dot or leaf icon
- Tagline: "Conoce lo que comes" in text-slate-500 text-sm
- Link groups:
  - Legal: "Política de privacidad", "Política de cookies", "Términos de uso" — all link to `#` placeholder
  - Product: "¿Eres restaurante?" → `#`
  - Open source: GitHub icon + link (use actual GitHub URL from project or `#` placeholder)
- Secondary waitlist: includes `<WaitlistForm source="footer" variant={variant} />` with a brief heading (e.g. "¿Te lo perdiste arriba?") above it. The `variant` prop is passed through so the footer form fires analytics with the correct variant.
- "Hecho en España" — text-slate-500 with ES flag emoji
- Copyright: `© 2026 nutriXplorer` — text-slate-600 text-xs
- TDD: `__tests__/sections/Footer.test.tsx` — renders logo, renders copyright year, renders privacy policy link, renders "¿Eres restaurante?" link, renders secondary WaitlistForm
- Dependency: Steps 0.3, 0.6

**Step 3.3 — Sitemap + Robots**
- Files: `packages/landing/src/app/sitemap.ts`, `packages/landing/src/app/robots.ts`
- **sitemap.ts**: exports default function returning `MetadataRoute.Sitemap` array with `[{ url: SITE_URL, lastModified: new Date(), priority: 1.0 }]` — no language alternates (Spanish-only in F039; no `/en` route)
- **robots.ts**: exports default function returning `MetadataRoute.Robots` with `{ rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE_URL}/sitemap.xml` }`
- TDD: none required for these; verify manually that `/sitemap.xml` and `/robots.txt` respond correctly after build
- Dependency: Step 1.5 (uses SITE_URL)

**Step 3.4 — opengraph-image**
- Files: `packages/landing/src/app/opengraph-image.tsx`
- Server-generated OG image using Next.js `ImageResponse`
- Size: `{ width: 1200, height: 630 }`
- Content: brand green background, "nutriXplorer" in white large text, subtitle in white/80, orange accent bar at bottom
- Alt text: "nutriXplorer — Información nutricional de restaurantes en España"
- TDD: none required
- Dependency: Step 0.3

**Step 3.5 — Copy images to public/**
- Files: `landing/public/images/` directory
- Copy from `/Users/pb/Developer/FiveGuays/foodXPlorerResources/`:
  - `1.png` → `landing/public/images/hero-a.png` (Hero variant A)
  - `5.png` → `landing/public/images/hero-b.png` (Hero variant B)
  - `2.png` → `landing/public/images/how-it-works.png` (HowItWorks)
  - `3.png` → `landing/public/images/emotional-pulpo.png` (EmotionalBlock)
  - `4.png` → `landing/public/images/trust-huevos.png` (TrustEngine)
  - `7.png` → `landing/public/images/forwho-family.png` (ForWho — family)
  - `Gemini_Generated_Image_epj9se*.png` → `landing/public/images/forwho-fitness.png` (ForWho — fitness)
  - `Gemini_Generated_Image_wlmwae*.png` → `landing/public/images/trust-tortilla.png` (WaitlistCTA bg option)
- Update all `<Image src="">` paths to use the renamed files
- Add `next/image` `placeholder="blur"` with blurDataURL where feasible (generate with `plaiceholder` or use Next.js built-in for static imports)
- Verify no image exceeds 500KB after WebP conversion — if so, note for next iteration (Lighthouse score dependency)
- TDD: none. Verify `npm run build` succeeds and images appear in browser
- Dependency: Phases 1 and 2 complete

**Step 3.6 — Accessibility audit**
- No new files — review and patch existing components
- Checklist to verify:
  - Heading hierarchy: one `<h1>` (in HeroSection), `<h2>` in each major section, no skipped levels
  - All `<Image>` components have descriptive `alt` text (not empty, not redundant with surrounding text)
  - All interactive elements (buttons, inputs) have visible focus rings — Tailwind `focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2`
  - Color contrast: botanical green on white = WCAG AA pass (check with browser DevTools). Orange #FF8C42 on white = fail at small text — only use for large bold text or icons
  - WaitlistForm: `<label>` correctly associated to `<input>` via `htmlFor/id`; error message has `role="alert"`; submit button has accessible name
  - Footer links: each has descriptive text (not "click here")
  - SectionObserver wrapper: renders a plain `<div>` — verify it does not introduce unintended layout gaps (no `display: contents`)
  - ScrollTracker: no visible output, renders `null`
  - Verify `<html lang="es">` is set
- TDD: no new tests. Run existing test suite + `npm run build` + review Lighthouse accessibility score
- Dependency: All sections complete

**Step 3.7 — Responsive testing**
- No new files — visual review at 3 breakpoints
- Verify at: 375px (iPhone SE), 768px (iPad), 1440px (desktop)
- Key concerns:
  - HeroSection: 2-column collapses correctly to single column; image does not overflow
  - TrustEngineSection: 3 cards stack on mobile without overflow
  - ForWhoSection: 2x2 grid collapses to single column on mobile
  - EmotionalBlock: asymmetric layout collapses gracefully
  - ComparisonSection: 3 cards scroll horizontally on mobile (`overflow-x-auto`) or stack
  - Typography: no heading overflows its container on 375px
  - WaitlistForm: input is full-width on mobile, CTA button is also full-width
- TDD: no new tests. Visual inspection only.
- Dependency: All sections complete

---

### Testing Strategy

**Test files to create:**

| Test File | Type | Key Scenarios |
|-----------|------|---------------|
| `__tests__/ui/Button.test.tsx` | Unit | variants, onClick, isLoading spinner, disabled state |
| `__tests__/ui/Input.test.tsx` | Unit | renders label, shows error, controlled value |
| `__tests__/ui/Badge.test.tsx` | Unit | correct variant class |
| `__tests__/ui/Card.test.tsx` | Unit | renders children |
| `__tests__/WaitlistForm.test.tsx` | Unit (critical) | all states, validation, all GA4 events, retry after error |
| `__tests__/ScrollTracker.test.tsx` | Unit | threshold logic, no double-fire, cleanup |
| `__tests__/SectionObserver.test.tsx` | Unit | fires once, IntersectionObserver mock |
| `__tests__/CookieBanner.test.tsx` | Unit | renders on first visit, consent stored, dismisses after choice |
| `__tests__/analytics.test.ts` | Unit | dataLayer.push, UTM parsing, null safety |
| `__tests__/ab-testing.test.ts` | Unit | variant resolution logic; both random branches tested via injected deterministic function (0.3 → 'a', 0.7 → 'b') |
| `__tests__/api/waitlist.test.ts` | Unit | 200 on valid email, 400 on invalid email |
| `__tests__/sections/HeroSection.test.tsx` | Unit | A/B variants, events on mount, WaitlistForm present |
| `__tests__/sections/TrustEngineSection.test.tsx` | Unit | 3 cards, allergen callout |
| `__tests__/sections/WaitlistCTASection.test.tsx` | Unit | form present, H2 renders |
| `__tests__/sections/Footer.test.tsx` | Unit | logo, links, copyright, secondary WaitlistForm |
| Other sections | Smoke | render without error, key text present |

**Mocking strategy:**

- `window.dataLayer`: `Object.defineProperty(window, 'dataLayer', ...)` in `beforeEach`, reset in `afterEach`
- `fetch`: `jest.fn()` — mock at module level in WaitlistForm.test.tsx; simulate success/error by resolving/rejecting
- `IntersectionObserver`: define mock class in `jest.setup.ts` that calls callback immediately with `isIntersecting: true`
- `next/navigation` (`useRouter`, `useSearchParams`): mock with `jest.mock('next/navigation', () => ({ ... }))`
- `@vercel/analytics` and `@vercel/speed-insights`: mock with `jest.mock` returning empty components
- `next/image`: mock with `jest.mock('next/image', () => ({ default: (props) => <img {...props} /> }))`
- Cookie API: test `resolveVariant()` in isolation (pure function — no mocking needed); cookie-setting logic in `page.tsx` is server-side and covered by route-level smoke tests
- Server Components (ProblemSection, HowItWorksSection, etc.): test as plain async functions since they are async Server Components; pass mock `dict` prop

**Jest configuration** (`landing/jest.config.ts`):
- `testEnvironment: 'jsdom'`
- `setupFilesAfterEach: ['<rootDir>/jest.setup.ts']`
- `moduleNameMapper` for `@/*` path alias
- `transform` with `next/jest` transformer

---

### Key Patterns

**1. Dictionary-based i18n (no next-intl)**
All copy strings live in `src/lib/i18n/locales/es.ts`. Server Components call `getDictionary('es')` and pass slices down as props. Client Components receive their dict slice as a prop (never call `getDictionary` inside a Client Component). This avoids server/client boundary issues with next-intl and keeps the bundle lean.

Reference: `packages/landing/src/lib/i18n/index.ts` (Step 0.6)

**2. Variant resolution pattern**
`resolveVariant()` is a pure function tested in isolation. `page.tsx` (Server Component) reads the cookie via `cookies().get()` (read-only — Server Components in Next.js 14 cannot write cookies). The resolved `variant` is passed as a prop to `CookieBanner`, which writes the A/B cookie via `document.cookie` client-side ONLY after GDPR consent. All other Client Components read the variant from props only — never from cookies directly. This avoids hydration mismatches.

Reference: `packages/landing/src/lib/ab-testing.ts` (Step 1.3)

**3. Analytics event shape**
Every `trackEvent()` call must include `variant`, `lang`, and `referrer`. UTM params are optional but always read via `getUtmParams()`. The `AnalyticsEventPayload` type enforces this at compile time. No raw `dataLayer.push()` calls are allowed outside `analytics.ts`.

Reference: `packages/landing/src/lib/analytics.ts` (Step 1.2)

**4. Server vs Client split**
- Default to Server Component (no directive)
- Add `'use client'` only to: HeroSection, WaitlistForm, WaitlistCTASection, ScrollTracker, SectionObserver, CookieBanner
- All other section components are Server Components — they receive `dict` slices as props and render static HTML
- FloatingBadge and ConfidenceCard are Server Components (no interactivity)

**5. `'use client'` boundary gotcha**
When a Server Component contains a Client Component child (e.g., `WaitlistCTASection` which is Client because it contains `WaitlistForm`), ALL props passed across the boundary must be serializable. Never pass functions or class instances as props from Server to Client.

**6. Next.js 14 searchParams — synchronous access**
In Next.js 14 App Router, `searchParams` in a page component is a plain object (NOT a Promise). Access it directly as `searchParams.variant` — do NOT `await` it. (Next.js 15 changes this to async; this project targets Next.js 14.)

**7. Image sizing for Lighthouse**
All images must use `sizes` attribute to match actual render size. Hero image: `sizes="(max-width: 768px) 100vw, 50vw"`. Profile cards: `sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 25vw"`. Use `priority` ONLY on the hero image. All others use default lazy loading.

**8. Tailwind dark section override**
TrustEngineSection uses `bg-slate-950`. Child components inside it must not use light-bg-dependent utility classes. Pass a `dark` variant or override with explicit text-color props. Do not rely on Tailwind's `dark:` prefix (no dark mode toggle is needed — this section is always dark).

**9. Framer Motion reduced motion**
Always call `useReducedMotion()` in animated components. If it returns `true`, skip animation entirely (pass `initial={false}` or omit `animate`). This is required for accessibility and WCAG 2.1 compliance.

**10. Progressive enhancement for WaitlistForm**
The `<form>` element must use `action="/api/waitlist" method="POST"` as the native HTML fallback. The JavaScript-enhanced version intercepts `onSubmit` and uses `fetch`. The `/api/waitlist` route handles both `application/json` and `application/x-www-form-urlencoded` content types.

**11. Root workspace registration**
`landing/` must be added to the root `package.json` `workspaces` array before running `npm install` from the root. Without this, the workspace is not linked and imports between packages will fail.

---

### Anti-patterns to Avoid

- Do NOT import from `@foodxplorer/shared` or any other monorepo package — `landing/` is fully standalone
- Do NOT use Zustand — this page has no shared client-side state; component-local `useState` is sufficient
- Do NOT add `?variant=` to the canonical URL in metadata (SEO canonical should always point to the base URL)
- Do NOT use CSS-in-JS — all styling via Tailwind utility classes
- Do NOT make WaitlistForm a Server Component — it requires interactivity and must be `'use client'`
- Do NOT add `loading="eager"` to non-hero images — it will hurt Lighthouse score
- Do NOT use inline styles for design tokens — always use Tailwind config values
- Do NOT fire analytics events on the server — all `trackEvent()` calls must be inside Client Components or client-side `useEffect`

---

## Acceptance Criteria

- [x] `landing/` package created and added to root workspaces
- [x] All 9 sections render correctly on mobile and desktop
- [x] A/B hero variants switch via `?variant=a` and `?variant=b`
- [x] WaitlistForm handles all states (idle, loading, success, error)
- [x] ScrollTracker fires events at 25/50/75/100% scroll depth
- [x] SectionObserver fires section_view for each section
- [x] SEO: proper meta tags, JSON-LD, sitemap.ts, robots.ts
- [x] Vercel Analytics + Speed Insights integrated
- [x] All images use next/image with proper sizes and lazy loading (hero priority)
- [x] Lighthouse CI configured for CI but not yet measured against Vercel preview (no deployment yet)
- [x] `ui-components.md` updated with landing components
- [x] CookieBanner blocks GA4 and A/B cookie until user consents
- [x] Unit tests for WaitlistForm (validation, states, analytics events)
- [x] All tests pass (153 total, 151 passed, 2 todo), build succeeds, lint clean
- [x] TypeScript strict, no `any`

---

## Definition of Done

- [x] All acceptance criteria met
- [x] Unit tests written and passing
- [x] Code follows project standards (frontend-standards.mdc)
- [x] No linting errors
- [x] Build succeeds
- [x] ui-components.md reflects final implementation

---

## Workflow Checklist

- [x] Step 0: Spec created, ui-components.md updated
- [x] Step 1: Branch created, ticket generated, tracker updated
- [x] Step 2: frontend-planner executed, plan approved
- [x] Step 3: frontend-developer executed with TDD
- [x] Step 4: production-code-validator executed, quality gates pass
- [x] Step 5: code-review-specialist executed
- [x] Step 5: qa-engineer executed
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-25 | Steps 0-1: Spec + Setup | Ticket created, branch feature/F039-landing-page, tracker updated |
| 2026-03-25 | Step 2: Plan | Frontend-planner generated 20-step plan across 3 phases |
| 2026-03-25 | Spec reviewed by Gemini 2.5 + Codex GPT-5.4 | 3C+6I+3S found, all 12 addressed |
| 2026-03-25 | Plan reviewed by Gemini 2.5 + Codex GPT-5.4 | 1C+7I+5S found, all 13 addressed |
| 2026-03-26 | Step 3: Implement | Phase 0-3 complete, 130 tests, all 9 sections |
| 2026-03-26 | Step 4: Finalize | production-code-validator: 2C+2H+3M found, all fixed. 130->153 tests |
| 2026-03-26 | Step 5: Review | code-review-specialist: APPROVED with 3 minor fixes. QA: VERIFIED, 23 edge-case tests added |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, AC, DoD, Workflow, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 15/15 (Lighthouse noted as CI-only), DoD: 6/6, Workflow: 0-5/6 |
| 2. Product tracker | [x] | Active Session: F039 step 5/6, Features table updated |
| 3. key_facts.md | [x] | packages/landing documented as standalone Next.js 14 package (already present) |
| 4. decisions.md | [x] | N/A — Standard complexity, no ADR required |
| 5. Commit docs | [x] | All doc changes committed |
| 6. Clean working tree | [x] | `git status` shows clean tree |

---

*Ticket created: 2026-03-25*
