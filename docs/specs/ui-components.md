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
On reject: stores `nx-cookie-consent=rejected`. No GA4, no A/B cookie.
Vercel Analytics is cookieless and runs unconditionally.

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

