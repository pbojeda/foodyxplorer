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
