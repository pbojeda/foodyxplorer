# UI Component Specification

Define component hierarchies, props, state, and interactions BEFORE implementing.

<!-- CONFIG: Adjust component library references to match your stack -->

## Format

For each component, specify:

```markdown
### ComponentName

**Type**: Page | Layout | Feature | Primitive
**Client**: Yes/No (needs 'use client')

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| name | string | Yes | — | User display name |

**State:**
- `isLoading: boolean` — Loading state for async operations
- `error: string | null` — Error message

**Interactions:**
- Click submit → calls `onSubmit(formData)`
- Form validation → on blur + on submit

**Loading/Error/Empty States:**
- Loading: Skeleton placeholder
- Error: Alert with retry button
- Empty: Message with CTA
```

---

## Component Hierarchy

<!-- Add your component tree here as you design the UI -->

```
App
├── Layout
│   ├── Header
│   │   ├── Logo
│   │   └── Navigation
│   ├── Main (page content)
│   └── Footer
└── Pages
    └── [Define pages as you plan them]
```

---

## Landing Package — nutriXplorer (F039)

**Package:** `packages/landing/` | **Stack:** Next.js 14 App Router + TypeScript strict + Tailwind CSS + Framer Motion
**Deploy:** Vercel | **All code in English, user-facing copy in Spanish**

### Component Hierarchy

```
Landing App (landing/)
├── RootLayout (Server) — Inter font (next/font), global metadata, Vercel Analytics + Speed Insights
├── LandingPage (Server) — reads searchParams.variant, renders JSON-LD structured data
│   ├── HeroSection (Client) — A/B variants (a|b), Framer Motion entrance animation
│   │   ├── WaitlistForm (Client) — email input, idle/loading/success/error states, GA4 events
│   │   └── FloatingBadge (Server) — trust indicator overlay on product image
│   ├── ProblemSection (Server) — text only, no image
│   ├── HowItWorksSection (Server) — 3-step visual: Busca → Entiende → Decide
│   ├── TrustEngineSection (Server) — dark bg (slate-950), 3 confidence cards + allergen callout
│   ├── ForWhoSection (Server) — 4 user profile cards (fitness, family/allergies, senior/health, professional)
│   ├── EmotionalBlock (Server) — social/emotional scenes with real scenarios
│   ├── ComparisonSection (Server) — competitive cards vs fitness apps, restaurant apps, guessing
│   ├── WaitlistCTASection (Client) — final conversion section with WaitlistForm
│   └── Footer (Server) — legal links, secondary waitlist CTA
├── ScrollTracker (Client) — fires scroll_depth events at 25/50/75/100%
└── SectionObserver (Client) — IntersectionObserver per section, fires section_view events
```

### Component Specs

#### RootLayout
**Type:** Layout | **Client:** No (Server Component)

**Responsibilities:**
- Load Inter via `next/font/google` with `display: 'swap'`
- Set global CSS variables for design tokens (palette, spacing)
- Mount `<Analytics />` and `<SpeedInsights />` from @vercel/analytics
- Provide `<html lang="es">` and `<body>` wrappers

#### LandingPage
**Type:** Page | **Client:** No (Server Component)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| searchParams | `{ variant?: string }` | Yes | — | Next.js App Router searchParams |

**Responsibilities:**
- Resolve A/B variant: URL param wins over cookie; default 'a' if absent
- Set `variant` cookie (7-day, SameSite=Lax) via `cookies()` API
- Render JSON-LD structured data (WebSite + SoftwareApplication schemas)
- Compose all sections in order

#### HeroSection
**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `'a' \| 'b'` | Yes | — | A/B test variant |

**State:** None (stateless; delegates state to WaitlistForm)

**Interactions:**
- Framer Motion entrance: fade + slide-up on mount
- Variant A: image left, text right
- Variant B: centered layout with larger headline

**Analytics:** fires `landing_view` and `variant_assigned` on mount

#### WaitlistForm
**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| source | `string` | Yes | — | Identifies which form instance ('hero' \| 'cta') |

**State:**
- `email: string` — controlled input value
- `status: 'idle' \| 'loading' \| 'success' \| 'error'` — submission state
- `errorMessage: string | null` — inline validation or network error

**Interactions:**
- On focus → fires `waitlist_submit_start`
- On submit → validates email (Zod), calls `POST /api/waitlist`, transitions state
- On success → shows confirmation message
- On error → shows error with retry option

**Analytics events:** `hero_cta_click`, `waitlist_submit_start`, `waitlist_submit_success`, `waitlist_submit_error`

**Loading/Error/Empty States:**
- Loading: spinner in button, input disabled
- Error: inline error message below input, button re-enabled for retry
- Success: replaces form with confirmation message

#### FloatingBadge
**Type:** Primitive | **Client:** No (Server Component)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| label | `string` | Yes | — | Badge text |
| variant | `'high' \| 'medium' \| 'low'` | No | `'high'` | Confidence level styling |

#### ScrollTracker
**Type:** Utility | **Client:** Yes (`'use client'`)

**Props:** None (mounts once in RootLayout)

**Responsibilities:**
- Attaches a passive `scroll` event listener on `window`
- Fires `scroll_depth` GA4 event at 25%, 50%, 75%, 100% — each threshold fires once per session
- Uses `requestAnimationFrame` for performance

#### SectionObserver
**Type:** Utility | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sectionId | `string` | Yes | — | Identifies the section for the event payload |

**Responsibilities:**
- Uses `IntersectionObserver` with `threshold: 0.5`
- Fires `section_view` GA4 event once per section per page load

#### TrustEngineSection
**Type:** Feature | **Client:** No (Server Component)

**Responsibilities:**
- Dark background (bg-slate-950, text-white)
- Renders 3 ConfidenceCard sub-components (HIGH / MEDIUM / LOW)
- Integrated allergen guardrail callout at the bottom of the section

#### ProblemSection, HowItWorksSection, ForWhoSection, EmotionalBlock, ComparisonSection
**Type:** Feature | **Client:** No (Server Component)

All are pure Server Components with static copy and next/image images.

#### WaitlistCTASection
**Type:** Feature | **Client:** Yes (`'use client'`)

Contains a `<WaitlistForm source="cta" />` instance. Client because WaitlistForm is Client.

#### Footer
**Type:** Layout | **Client:** No (Server Component)

Contains legal links, secondary copy, and a lightweight email-only waitlist entry.

---

### Landing Primitives (landing/src/components/ui/)

| Component | Variants | Notes |
|-----------|----------|-------|
| `Button` | primary (orange #FF8C42), secondary (outline), ghost | Accepts `asChild` for link wrapping |
| `Input` | default, error | Email input with label and inline error state |
| `Badge` | high (green), medium (amber), low (slate) | Confidence level indicators |
| `Card` | default | Flexible container: header, content, footer slots |

---

## Landing Package — nutriXplorer (F044 updates)

**Feature:** F044 — Visual Overhaul + Multi-Variant A/B System

### Changes to Variant type

`Variant` is now `'a' | 'c' | 'd' | 'f'` (removed 'b'; fallback is always 'a').

### Updated HeroSection

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `Variant` | Yes | — | Determines layout and copy |
| dict | `Dictionary['hero']` | Yes | — | Shared hero copy |
| variantsCopy | `Dictionary['variants']` | No | — | Per-variant copy overrides |

**Variants:**
- **A** (default): 55/45 asymmetric, `hero-telegram-lentejas.png`, email-only WaitlistForm
- **C** (pain-first): Dark bg, no form, scroll CTA link to `#como-funciona`
- **D** (demo-first): Minimal header, SearchSimulator embedded via layout
- **F** (allergen): 55/45, `trust-allergen-family.png`, email-only WaitlistForm

### Updated WaitlistForm

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| source | `'hero' \| 'cta' \| 'footer' \| 'post-simulator'` | Yes | — | Form placement |
| variant | `Variant` | Yes | — | A/B variant |
| showPhone | `boolean` | No | `false` | Show optional phone field |

**Rule:** Phone field only shown in `WaitlistCTASection` (`showPhone={true}`). All other forms are email-only.

### Updated WaitlistCTASection

Adds `urgency` text ("Plazas limitadas...") and passes `showPhone={true}` to WaitlistForm.

### Updated EmotionalBlock (MAJOR REFACTOR)

Asymmetric 2-column layout:
- Left: `emotional-friends-dining.jpg` in card-surface frame
- Right: 3 scenario items (CheckCircle2 icons) + blockquote

### Updated AudienceGrid (MAJOR REFACTOR)

Image cards with darkened overlay:
- Each card uses a lifestyle photo background with gradient overlay
- Cards: `for-who-fitness-guy.jpg`, `trust-allergen-family.png`, `emotional-friends-dining.jpg`, `restaurants-map-street.jpg`

### Updated HowItWorksSection

- Step 1 shows `how-it-works-menu-scan.png` above the icon
- Now uses `SearchSimulatorWithCTA` instead of bare `SearchSimulator`
- Accepts optional `variant` prop (passed through to SearchSimulatorWithCTA)

### Updated TrustEngineSection

Allergen callout is now 2-column: text left, `trust-allergen-family.png` right (hidden on mobile).

### Updated RestaurantsSection

2-column layout: text left, `restaurants-map-street.jpg` right (hidden on mobile).

### Updated ProductDemo

Adds `demo-pulpo-feira.png` food photo above the app mockup.

### New: PostSimulatorCTA

**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `Variant` | Yes | — | For WaitlistForm |
| show | `boolean` | Yes | — | Whether to render (controlled by parent) |

**Behavior:** Email-only WaitlistForm with `source="post-simulator"`. Returns null when `show=false`.

### New: SearchSimulatorWithCTA

**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `Variant` | Yes | — | Passed to PostSimulatorCTA |

Wraps `SearchSimulator` + `PostSimulatorCTA`. Starts with `hasInteracted=true` since the simulator defaults to showing a result (pulpo a feira).

### New: VisualDivider

**Type:** Decorative | **Client:** No (Server Component)

Full-bleed horizontal strip (h-24) with blurred `emotional-friends-dining.jpg`. `aria-hidden="true"`. Used between EmotionalBlock and TrustEngine in Variant A.

### New Variant Layouts (page.tsx)

Each layout is a Server Component function:
- **VariantALayout**: Standard flow + VisualDivider between EmotionalBlock and TrustEngine
- **VariantCLayout**: EmotionalBlock moved up (amplifies pain before solution)
- **VariantDLayout**: ProductDemo and TrustEngine come before EmotionalBlock
- **VariantFLayout**: TrustEngine first (allergen guardrail is the star)

### Images added (public/images/)

| File | Source | Used in |
|------|--------|---------|
| `hero-telegram-lentejas.png` | 1.png | HeroSection (variant A) |
| `how-it-works-menu-scan.png` | 2.png | HowItWorksSection step 1 |
| `demo-pulpo-feira.png` | 3.png | ProductDemo |
| `trust-allergen-family.png` | 7.png | TrustEngineSection allergen, HeroSection F, AudienceGrid |
| `emotional-friends-dining.jpg` | 8.jpg | EmotionalBlock, AudienceGrid, VisualDivider |
| `demo-huevos-rotos.png` | 10.png | Available for future use |
| `restaurants-map-street.jpg` | 12.jpg | RestaurantsSection, AudienceGrid |
| `for-who-fitness-guy.jpg` | unnamed-10.jpg | AudienceGrid |

---

## Landing Package — nutriXplorer (F047 updates)

**Feature:** F047 — Landing Conversion Optimization

### Updated WaitlistForm (F047)

**New props:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| submitLabel | `string` | No | `'Únete a la waitlist'` | Submit button label |

**New behaviors (phone field):**
- `onFocus`: if phone is empty, auto-fills `+34` (no trailing space)
- `onBlur`: clears bare `+34` (no digits); prepends `+34` for bare 9-digit numbers; leaves other codes unchanged

### Updated WaitlistCTASection (F047)

**New behavior:**
- Fetches `GET ${NEXT_PUBLIC_API_URL}/waitlist/count` on mount
- Shows "Ya se han apuntado X personas" only when `count >= 10`
- Graceful degradation: counter hidden on fetch error or count < 10

### New: MobileMenu

**Type:** Feature | **Client:** Yes (`'use client'`)

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| navLinks | `{ label: string; href: string }[]` | Yes | — | Navigation links |
| ctaText | `string` | Yes | — | Desktop CTA text (passed from SiteHeader) |
| mobileCta | `string` | Yes | — | Mobile CTA button text |

**State:** `isOpen: boolean`

**Behaviors:**
- Hamburger button (3-line/X icon) — only visible `md:hidden`
- `aria-expanded` on button, `aria-controls` → panel id
- Panel: `block` when open, `hidden` when closed (CSS, no framer-motion)
- Closes on: nav link click, outside `mousedown`, `Escape` key
- SiteHeader remains a Server Component — MobileMenu is the only Client piece

### New: WaitlistSuccessBanner

**Type:** Feature | **Client:** Yes (`'use client'`) — requires `<Suspense fallback={null}>` in page.tsx

**Props:** None

**State:** `dismissed: boolean`

**Behavior:**
- Reads `?waitlist=success` via `useSearchParams()`
- Renders `role="status"` green banner with success message
- Dismiss button removes banner client-side only
- Used for no-JS success feedback (form POST redirect)
- Returns null if `waitlist` param absent or not `'success'`

### Updated SiteHeader (F047)

- CTA copy: `'Pedir acceso anticipado'` → `'Probar gratis'` (desktop)
- Mobile standalone `<a>Acceso</a>` removed; replaced by `<MobileMenu>` Client Component
- Constants `WAITLIST_CTA = 'Probar gratis'`, `MOBILE_CTA_TEXT = 'Probar'`

### Updated CookieBanner GA4 (F047)

The `onLoad` callback now properly bootstraps GA4:
1. `window.dataLayer = window.dataLayer || []`
2. `window.gtag = function(...args) { dataLayer.push(args) }`
3. `window.gtag('js', new Date())`
4. `window.gtag('config', GA_ID)`

Script tag has `id="ga4-script"` for onLoad callback identification.

---

## Landing + Web Package — nutriXplorer (F093 updates)

**Feature:** F093 — Web Assistant Landing Integration + Analytics

### Updated SiteHeader (F093)

**Type:** Layout | **Client:** No (Server Component — unchanged)

**Change:** Resolves `hablarUrl` from `process.env['NEXT_PUBLIC_WEB_URL']` at build time. When env var is set, the desktop CTA `<a>` targets the web assistant with UTM params. When unset, falls back to `#waitlist` (no broken link).

**Resolution:**
```
hablarUrl = NEXT_PUBLIC_WEB_URL
  ? NEXT_PUBLIC_WEB_URL + '/hablar?utm_source=landing&utm_medium=header_cta'
  : '#waitlist'
```

**Desktop CTA attributes when URL is configured:**
- `href`: resolved `hablarUrl`
- `target="_blank" rel="noopener noreferrer"`
- `data-cta-source="header"`

Passes `ctaHref={hablarUrl}` to `<MobileMenu>` (new prop).

---

### Updated MobileMenu (F093)

**Type:** Feature | **Client:** Yes (`'use client'` — unchanged)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| ctaHref | `string` | Yes | — | Resolved CTA URL — either external web assistant URL or `#waitlist` |

**Change:** Hardcoded `href="#waitlist"` on the mobile CTA `<a>` is replaced with `ctaHref`. `target="_blank" rel="noopener noreferrer"` applied conditionally when `ctaHref.startsWith('http')`.

---

### Updated HeroSection (F093)

**Type:** Feature | **Client:** Yes (`'use client'` — unchanged)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Resolved web assistant URL. Secondary CTA only rendered when this is a full URL (not `#waitlist`). |

**Change (Variant A only):** A secondary "Pruébalo ahora →" text-link is rendered below `<WaitlistForm>`. Style: `text-sm font-medium text-botanical underline underline-offset-2`. Fires `cta_hablar_click` with `source='hero'` on click. Not rendered for Variants C or F.

---

### Updated WaitlistCTASection (F093)

**Type:** Feature | **Client:** Yes (`'use client'` — unchanged)

**New prop:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Resolved web assistant URL. Subtle link only rendered when this is a full URL. |

**Change:** An "O pruébalo ahora gratis →" text-link is rendered below the social proof counter (when present) and above the trust note. Style: `text-sm text-botanical hover:underline`. Fires `cta_hablar_click` with `source='bottom'` on click. Applies to all three variant layouts.

---

### Updated RootLayout — web package (F093)

**Type:** Layout | **Client:** No (Server Component — unchanged)

**Package:** `packages/web/`

**Change:** Conditional GA4 script block injected into `<head>` when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set. Script uses `send_page_view: false` — page views are fired manually per route to capture UTM params.

No consent banner. No event queue. GA4 is treated as a functional analytics tool, not a marketing tracker, in the web package.

---

### New: HablarAnalytics — web package (F093)

**Type:** Utility | **Client:** Yes (`'use client'`)

**Package:** `packages/web/`

**Props:** None

**State:** None (fires once on mount, no ongoing state)

**Responsibilities:**
- Reads UTM params from `window.location.search` on mount
- Fires `hablar_page_view` via `window.gtag` if defined, with UTM params
- Mounted inside `hablar/page.tsx` (not inside `HablarShell` — keeps analytics concerns separate)

**Loading/Error/Empty States:** None — returns `null`. Fires and forgets. Silent if `window.gtag` undefined.

---

### Analytics Events Summary (F093)

#### Landing — new GA4 events

| Event | Trigger | Key Parameters |
|-------|---------|---------------|
| `cta_hablar_click` | Click on any of the 3 landing→web CTAs | `source: 'header'\|'hero'\|'bottom'`, `variant`, `utm_medium` |

Uses existing `trackEvent()`. Subject to consent check. Added to `AnalyticsEventName` union in `packages/landing/src/types/index.ts`.

#### Web — new GA4 events

| Event | Trigger | Key Parameters |
|-------|---------|---------------|
| `hablar_page_view` | `/hablar` route mounts (client-side) | `utm_source`, `utm_medium`, `utm_campaign` (from URL) |
| `hablar_query_sent` | User submits a query | _(none — no PII)_ |

Fires via `window.gtag` directly. Silent when `window.gtag` undefined.

---

## Shared UI Primitives

List the primitive components available in your project (e.g., from shadcn/ui):

- **Button** — Primary, secondary, outline, ghost variants
- **Input** — Text input with label and error state
- **Card** — Container with header, content, footer
- **Dialog** — Modal overlay
- **Table** — Data table with sorting and pagination
- **Select** — Dropdown selection
- **Badge** — Status indicators
- **Alert** — Feedback messages (success, error, warning, info)

---

## Landing Package — nutriXplorer (F039)

**Package:** `packages/landing/` | **Stack:** Next.js 14 App Router + TypeScript strict + Tailwind CSS + Framer Motion
**Deploy:** Vercel | **All code in English, user-facing copy in Spanish**

### Component Hierarchy

```
Landing App (landing/)
├── RootLayout (Server) — Inter font (next/font), global metadata, Vercel Analytics + Speed Insights
├── LandingPage (Server) — reads searchParams.variant, renders JSON-LD structured data
│   ├── HeroSection (Client) — A/B variants (a|b), Framer Motion entrance animation
│   │   ├── WaitlistForm (Client) — email input, idle/loading/success/error states, GA4 events
│   │   └── FloatingBadge (Server) — trust indicator overlay on product image
│   ├── ProblemSection (Server) — text only, no image
│   ├── HowItWorksSection (Server) — 3-step visual: Busca → Entiende → Decide
│   ├── TrustEngineSection (Server) — dark bg (slate-950), 3 confidence cards + allergen callout
│   ├── ForWhoSection (Server) — 4 user profile cards (fitness, family/allergies, senior/health, professional)
│   ├── EmotionalBlock (Server) — social/emotional scenes with real scenarios
│   ├── ComparisonSection (Server) — competitive cards vs fitness apps, restaurant apps, guessing
│   ├── WaitlistCTASection (Client) — final conversion section with WaitlistForm
│   └── Footer (Server) — legal links, secondary waitlist CTA
├── CookieBanner (Client) — GDPR consent banner; gates GA4 events + A/B cookie on accept
├── ScrollTracker (Client) — fires scroll_depth events at 25/50/75/100%
└── SectionObserver (Client) — IntersectionObserver per section, fires section_view events
```

### Landing Primitives (landing/src/components/ui/)

| Component | File | Client | Variants | Notes |
|-----------|------|--------|----------|-------|
| `Button` | `Button.tsx` | No | `primary` (orange), `secondary` (outline), `ghost` | forwardRef; `isLoading` shows spinner + disables; sizes `sm/md/lg` |
| `Input` | `Input.tsx` | No | default, error | Requires `label` + `id`; error renders `role="alert"` |
| `Badge` | `Badge.tsx` | No | `high` (emerald), `medium` (amber), `low` (rose) | Confidence level indicators |
| `Card` | `Card.tsx` | No | default | `rounded-2xl bg-white shadow-soft border-slate-100`; pass `className` to override |

#### Button Props
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `'primary' \| 'secondary' \| 'ghost'` | No | `'primary'` | Visual style |
| size | `'sm' \| 'md' \| 'lg'` | No | `'md'` | Size variant |
| isLoading | `boolean` | No | `false` | Shows spinner, disables interaction |

#### Input Props
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| label | `string` | Yes | — | Rendered as `<label>` associated via `htmlFor` |
| id | `string` | Yes | — | Required for label association |
| error | `string` | No | — | Inline error below input, `role="alert"` |

#### Badge Props
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| variant | `'high' \| 'medium' \| 'low'` | Yes | — | Maps to semantic color (emerald/amber/rose) |

### Feature Components

#### WaitlistForm (Client)
**Props:** `source: string` — identifies which instance fires events ('hero' | 'cta' | 'footer')

**State:** `status: 'idle' | 'loading' | 'success' | 'error'`, `email: string`, `errorMessage: string | null`

**Events fired:** `hero_cta_click`, `waitlist_cta_click`, `waitlist_submit_start`, `waitlist_submit_success`, `waitlist_submit_error`

#### CookieBanner (Client)
**Props:** `variant: 'a' | 'b'` — used to write the A/B cookie after consent is granted

On accept: stores `nx-cookie-consent=accepted` in localStorage, writes A/B cookie via `document.cookie`, loads GA4 script dynamically.
On reject: stores `nx-cookie-consent=rejected`, calls `deleteGaCookies()` to immediately expire all `_ga*` cookies. No GA4, no A/B cookie.
Exports `CONSENT_KEY = 'nx-cookie-consent'` for use by `CookieSettingsLink`.
Vercel Analytics is cookieless and runs unconditionally.

#### CookieSettingsLink (Client)
**File:** `src/components/analytics/CookieSettingsLink.tsx`
**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| label | string | Yes | — | Button text (i18n value from `dict.footer.cookieSettings`) |
| className | string | No | — | Additional Tailwind classes |

Renders a `<button>` that: (1) removes `nx-cookie-consent` from localStorage via `safeRemoveItem`, (2) calls `deleteGaCookies()` to immediately expire GA cookies, (3) calls `window.location.reload()` to re-show the CookieBanner.
Handles localStorage unavailability silently — reload still fires.
Used by: `Footer.tsx` (in legal nav), `privacidad/page.tsx`, `aviso-legal/page.tsx`, `cookies/page.tsx` (standalone footers).

#### HeroSection (Client)
**Props:** `variant: 'a' | 'b'`

Variant A: asymmetric 55/45 split (text left, image right). Variant B: centered layout, larger headline.
Fires `landing_view` + `variant_assigned` on mount.

#### TrustEngineSection (Server)
Dark background `bg-slate-950`. Contains 3 confidence level cards (HIGH/MEDIUM/LOW) + allergen guardrail callout.

---

## Pages

<!-- Define each page's component composition as you design them -->

### Landing Page (F039)

**Route:** `/` (root of the `packages/landing/` Next.js app)
**File:** `landing/src/app/page.tsx`
**Type:** Server Component

Composed of (in order): HeroSection, ProblemSection, HowItWorksSection, TrustEngineSection, ForWhoSection, EmotionalBlock, ComparisonSection, WaitlistCTASection, Footer.

Mounts per-page: `CookieBanner` (needs variant), `SectionObserver` (one per section).
Mounted in layout: `ScrollTracker`, `Analytics`, `SpeedInsights`.

---

*Update this file BEFORE implementing new components or pages.*

---

## Landing Package — v5 Overhaul (F044)

New components and updated sections for the v5 visual refresh. Glass-card aesthetic, SearchSimulator demo, and restructured page layout.

### New Design Tokens (Tailwind v5)

| Token | Value | Usage |
|-------|-------|-------|
| `botanical` | `#2D5A27` | Alias for `brand-green` |
| `energy` | `#FF8C42` | Alias for `brand-orange` |
| `paper` | `#F7F7F2` | Section backgrounds (replaces `ivory` in some sections) |
| `mist` | `#EEF4EC` | Light green tint backgrounds |
| `shadow-lift` | `0 18px 60px rgba(45,90,39,0.18)` | Elevated card shadow |
| `.card-surface` | `rounded-[32px] border border-white/70 bg-white/90 shadow-soft backdrop-blur` | Glass card component class |
| `.section-shell` | `mx-auto max-w-7xl px-5 md:px-8 lg:px-10` | Standard section container |
| `.accent-ring` | `ring-1 ring-green-200/30` | Subtle ring accent |

### New Components (F044)

#### SiteHeader
**Type:** Feature | **Client:** No (Server Component)
**File:** `src/components/SiteHeader.tsx`

Sticky top navigation with nutriXplorer logo, nav links (Demo, Cómo funciona, Para quién), and "Pedir acceso anticipado" CTA button. Mobile shows abbreviated CTA ("Acceso").

**Props:** None

#### SearchSimulator
**Type:** Feature | **Client:** Yes (`'use client'`)
**File:** `src/components/SearchSimulator.tsx`

Interactive demo with 10 pre-loaded dishes. Autocomplete dropdown, quick-select pills, 850ms loading animation, result card with macros grid + allergen guardrail.

**Props:** None (self-contained with DISHES data from `@/lib/content`)

**State:**
- `query: string` — current search input
- `state: 'idle' | 'loading' | 'result'` — simulator state
- `activeDish: Dish` — currently displayed dish
- `showDropdown: boolean` — autocomplete visibility

**Interactions:**
- Type → filters DISHES by query, shows autocomplete dropdown
- Select dish (pill or dropdown) → 850ms loading animation → result card
- "Ver resultado" button → runs first matching suggestion
- Unknown query → "No encontrado" message

#### ProductDemo
**Type:** Feature | **Client:** Yes (`'use client'`)
**File:** `src/components/ProductDemo.tsx`

Shows a real query flow timeline (3 steps: Usuario → Motor → Respuesta) plus an app mockup with L2 result for "Pulpo a feira". Uses Framer Motion `whileInView` animation.

**Props:** None

#### AudienceGrid
**Type:** Feature | **Client:** No (Server Component)
**File:** `src/components/AudienceGrid.tsx`

4-card grid for user profiles: Quien cuenta macros, Quien evita alérgenos, Quien busca equilibrio, Quien decide sobre la marcha. Each card links to #waitlist.

**Props:** None

#### Reveal
**Type:** Primitive | **Client:** Yes (`'use client'`)
**File:** `src/components/Reveal.tsx`

Scroll-triggered fade+slide animation wrapper using Framer Motion `whileInView`. Respects `prefers-reduced-motion`.

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| children | `React.ReactNode` | Yes | — | Content to animate |
| delay | `number` | No | `0` | Animation delay in seconds |
| className | `string` | No | — | Wrapper className |

#### RestaurantsSection
**Type:** Feature | **Client:** No (Server Component)
**File:** `src/components/sections/RestaurantsSection.tsx`

Minimal card section showing 3 restaurant types with confidence level notes. Uses `card-surface` glass card wrapper.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| dict | `Dictionary['restaurants']` | Yes | i18n copy |

#### FAQSection
**Type:** Feature | **Client:** No (Server Component)
**File:** `src/components/sections/FAQSection.tsx`

Accordion section with 6 FAQ items using native `<details>`/`<summary>` elements. All details share `name="faq"` for exclusive toggling (one open at a time). Returns null if items array is empty. No JavaScript required — progressive enhancement.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| dict | `Dictionary['faq']` | Yes | Accordion data: eyebrow, headline, items (6 Q&A pairs) |

**Structured Data:** `generateFAQPageSchema()` in `lib/seo.ts` produces FAQPage JSON-LD from the same dictionary items. Conditionally rendered in `page.tsx` when items exist.

**Analytics:** Wrapped by `SectionObserver` for `section_view` event tracking (conditionally, only when items exist).

### Updated Section Components (F044)

| Component | Change |
|-----------|--------|
| `HowItWorksSection` | Updated to `bg-paper`, uses `section-shell`, embeds `SearchSimulator` below steps |
| `TrustEngineSection` | Switched from dark `bg-slate-950` to light `bg-paper` card style with light-colored confidence badges |
| `ForWhoSection` | Replaced image profile cards with `AudienceGrid` component |
| `EmotionalBlock` | Replaced image+scenarios layout with glass-card list using `CheckCircle2` icons |
| `ComparisonSection` | Updated headline to v5 copy |
| `WaitlistForm` | Added optional phone field with validation (`/^\+\d{7,15}$/` stripped of spaces) |

### Updated Page Structure (F044)

New section order in `page.tsx`:
```
SiteHeader (sticky header, outside <main>)
HeroSection
ProductDemo (wrapped in section-shell)
HowItWorksSection (includes embedded SearchSimulator)
EmotionalBlock
TrustEngineSection
ForWhoSection (includes AudienceGrid)
ComparisonSection
RestaurantsSection
FAQSection (conditional — only if faq.items.length > 0)
WaitlistCTASection
Footer
```

### Data Layer

#### `src/lib/content.ts`
Contains `DISHES` array (10 pre-loaded dishes), `Dish` type, `getConfidenceBadgeClass()`, `getLevelDisplay()`.

#### `src/lib/i18n/locales/es.ts` — New Keys (F044)
- `productDemo`: eyebrow, headline, subtitle
- `searchSimulator`: eyebrow, headline, subtitle
- `restaurants`: eyebrow, headline, subtitle, items[]
- `audienceGrid`: eyebrow, headline

---

## Web Package — nutriXplorer (/hablar, F090)

**Package:** `packages/web/` | **Stack:** Next.js 15 App Router + TypeScript strict + Tailwind CSS (no Framer Motion)
**Route:** `/hablar` (single route for F090)
**Deploy:** Render (independent from landing) | **All code in English, user-facing copy in Spanish**
**Design reference:** `docs/specs/hablar-design-guidelines.md`

### Component Hierarchy

```
app/hablar/page.tsx (Server Component — metadata, shell render)
└── HablarShell (Client Component — owns all state)
    ├── AppBar
    ├── ResultsArea
    │   ├── EmptyState          (initial load, no results)
    │   ├── LoadingState        (API in flight — skeleton cards)
    │   ├── ErrorState          (API error or network failure)
    │   └── [NutritionCard...]  (results)
    │       ├── ConfidenceBadge
    │       └── [AllergenChip...]
    └── ConversationInput (fixed bottom)
        ├── <textarea>
        ├── PhotoButton         (disabled placeholder)
        ├── MicButton           (disabled placeholder)
        └── SubmitButton        (visible when text present)
```

### HablarShell

**Type:** Feature | **Client:** Yes (`'use client'`)
**File:** `src/components/HablarShell.tsx`

Top-level orchestrator component. Manages all page state and coordinates API calls.

**Props:** None

**State:**
- `query: string` — current textarea value
- `isLoading: boolean` — API request in flight
- `results: ConversationMessageData | null` — last successful API response
- `error: ErrorType | null` — discriminated error type (api | network | rate_limit | too_long)

**Interactions:**
- Submit (button click or Cmd+Enter): call `sendMessage(query, actorId)`, set `isLoading: true`, clear previous results/error
- On response: set `results`, `isLoading: false`
- On error: set `error`, `isLoading: false`
- Retry button in ErrorState: re-submits last query

**Layout:**
```
h-[100dvh] flex flex-col bg-white
├── AppBar (52px, optional)
├── ResultsArea (flex-1, overflow-y-auto, pb-[84px])
└── ConversationInput (fixed bottom-0)
```

### ConversationInput

**Type:** Feature | **Client:** Yes (`'use client'`)
**File:** `src/components/ConversationInput.tsx`

Fixed bottom input bar. Contains textarea + action buttons. Safe-area aware for iOS.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| value | `string` | Yes | Controlled textarea value |
| onChange | `(v: string) => void` | Yes | Text change handler |
| onSubmit | `() => void` | Yes | Submit handler |
| isLoading | `boolean` | Yes | Disables submit and textarea during API call |
| inlineError | `string \| null` | Yes | Inline error text (e.g. for text_too_long); null = no error |

**Styling:**
```
fixed bottom-0 left-0 right-0
bg-white border-t border-slate-200
px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]
backdrop-blur-sm
```

**Interactions:**
- `Enter` → submit (all devices; universal pattern, no mobile heuristic)
- `Shift+Enter` → newline (does not submit)
- Submit button click → submit
- `textarea` auto-resizes up to 3 lines

### MicButton

**Type:** Primitive | **Client:** No
**File:** `src/components/MicButton.tsx`

Voice trigger placeholder for F091. Visible but fully disabled in F090.

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| disabled | `boolean` | No | `true` | Always true in F090 |
| size | `'sm' \| 'lg'` | No | `'sm'` | 48px (sm) or 80px (lg, overlay variant) |

**Styling (F090 disabled state):**
```
rounded-full w-12 h-12 bg-slate-300 text-slate-400
cursor-not-allowed opacity-60
```

**Accessibility:** `aria-label="Micrófono (próximamente)"` `title="Próximamente"` `disabled`

### PhotoButton

**Type:** Primitive | **Client:** No
**File:** `src/components/PhotoButton.tsx`

Photo upload placeholder for F092. Visible but fully disabled in F090.

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| disabled | `boolean` | No | `true` | Always true in F090 |

**Styling:**
```
rounded-xl w-12 h-12 border border-slate-200 bg-white text-slate-400
cursor-not-allowed opacity-60
```

**Accessibility:** `aria-label="Foto (próximamente)"` `title="Próximamente"` `disabled`

### SubmitButton

**Type:** Primitive | **Client:** No
**File:** `src/components/SubmitButton.tsx`

Primary text submit action. Visible only when query is non-empty.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| onSubmit | `() => void` | Yes | Submit handler |
| isLoading | `boolean` | Yes | Disables button when true |

**Styling:**
```
rounded-xl w-12 h-12 bg-brand-orange text-white shadow-soft
hover:opacity-90 active:scale-[0.98] transition-all duration-200
disabled:opacity-40 disabled:pointer-events-none
```

**Accessibility:** `aria-label="Buscar"` `type="submit"`

### NutritionCard

**Type:** Feature | **Client:** No
**File:** `src/components/NutritionCard.tsx`

Primary result display unit. One card per resolved dish/food item.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | Yes | Dish/food display name |
| calories | `number` | Yes | kcal value |
| nutrients | `{ proteins: number; carbohydrates: number; fats: number; fiber?: number }` | Yes | Macro values |
| confidence | `'high' \| 'medium' \| 'low'` | Yes | For ConfidenceBadge |
| allergens | `string[]` | No | Allergen names; row hidden if empty/absent |
| source | `{ name: string; url?: string \| null }` | No | Attribution footer |
| index | `number` | No | Card index for stagger animation delay |

**Sections:**
- Header row: `name` (text-lg font-bold text-slate-800) + `<ConfidenceBadge confidence={confidence}>` (right)
- Calorie block: `calories` in `text-[28px] font-extrabold text-brand-orange` + "KCAL" label
- Macros row: Proteínas (brand-green) / Carbohidratos (amber) / Grasas (slate) — each `value text-lg font-bold` + `label text-[11px] uppercase`
- Allergens row: conditional, `flex flex-wrap gap-1.5`, `<AllergenChip>` per item
- Source footer: `border-t border-slate-100 text-[11px] text-slate-400`

**Animation:** CSS `card-enter` class (defined in `globals.css`). Uses `animationDelay: ${index * 0.08}s` inline style for stagger.

**Accessibility:** `<article aria-label="{name}: {calories} calorías">`

### ConfidenceBadge

**Type:** Primitive | **Client:** No
**File:** `src/components/ConfidenceBadge.tsx`

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| level | `'high' \| 'medium' \| 'low'` | Yes | Determines color and Spanish label |

**Variants:**
- `high` → `bg-emerald-50 text-emerald-800 border-emerald-200` — "Verificado"
- `medium` → `bg-amber-50 text-amber-800 border-amber-200` — "Estimado"
- `low` → `bg-rose-50 text-rose-800 border-rose-200` — "Aproximado"

**Styling:** `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border`

### AllergenChip

**Type:** Primitive | **Client:** No
**File:** `src/components/AllergenChip.tsx`

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| allergen | `string` | Yes | Allergen display name |

**Styling:** `inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[11px] font-semibold`

**Icon:** Small ⚠ SVG (12px) or unicode character fallback.

### LoadingState

**Type:** Feature | **Client:** No
**File:** `src/components/LoadingState.tsx`

1–3 skeleton cards while API call is in flight. Mirrors NutritionCard dimensions.

**Props:** None

**Accessibility:** `role="status" aria-label="Buscando información nutricional..."` — skeleton cards are `aria-hidden="true"`

**Skeleton elements (per card):**
- Title bar: `h-5 w-48 rounded-lg bg-slate-100 animate-shimmer`
- Calorie block: `h-9 w-24 rounded-lg bg-slate-100 animate-shimmer`
- Macro row: 3× `h-6 w-16 rounded-lg bg-slate-100 animate-shimmer`

**Animation:** `shimmer` keyframe defined in `globals.css` (see design guidelines §7.4). Disabled under `prefers-reduced-motion: reduce` (static `bg-slate-100`).

### EmptyState

**Type:** Feature | **Client:** No
**File:** `src/components/EmptyState.tsx`

Shown on first load before any query is submitted.

**Props:** None

**Content:**
- Headline: "¿Qué quieres saber?" (`text-[15px] font-medium text-slate-600 mt-4`)
- Subtext: "Escribe el nombre de un plato para conocer sus calorías." (`text-sm text-slate-400 mt-1.5 max-w-[280px] text-center`)

**Layout:** `flex flex-col items-center justify-center flex-1 px-8 text-center`

### ErrorState

**Type:** Feature | **Client:** No
**File:** `src/components/ErrorState.tsx`

Shown on API error or network failure.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| message | `string` | Yes | Context-sensitive Spanish error message |
| onRetry | `() => void` | Yes | Retry handler — re-sends last query |

**Copy examples (set by HablarShell):**
- `500 / generic` → "Algo salió mal. Inténtalo de nuevo."
- `NETWORK_ERROR` → "Sin conexión. Comprueba tu red."
- `RATE_LIMIT_EXCEEDED` → "Has alcanzado el límite diario de 50 consultas. Vuelve mañana."
- `text_too_long` → inline in ConversationInput (not this component)

**Layout:** Same as EmptyState. Warning triangle SVG `text-red-400` (32px). "Intentar de nuevo" secondary button.

### ContextConfirmation

**Type:** Feature | **Client:** No
**File:** `src/components/ContextConfirmation.tsx`

Shown when intent is `context_set`. Displays a chain name confirmation or ambiguity message.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| contextSet | `{ chainSlug: string; chainName: string } \| undefined` | Yes | Chain that was set; undefined when ambiguous |
| ambiguous | `boolean` | Yes | True when the chain was not uniquely resolved |

**Variants:**
- Confirmed: emerald-colored banner with "Contexto activo: [chainName]"
- Ambiguous: amber-colored banner with "No encontré ese restaurante. Prueba con el nombre exacto."

### ResultsArea

**Type:** Feature | **Client:** No
**File:** `src/components/ResultsArea.tsx`

Routes display to the correct component based on intent. Applies the responsive card grid.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| isLoading | `boolean` | Yes | Shows LoadingState when true |
| results | `ConversationMessageData \| null` | Yes | Last successful API response data |
| error | `string \| null` | Yes | Error message (shows ErrorState when set) |
| onRetry | `() => void` | Yes | Passed to ErrorState retry button |

**Intent routing:**
- `null` + not loading → EmptyState
- loading → LoadingState
- error → ErrorState
- `estimation` → 1× NutritionCard
- `comparison` → 2× NutritionCard (side by side on tablet+)
- `menu_estimation` → N× NutritionCard (one per item; totals card deferred to F093)
- `context_set` → ContextConfirmation
- `reverse_search` → N× NutritionCard from results; empty message if 0 results
- `text_too_long` → EmptyState (inline error is in ConversationInput)

**Layout:** `grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:max-w-2xl lg:mx-auto`

### Data Layer

#### `src/lib/actorId.ts`
Manages anonymous actor UUID lifecycle.

Exports:
- `getActorId(): string` — reads from `localStorage['nxi_actor_id']`; generates + persists a new `crypto.randomUUID()` if absent; falls back to in-memory UUID if `localStorage` throws (SSR, private browsing, quota exceeded).
- `persistActorId(id: string): void` — writes to `localStorage['nxi_actor_id']`; no-op on error.

#### `src/lib/apiClient.ts`
Typed fetch wrapper for `POST /conversation/message`.

Exports:
- `sendMessage(text: string, actorId: string, signal?: AbortSignal): Promise<ConversationMessageResponse>`
  - Reads `NEXT_PUBLIC_API_URL` for base URL (throws descriptive error if unset)
  - Sets `Content-Type: application/json`, `X-Actor-Id`, `X-FXP-Source: web` headers
  - Applies 15-second hard timeout via `AbortSignal.any([signal, AbortSignal.timeout(15000)])` (or `AbortSignal.timeout(15000)` when no external signal)
  - Reads `X-Actor-Id` from response headers and calls `persistActorId` when it differs
  - Throws `ApiError` on non-2xx responses and malformed JSON; re-throws `DOMException(AbortError)` directly
- `ApiError` — typed error class with `.code: string` and `.status: number | undefined`

Imports response types from `@foodxplorer/shared` — no type duplication.

### CSS Animations (globals.css additions)

```css
@keyframes card-enter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.card-enter {
  animation: card-enter 0.35s ease-out forwards;
}

@keyframes shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
.animate-shimmer {
  background: linear-gradient(90deg, #f1f5f9 0px, #e2e8f0 40px, #f1f5f9 80px);
  background-size: 200px 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .card-enter { animation: none; opacity: 1; transform: none; }
  .animate-shimmer { animation: none; background: #f1f5f9; }
}
```

---

## F093 — Landing Integration + Analytics

### HeaderCTA (landing)

**Type**: Feature | **Client**: Yes (`'use client'` — onClick analytics handler)
**File**: `packages/landing/src/components/HeaderCTA.tsx`

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarBaseUrl | `string \| null` | Yes | — | Base web URL or null when unconfigured |
| variant | `Variant` | Yes | — | Current A/B variant for analytics |

**Behavior:**
- When `hablarBaseUrl` is set: `href = hablarBaseUrl + '?utm_source=landing&utm_medium=header_cta'`, `target="_blank"`, fires `cta_hablar_click`
- When `hablarBaseUrl` is null: `href="#waitlist"`, no `target`, no analytics
- Styling: `rounded-full bg-botanical px-4 py-2 text-sm font-semibold text-white`

### SiteHeader (landing) — modified

**Type**: Layout | **Client**: No (Server Component)
**File**: `packages/landing/src/components/SiteHeader.tsx`

**New Props (F093):**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarBaseUrl | `string \| null` | Yes | — | Resolved web URL (with /hablar path), or null |
| variant | `Variant` | Yes | — | Current A/B variant passed to HeaderCTA and MobileMenu |

**Change**: Replaced inline `<a href="#waitlist">` desktop CTA with `<HeaderCTA>` Client Component. Passes `ctaHref` and `variant` to `<MobileMenu>`.

### MobileMenu (landing) — modified

**New Props (F093):**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| ctaHref | `string` | Yes | — | Resolved CTA href (external URL or `#waitlist`) |
| variant | `Variant` | Yes | — | A/B variant for analytics event |

**Change**: CTA `<a>` uses `ctaHref` prop. `target="_blank" rel="noopener noreferrer"` set when `ctaHref.startsWith('http')`. Fires `cta_hablar_click` on click when external; no analytics on `#waitlist` fallback.

### HeroSection (landing) — modified

**New Prop (F093):**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Full URL with UTM params. When absent or `#waitlist`, CTA not rendered |

**Change**: Variant A only renders secondary `<a>Pruébalo ahora →</a>` below `<WaitlistForm>` when `hablarUrl` is truthy and not `#waitlist`. Variants C and F unchanged.
**Style**: `text-sm font-medium text-botanical underline underline-offset-2 hover:text-botanical/80`

### WaitlistCTASection (landing) — modified

**New Props (F093):**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hablarUrl | `string` | No | `undefined` | Full URL with UTM params. When absent or `#waitlist`, CTA not rendered |

**Change**: Renders `<a>O pruébalo ahora gratis →</a>` below social proof counter when `hablarUrl` is set. Fires `cta_hablar_click` with `source='bottom'`.
**Style**: `text-sm text-botanical hover:underline`

### HablarAnalytics (web)

**Type**: Feature | **Client**: Yes (`'use client'` — useSearchParams + useEffect)
**File**: `packages/web/src/components/HablarAnalytics.tsx`

**Props**: None

**Behavior:**
- Uses `useSearchParams()` to read UTM params from URL on mount
- Pushes `{ event: 'hablar_page_view', utm_source, utm_medium, utm_campaign }` to `window.dataLayer`
- Uses `(window.dataLayer = window.dataLayer || []).push(...)` init pattern
- Returns null (no DOM output)
- Must be wrapped in `<Suspense fallback={null}>` at call site (Next.js App Router requirement for useSearchParams)
