# Design Guidelines — nutriXplorer Landing Page (F039)

**Version:** 1.0
**Created:** 2026-03-25
**Status:** Approved
**Applies to:** `packages/landing/` package only

> Single source of truth for all visual and interaction decisions.
> Frontend developers: reference this document for every spacing value, color choice, animation curve, and layout decision.

---

## 1. Visual Direction

**Style:** Modern Wellness + Premium Tech
A blend of Apple product-page clarity (hierarchy, rhythm, breathing room) and Google Antigravity credibility (contemporary, operational, trustworthy). The result should feel warm, confident, and premium — never clinical, fitness-bro, or overhyped.

**Mood keywords:** serene, transparent, empowering, premium-but-approachable, alive, contemporary.

**Key principle:** The page must NOT look AI-generated. Every section must feel deliberately designed, not templated. This means:
- Asymmetric layouts where appropriate (not everything centered)
- Varied visual rhythm between sections (alternating widths, image positions, padding)
- Micro-interactions that feel intentional and section-specific
- Each section has its own personality while sharing the same design system

---

## 2. Colors

### 2.1 Core Palette

| Token | Hex | Tailwind Class | Role |
|-------|-----|----------------|------|
| `brand-green` | `#2D5A27` | `bg-brand-green` / `text-brand-green` | Primary trust color. Headings emphasis, verification badges, icons |
| `brand-orange` | `#FF8C42` | `bg-brand-orange` / `text-brand-orange` | CTA buttons, energy accents, hover states |
| `ivory` | `#FDFBF7` | `bg-ivory` | Default page background. Warm, premium, breathing room |
| `slate-950` | `#0F172A` | `bg-slate-950` | Dark sections (TrustEngine). High contrast, dramatic |
| `slate-700` | `#334155` | `text-slate-700` | Primary body text color |
| `slate-500` | `#64748B` | `text-slate-500` | Secondary text, captions, metadata |
| `slate-300` | `#CBD5E1` | `border-slate-300` | Borders, dividers, input defaults |
| `slate-100` | `#F1F5F9` | `bg-slate-100` / `border-slate-100` | Card borders, subtle backgrounds |
| `white` | `#FFFFFF` | `bg-white` | Card surfaces, form backgrounds |

### 2.2 Semantic Colors (Confidence Levels)

| Level | Background | Text | Border | Usage |
|-------|-----------|------|--------|-------|
| HIGH | `#D1FAE5` (emerald-100) | `#065F46` (emerald-800) | `#A7F3D0` (emerald-200) | Verified data badge |
| MEDIUM | `#FEF3C7` (amber-100) | `#92400E` (amber-800) | `#FDE68A` (amber-200) | Estimated data badge |
| LOW | `#FFE4E6` (rose-100) | `#9F1239` (rose-800) | `#FECDD3` (rose-200) | Similarity-based badge |

### 2.3 Interactive Colors

| State | Value | Usage |
|-------|-------|-------|
| CTA hover | `#FF8C42` at `opacity: 0.90` | Primary button hover |
| CTA active | `#E07A35` | Primary button pressed (darken 12%) |
| Focus ring | `#2D5A27` at `ring-2 ring-offset-2` | All focusable elements |
| Error | `#EF4444` (red-500) | Form validation errors |
| Success | `#10B981` (emerald-500) | Form success feedback |
| Link hover | `#2D5A27` with `underline-offset-4` | Text links |

### 2.4 Gradient Definitions

| Name | Value | Usage |
|------|-------|-------|
| Hero radial | `radial-gradient(ellipse at 30% 20%, rgba(45,90,39,0.06) 0%, transparent 60%)` | Hero section background overlay on ivory |
| CTA atmospheric | `linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)` | WaitlistCTA section background |
| Dark section glow | `radial-gradient(ellipse at 50% 0%, rgba(45,90,39,0.15) 0%, transparent 50%)` | Subtle green glow on TrustEngine dark bg |

---

## 3. Typography

### 3.1 Font Stack

```
font-family: var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif;
```

Loaded via `next/font/google` with `display: 'swap'`, `subsets: ['latin']`.

### 3.2 Type Scale

| Element | Size (mobile) | Size (desktop) | Weight | Letter-spacing | Line-height | Tailwind |
|---------|--------------|----------------|--------|---------------|-------------|----------|
| H1 (Hero) | `36px` | `64px` | `800` | `-0.025em` | `1.1` | `text-4xl md:text-7xl font-extrabold tracking-tighter leading-tight` |
| H1 variant (Hero B) | `40px` | `72px` | `800` | `-0.03em` | `1.05` | `text-[40px] md:text-[72px] font-extrabold` |
| H2 (Section) | `28px` | `44px` | `700` | `-0.02em` | `1.2` | `text-3xl md:text-[44px] font-bold tracking-tight leading-snug` |
| H3 (Subsection) | `22px` | `28px` | `700` | `-0.015em` | `1.3` | `text-xl md:text-[28px] font-bold` |
| H4 (Card title) | `18px` | `20px` | `600` | `normal` | `1.4` | `text-lg md:text-xl font-semibold` |
| Eyebrow | `13px` | `14px` | `600` | `0.05em` | `1.5` | `text-[13px] md:text-sm font-semibold tracking-widest uppercase` |
| Lead paragraph | `18px` | `20px` | `400` | `normal` | `1.65` | `text-lg md:text-xl leading-relaxed` |
| Body | `16px` | `16px` | `400` | `normal` | `1.65` | `text-base leading-relaxed` |
| Body emphasis | `16px` | `16px` | `500` | `normal` | `1.65` | `text-base font-medium` |
| Caption | `13px` | `14px` | `400` | `normal` | `1.5` | `text-[13px] md:text-sm` |
| Button (primary) | `16px` | `16px` | `600` | `0.01em` | `1` | `text-base font-semibold` |
| Button (sm) | `14px` | `14px` | `600` | `0.01em` | `1` | `text-sm font-semibold` |

### 3.3 Maximum Widths for Readability

| Context | `max-width` | Tailwind |
|---------|------------|----------|
| Headline (H1) | `720px` | `max-w-[720px]` |
| Section headline (H2) | `640px` | `max-w-[640px]` |
| Body paragraph | `580px` | `max-w-[580px]` |
| Lead paragraph (hero sub) | `520px` | `max-w-[520px]` |

---

## 4. Spacing & Layout

### 4.1 Container

| Property | Value | Tailwind |
|----------|-------|----------|
| Max width | `1200px` | `max-w-[1200px]` |
| Horizontal padding (mobile) | `20px` | `px-5` |
| Horizontal padding (tablet+) | `32px` | `md:px-8` |
| Horizontal padding (desktop) | `40px` | `lg:px-10` |
| Center | `margin: 0 auto` | `mx-auto` |

### 4.2 Section Spacing

Sections use VARIED vertical padding to create rhythm. NOT uniform.

| Section | Top padding | Bottom padding | Notes |
|---------|------------|---------------|-------|
| Hero | `96px` mobile / `128px` desktop | `64px` / `96px` | Extra top for visual weight |
| Problem | `80px` / `96px` | `80px` / `96px` | Generous — breathing room |
| HowItWorks | `64px` / `80px` | `64px` / `80px` | Tighter — connected to problem |
| TrustEngine | `80px` / `112px` | `80px` / `112px` | Extra generous — dramatic star section |
| ForWho | `64px` / `80px` | `64px` / `80px` | Standard |
| EmotionalBlock | `80px` / `96px` | `80px` / `96px` | Generous — emotional breathing |
| Comparison | `64px` / `80px` | `64px` / `80px` | Standard |
| WaitlistCTA | `80px` / `112px` | `80px` / `112px` | Extra generous — conversion focus |
| Footer | `48px` / `64px` | `32px` / `48px` | Compact, grounded |

Tailwind shorthand: `py-20 md:py-24` = `80px` / `96px`, `py-16 md:py-20` = `64px` / `80px`, etc.

### 4.3 Component Spacing

| Element | Value | Tailwind |
|---------|-------|----------|
| Gap between section eyebrow and H2 | `12px` | `mb-3` |
| Gap between H2 and lead paragraph | `20px` | `mt-5` |
| Gap between lead paragraph and content | `40px` | `mt-10` |
| Card internal padding | `24px` mobile / `32px` desktop | `p-6 md:p-8` |
| Card gap in grid | `24px` | `gap-6` |
| Between form label and input | `6px` | `mb-1.5` |
| Between input and error message | `6px` | `mt-1.5` |
| Between CTA button and microcopy | `12px` | `mt-3` |
| Icon to text (inline) | `12px` | `gap-3` |
| Step number to step content | `16px` | `gap-4` |

### 4.4 Grid Systems

| Layout | Mobile | Tablet (md) | Desktop (lg) |
|--------|--------|-------------|--------------|
| HowItWorks steps | 1 col | 3 cols | 3 cols |
| TrustEngine cards | 1 col | 3 cols | 3 cols |
| ForWho profiles | 1 col | 2 cols | 2x2 grid |
| Comparison cards | 1 col | 3 cols | 3 cols |
| Hero (variant A) | 1 col (stacked) | 2 cols (text L / image R) | 2 cols (55% / 45%) |
| Hero (variant B) | 1 col (centered) | 1 col (centered, wider) | 1 col (centered, max-w-3xl) |
| EmotionalBlock | 1 col (stacked) | 2 cols (alternating) | 2 cols (alternating, 50/50) |

### 4.5 Breakpoints

Standard Tailwind defaults:
| Name | Min-width |
|------|-----------|
| `sm` | `640px` |
| `md` | `768px` |
| `lg` | `1024px` |
| `xl` | `1280px` |

Primary breakpoints used: `md` (tablet), `lg` (desktop). Mobile is the default.

---

## 5. Component Styles

### 5.1 Buttons

**Primary (CTA):**
```
bg-brand-orange text-white font-semibold
rounded-xl px-8 py-3.5
shadow-soft hover:opacity-90 active:scale-[0.98]
transition-all duration-200
focus:ring-2 focus:ring-brand-green focus:ring-offset-2
disabled:opacity-50 disabled:pointer-events-none
```

**Secondary (Outline):**
```
border border-slate-300 bg-transparent text-slate-700
rounded-xl px-6 py-3
hover:border-slate-400 hover:bg-slate-50
transition-all duration-200
```

**Ghost:**
```
bg-transparent text-slate-600
rounded-lg px-4 py-2
hover:bg-slate-100 hover:text-slate-800
transition-all duration-150
```

### 5.2 Input (Email)

```
bg-white border border-slate-300 text-slate-700
rounded-xl px-4 py-3.5 text-base
placeholder:text-slate-400
focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 focus:outline-none
transition-colors duration-200
```

Error state: `border-red-500 focus:ring-red-500/20`

### 5.3 Cards

**Default card:**
```
bg-white rounded-2xl border border-slate-100
shadow-soft p-6 md:p-8
```

**Elevated card (TrustEngine on dark bg):**
```
bg-slate-900 rounded-2xl border border-slate-800
shadow-layered p-6 md:p-8
```

**Profile card (ForWho):**
```
bg-white rounded-2xl border border-slate-100
shadow-soft overflow-hidden
```
Image: `aspect-[4/3] object-cover` in top portion, content in bottom `p-6`.

### 5.4 Badge

```
inline-flex items-center rounded-full
border px-2.5 py-0.5
text-xs font-semibold
```

Variants use semantic colors from section 2.2.

### 5.5 Floating Badge (Hero Image Overlay)

```
absolute -right-3 top-8
bg-white rounded-xl shadow-layered
px-4 py-3 border border-slate-100
```
Contains badge + text. Positioned over the hero product image.

### 5.6 Custom Shadows

| Token | Value | Tailwind |
|-------|-------|----------|
| `soft` | `0 2px 16px 0 rgb(0 0 0 / 0.08)` | `shadow-soft` |
| `layered` | `0 4px 32px 0 rgb(0 0 0 / 0.12)` | `shadow-layered` |

### 5.7 Border Radius

| Element | Radius | Tailwind |
|---------|--------|----------|
| Buttons | `12px` | `rounded-xl` |
| Cards | `16px` | `rounded-2xl` |
| Inputs | `12px` | `rounded-xl` |
| Badges | `9999px` | `rounded-full` |
| Images in cards | `12px` (top only for profile cards) | `rounded-xl` or `rounded-t-2xl` |
| Hero product image | `24px` | `rounded-3xl` |

---

## 6. Animations & Interactions

### 6.1 Entrance Animations (Framer Motion)

All entrance animations use `IntersectionObserver`-triggered Framer Motion variants. They fire ONCE per page load, NOT on every scroll into view.

**Hero entrance (on mount):**
```tsx
initial={{ opacity: 0, y: 30 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
```
Stagger children by `0.15s` each (eyebrow, headline, subtitle, form).

**Section headlines (on scroll into view):**
```tsx
initial={{ opacity: 0, y: 20 }}
whileInView={{ opacity: 1, y: 0 }}
viewport={{ once: true, margin: "-80px" }}
transition={{ duration: 0.5, ease: "easeOut" }}
```

**Cards (staggered on scroll):**
```tsx
// Parent
transition={{ staggerChildren: 0.1 }}

// Each card
initial={{ opacity: 0, y: 24 }}
whileInView={{ opacity: 1, y: 0 }}
viewport={{ once: true, margin: "-60px" }}
transition={{ duration: 0.45, ease: "easeOut" }}
```

**TrustEngine cards (dramatic entrance):**
```tsx
initial={{ opacity: 0, scale: 0.95, y: 30 }}
whileInView={{ opacity: 1, scale: 1, y: 0 }}
viewport={{ once: true, margin: "-100px" }}
transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
```
Stagger: `0.15s` between HIGH, MEDIUM, LOW.

### 6.2 Micro-Interactions

| Element | Interaction | Specification |
|---------|------------|---------------|
| CTA button hover | Scale + shadow lift | `hover:shadow-layered transition-all duration-200` |
| CTA button press | Slight scale down | `active:scale-[0.98] transition-transform duration-100` |
| Card hover | Subtle lift | `hover:-translate-y-1 hover:shadow-layered transition-all duration-300` |
| Input focus | Border color + ring | `focus:border-brand-green focus:ring-2 transition-colors duration-200` |
| Hero image | Subtle float | CSS `animation: float 6s ease-in-out infinite` — `translateY` between `0` and `-8px` |
| FloatingBadge | Gentle pulse | CSS `animation: badge-pulse 3s ease-in-out infinite` — `scale` between `1` and `1.03` |
| Navigation scroll indicator | Fade opacity | Fade to `0` after user scrolls past `200px` |

### 6.3 CSS Keyframes

```css
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

@keyframes badge-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
```

### 6.4 Animation Anti-Patterns

- Do NOT animate every element on scroll. Only section headlines, cards, and the hero animate.
- Do NOT use fade-in for body text paragraphs. They should be visible immediately when their section scrolls in.
- Do NOT use parallax scrolling. It hurts performance and clarity.
- Do NOT use scroll-jacking or scroll-linked transforms.
- Respect `prefers-reduced-motion`: wrap all Framer Motion in a check and disable animations when reduced motion is preferred.

---

## 7. States & Feedback

### 7.1 WaitlistForm States

| State | Visual |
|-------|--------|
| **Idle** | Input with placeholder "tu@email.com", CTA button "Quiero probarlo" |
| **Focus** | Input border turns `brand-green`, ring appears |
| **Loading** | Button text replaced with spinner (`animate-spin w-5 h-5`), input disabled with `opacity-70` |
| **Success** | Entire form replaced by: green checkmark icon + "Estás en la lista" text + "Te avisaremos cuando lancemos" caption. Fade-in transition 300ms |
| **Error (validation)** | Input border turns `red-500`, error message below: "Introduce un email válido" in `text-red-500 text-sm`. Button remains enabled |
| **Error (network)** | Input border turns `red-500`, error message: "Algo salió mal. Inténtalo de nuevo." Button remains enabled for retry |

### 7.2 Form Transitions

```tsx
// Success transition
initial={{ opacity: 0, scale: 0.95 }}
animate={{ opacity: 1, scale: 1 }}
transition={{ duration: 0.3 }}
```

### 7.3 Loading Spinner

```
<svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
</svg>
```

### 7.4 CookieBanner

- Appears at bottom of viewport with `position: fixed`, `z-50`
- Background: `bg-white shadow-layered border-t border-slate-200`
- Padding: `p-4 md:p-6`
- Two buttons: "Aceptar" (primary), "Rechazar" (ghost)
- Entrance: slide up from bottom, `translateY(100%)` to `translateY(0)`, `duration: 300ms`
- Exit: fade out `duration: 200ms`

---

## 8. Content Hierarchy

### 8.1 Cognitive Journey (Top to Bottom)

| Section | User Question | Cognitive Goal | Emotional State |
|---------|---------------|----------------|-----------------|
| 1. Hero | "What is this?" | Position territory + show benefit in 3s | Curiosity, relief |
| 2. Problem | "Do I have this problem?" | Recognition, empathy | "Yes, that's me" |
| 3. HowItWorks | "Is it easy to use?" | Simplicity, accessibility | Reassurance |
| 4. TrustEngine | "Can I trust the data?" | Credibility, differentiation | Confidence, surprise |
| 5. ForWho | "Is this for someone like me?" | Identification | Belonging |
| 6. EmotionalBlock | "What would it feel like?" | Desire, aspiration | Warmth, want |
| 7. Comparison | "What about alternatives?" | Validation of choice | Conviction |
| 8. WaitlistCTA | "I'm in" | Convert | Excitement, commitment |
| 9. Footer | "I want more info" | Secondary navigation, trust | Grounded |

### 8.2 Heading Hierarchy per Section

Every section follows: **Eyebrow** (optional) > **H2 headline** > **Lead paragraph** > **Content**. The Hero is the only section with an H1.

### 8.3 Copy Density Rule

- Hero: **~35 words** (excluding form microcopy)
- Problem: **~80 words** — the densest text section, but still concise
- All other sections: **40-60 words** of explanatory text, then visual/card content takes over
- Cards: **15-25 words** each

---

## 9. Accessibility

### 9.1 Color Contrast

All text/background combinations must meet WCAG 2.1 AA (4.5:1 for body, 3:1 for large text):

| Combination | Ratio | Pass? |
|-------------|-------|-------|
| `#334155` on `#FDFBF7` | 8.1:1 | AA |
| `#FFFFFF` on `#FF8C42` | 3.2:1 | AA Large only (buttons pass) |
| `#FFFFFF` on `#2D5A27` | 7.5:1 | AAA |
| `#FFFFFF` on `#0F172A` | 17.4:1 | AAA |
| `#64748B` on `#FDFBF7` | 4.6:1 | AA |
| `#065F46` on `#D1FAE5` | 6.4:1 | AA |
| `#92400E` on `#FEF3C7` | 5.9:1 | AA |
| `#9F1239` on `#FFE4E6` | 5.2:1 | AA |

### 9.2 Focus Management

- All interactive elements must have visible focus indicators: `ring-2 ring-brand-green ring-offset-2`
- Tab order follows visual order (no `tabindex` hacking)
- Skip-to-content link as first focusable element: hidden until focused

### 9.3 Semantic HTML

| Section | Landmark | Element |
|---------|----------|---------|
| Hero | `<header>` or `<section aria-label="Inicio">` | `<h1>` for headline |
| All other sections | `<section aria-labelledby="section-id">` | `<h2>` for headline |
| Footer | `<footer>` | `<nav aria-label="Enlaces legales">` |
| WaitlistForm | `<form aria-label="Lista de espera">` | `<label>` for every input |

### 9.4 Images

- All decorative images: `alt=""` (empty string, not omitted)
- All meaningful images: descriptive `alt` text in Spanish
- Hero product image: `alt="Mockup de nutriXplorer mostrando información nutricional de un plato en un restaurante"`
- `next/image` with `priority` on hero image, `loading="lazy"` for everything below the fold

### 9.5 Reduced Motion

```tsx
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

When `true`: disable all Framer Motion animations (set `initial` and `animate` to same values), disable CSS keyframe animations, disable hover transforms.

### 9.6 Font Sizing

- Minimum touch target: `44px x 44px` for all interactive elements
- Minimum font size: `13px` (captions only; body text minimum is `16px`)
- Form inputs: minimum `16px` font size to prevent iOS zoom on focus

---

## 10. Imagery & Icons

### 10.1 Image Treatment

- All images are AI-generated, 2048px, stored in `landing/public/images/`
- Serve via `next/image` with automatic WebP/AVIF optimization
- Maximum rendered width: `600px` for in-section images, full viewport for hero bg elements
- Border radius on images: `rounded-2xl` (`16px`) for contained images, `rounded-3xl` (`24px`) for hero product image
- No image borders. Use shadow-soft for depth when needed.

### 10.2 Image Sizes (next/image)

| Context | `sizes` attribute | `width` x `height` (intrinsic) | Priority |
|---------|-------------------|-------------------------------|----------|
| Hero product | `(max-width: 768px) 100vw, 45vw` | `800 x 600` | `priority` |
| ForWho profile card | `(max-width: 768px) 100vw, 50vw` | `600 x 450` | `loading="lazy"` |
| EmotionalBlock scene | `(max-width: 768px) 100vw, 50vw` | `700 x 500` | `loading="lazy"` |

### 10.3 Icons

- Use inline SVG icons, not an icon library (keeps bundle small)
- Icon size: `24px` default, `20px` in compact contexts, `32px` for HowItWorks step icons
- Icon stroke: `1.5px` for outlined style (consistent with Inter's weight)
- Icon color: inherits from `currentColor`
- HowItWorks step icons: simple outlined line icons (search magnifier, brain/lightbulb, checkmark/decision)
- TrustEngine level icons: shield with checkmark (HIGH), chart bars (MEDIUM), puzzle piece (LOW)

### 10.4 Decorative Elements

- No gradient blobs, no abstract shapes, no geometric patterns
- Subtle `radial-gradient` overlays on Hero and CTA sections (see section 2.4)
- Green glow on TrustEngine dark section (see section 2.4)
- No decorative dividers between sections — spacing alone creates separation

---

## 11. Constraints & Anti-Patterns

### 11.1 Absolute Prohibitions

| Anti-Pattern | Why |
|-------------|-----|
| Identical card grids across multiple sections | Looks templated / AI-generated |
| Everything centered on every section | No visual tension, monotonous rhythm |
| Generic gradient blobs as decoration | Instantly reads as AI/template |
| Stock-photo-feeling layouts | Undermines premium positioning |
| Uniform section heights | Predictable, kills rhythm |
| Same vertical padding on every section | See section 4.2 for varied spacing |
| Fade-in on every single element | Heavy, distracting, unintentional |
| Parallax scrolling | Performance cost, clarity cost |
| Auto-playing video | Performance, accessibility, annoyance |
| Hamburger menu (not needed) | Single page, no navigation needed beyond scroll |
| More than 2 waitlist form instances visible simultaneously | Aggressive, desperate |
| Fitness-bro language ("crush your macros", "gains") | Wrong audience, wrong tone |
| Clinical/medical language ("dietary intervention") | Too cold, too institutional |
| Tech jargon above the fold ("semantic similarity", "deterministic AI") | Alienates primary audience |

### 11.2 Performance Constraints

| Metric | Target |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5s |
| CLS (Cumulative Layout Shift) | < 0.1 |
| FID (First Input Delay) | < 100ms |
| Total page weight (gzip) | < 500KB first load |
| Number of font weights loaded | Max 3 (400, 600, 700 or 800) |
| JavaScript bundle (first load) | < 150KB gzip |
| Image format | WebP/AVIF via next/image |
| Hero image | `priority` + `fetchPriority="high"` |

### 11.3 Design System Constraints

- Maximum 2 font families total (only Inter is used)
- Maximum 3 shadow variants (none, soft, layered)
- Maximum 3 border-radius values in active use (xl, 2xl, full)
- No custom breakpoints beyond Tailwind defaults
- No `z-index` values above `z-50` (reserved for CookieBanner and any future modals)
- No `!important` in CSS
- No inline styles — all styling via Tailwind utility classes

---

## 12. Section-by-Section Design Notes

### 12.1 Hero

- **Background:** Ivory (`#FDFBF7`) with subtle radial gradient (green tint, see 2.4)
- **Layout (Variant A):** Asymmetric 2-column on desktop (55% text left / 45% image right). Mobile: stacked, text above image
- **Layout (Variant B):** Centered single column. Larger headline, image below text at reduced width
- **Eyebrow:** "Conoce lo que comes" — `text-brand-green uppercase tracking-widest font-semibold text-sm`
- **Headline:** "Come fuera con tranquilidad" — H1, `font-extrabold`
- **Product image:** Phone mockup with floating badge overlay. `rounded-3xl shadow-layered`. Subtle float animation (6s infinite ease-in-out)
- **WaitlistForm:** Horizontal layout on desktop (input + button inline). Stacked on mobile
- **Microcopy:** Below form, `text-slate-500 text-sm` — "Sin spam. Solo te avisaremos cuando lancemos."
- **Vertical rhythm:** eyebrow (mb-3) > headline (mb-5) > subtitle (mb-8) > form (mb-3) > microcopy
- **Energy:** HIGH — this section has the most visual energy on the page

### 12.2 Problem

- **Background:** Ivory (same as page default — continuity)
- **Layout:** Single column, centered text, max-width `640px`
- **NO image.** This is a pure text section. The breathing room IS the design.
- **Eyebrow:** "El problema" — same treatment as hero eyebrow
- **Headline:** "Cuando comes fuera, decides casi a ciegas"
- **Body:** 2-3 short paragraphs (not a wall of text). Use `text-slate-600` for softer presence. 20px font size for lead feel
- **Tone:** Empathetic, recognizable. User should think "yes, that's exactly my experience"
- **Energy:** LOW — calm, reflective, breathing room after high-energy hero

### 12.3 HowItWorks

- **Background:** Ivory
- **Layout:** Section headline centered, then 3-column grid below
- **Columns:** Each step is a vertical card-like unit: large number or icon (top) > step name (bold) > 1-sentence description
- **Step markers:** Large numbers (`48px font-extrabold text-brand-green/20`) or clean outlined icons (`32px`)
- **Connecting line:** Optional thin horizontal line or dotted connector between steps on desktop (purely decorative)
- **Steps:** 1. Busca un plato > 2. Entiende la respuesta > 3. Decide con contexto
- **Energy:** MEDIUM — clean, organized, efficient

### 12.4 TrustEngine (Star Section)

- **Background:** `bg-slate-950` with subtle green radial glow at top center
- **Text:** `text-white` for headlines, `text-slate-300` for body
- **Layout:** Full-width dark band. Content container inside. Section headline centered, 3 cards in a row below
- **Cards:** `bg-slate-900 border border-slate-800 rounded-2xl shadow-layered`. Each card has: confidence badge (colored, top), icon, level name, short description, example
- **Card order:** HIGH (left) > MEDIUM (center) > LOW (right)
- **Dramatic entrance:** Cards scale-in with stagger (see section 6.1)
- **Allergen guardrail:** Below the 3 cards, a distinct callout block with a shield icon. Text: "En alérgenos, si no está verificado, lo verás claramente. No convertimos una suposición en una promesa." — `text-emerald-400` for emphasis words, `text-slate-300` for rest
- **Energy:** HIGH — dramatic contrast shift, the "wow" moment of the page

### 12.5 ForWho

- **Background:** Ivory
- **Layout:** Section headline left-aligned (breaking symmetry), then 2x2 card grid
- **Cards:** Profile cards with image top (aspect 4:3, `object-cover`), content bottom. Each card has: image, profile name (bold), 1-sentence pain point, 1-sentence how nutriXplorer helps
- **Profiles:** 1. Fitness enthusiast 2. Parent with allergic child 3. Senior with chronic condition 4. Traveling professional
- **Image treatment:** Photos cropped tight, warm tones, `rounded-t-2xl`
- **Energy:** MEDIUM — warm, personal, inclusive

### 12.6 EmotionalBlock

- **Background:** Ivory
- **Layout:** Asymmetric. Alternating image-left/text-right and text-left/image-right for each scenario (2-3 scenarios). On mobile: stacked
- **NOT a card grid.** This section uses flowing layout to feel editorial
- **Scenarios:** Real moments — e.g., looking at a menu with calm, choosing confidently in a group, enjoying a meal without stress
- **Image size:** Large, `rounded-2xl`, occupying ~50% width on desktop
- **Text:** Short emotional copy next to each image. `text-slate-600`, 18px, max-w-[400px]
- **Energy:** MEDIUM-LOW — warm, atmospheric, aspirational

### 12.7 Comparison

- **Background:** Ivory
- **Layout:** Centered headline, 3 cards in a row
- **Cards:** Each comparing nutriXplorer vs one alternative. Header with competitor category (e.g., "vs Apps de fitness"), then bulleted differences
- **Visual distinction:** nutriXplorer column/items in `text-brand-green` or with green checkmarks; competitor items in `text-slate-400` with X marks
- **NOT a feature comparison table.** Cards are lighter, more scannable
- **Energy:** MEDIUM — decisive, validating

### 12.8 WaitlistCTA

- **Background:** Dark atmospheric gradient (see section 2.4, CTA atmospheric)
- **Layout:** Centered. Headline, subtitle, WaitlistForm (same component, `source="cta"`)
- **Text:** `text-white` for headline, `text-slate-300` for subtitle
- **Headline:** Something like "Empieza a conocer lo que comes" or "Sé de los primeros"
- **Emotional crescendo:** This is the final push. Copy should feel like a natural conclusion, not a hard sell
- **WaitlistForm styling:** Input `bg-white/10 border-white/20 text-white placeholder:text-white/50` on dark bg. Button stays `bg-brand-orange text-white`
- **Energy:** HIGH — conversion moment, atmospheric, immersive

### 12.9 Footer

- **Background:** `bg-slate-950` (same dark as TrustEngine for visual bookending)
- **Layout:** Multi-column on desktop. Logo/tagline left, link columns center, secondary waitlist right. On mobile: stacked
- **Text:** `text-slate-400` for body, `text-white` for headings and logo
- **Links:** Legal (Privacidad, Cookies), GitHub link (subtle, secondary). NO prominent "open source" messaging
- **Bottom bar:** "Hecho en Espana" + copyright. `text-slate-500 text-sm border-t border-slate-800 pt-6`
- **Energy:** LOW — grounded, trustworthy, final impression

---

## 13. Image Assignment

All images are sourced from `/Users/pb/Developer/FiveGuays/foodXPlorerResources/` and must be copied to `landing/public/images/` during implementation (Phase 3).

| Section | Image File | Usage | Notes |
|---------|-----------|-------|-------|
| **Hero (Variant A)** | `1.png` | Product mockup — Telegram bot showing "Lentejas con Chorizo" nutritional data in restaurant context | Primary hero image. Phone in hand at dinner table. Shows the product in action. Apply `priority` loading |
| **Hero (Variant B)** | `4.png` | Product mockup — "Huevos Rotos con Jamon" with macros overlay on phone | Alternative hero. Closer crop on phone + food. More focused on data display |
| **TrustEngine** | `5.png` | Burger with holographic nutritional split view | Illustrates the data transparency concept. Can be used as a background accent or inline visual for the HIGH confidence card |
| **TrustEngine (allergen)** | `7.png` | Mother + child with "Certificado Sin Gluten" verified badge | Powerful emotional proof for the allergen guardrail callout. Shows real human stakes of trust levels |
| **ForWho — Fitness** | `Gemini_Generated_Image_epj9seepj9seepj9.png` | CrossFit guy analyzing burger with phone showing confidence level | Profile card image for the fitness enthusiast persona |
| **ForWho — Family** | `7.png` | Mother + child at restaurant (same as allergen image) | Profile card image for the parent/allergies persona. Crop differently from TrustEngine usage |
| **EmotionalBlock** | `2.png` | Menu del dia with phone overlay showing nutritional analysis | Editorial scene: the moment of calm decision-making at a real Spanish restaurant |
| **EmotionalBlock (alt)** | `Gemini_Generated_Image_wlmwaewlmwaewlmw.png` | Tortilla espanola with holographic macro breakdown | Second emotional scene. Iconic Spanish dish + data transparency |
| **ForWho — Senior** | *No specific image yet* | Suggest: use a crop from `2.png` (warm restaurant atmosphere) or source a new one | Placeholder: use the warm restaurant bg from `2.png` with overlay |
| **ForWho — Professional** | *No specific image yet* | Suggest: use a crop from `1.png` (dinner context) or source a new one | Placeholder: crop from `1.png` showing the social dining context |

**Image optimization notes:**
- Export all at `2x` max (serve `1024px` wide for `512px` display slots)
- Use `next/image` `quality={85}` for photos
- Provide `width` and `height` attributes matching aspect ratio to prevent CLS
- Hero image: `fetchPriority="high"`, `priority={true}`
- All others: `loading="lazy"` (default)

---

*This document is the authoritative reference for all visual decisions in the landing page.
Frontend developers should not make visual judgment calls — defer to these specifications.
If a situation is not covered, ask the design lead before improvising.*

---

## Web App `/hablar` — F-WEB-MENU-VISION-001: Multi-dish menu/carta photo analysis

**Package:** `packages/web/` | **Added:** 2026-04-30 | **Status:** Design Approved
**Applies to:** `HablarShell`, `ConversationInput`, `ResultsArea` and the two new components `PhotoModeToggle` and `MenuDishList`/`MenuDishItem`.

> These notes extend (do not replace) the landing page guidelines above. They apply only to the `/hablar` shell. Reference the existing component vocabulary in `packages/web/src/components/` as documented below.

---

### W1. Visual Context: the /hablar shell

The existing `/hablar` shell is a **white-background, mobile-first chat UI**. Key established patterns:

- Page background: `bg-white` (body default in `globals.css`)
- Fixed bottom input bar: `bg-white border-t border-slate-200 px-4 py-3`
- Primary text: `text-slate-700` (slate-700, `#334155`)
- Cards: `rounded-2xl border border-slate-100 bg-white p-4 shadow-soft`
- Brand color for interactive chrome: `border-brand-green text-brand-green` (`--color-botanical: #2d5a27`)
- Touch buttons in the input bar: `h-12 w-12 rounded-xl` (PhotoButton pattern)
- Skeleton loading: `.shimmer-element` (slate-100 → slate-200 shimmer, `globals.css:82`)
- Card entrance: `.card-enter` (fade + `translateY(12px)` → 0, 0.35s ease-out, `globals.css:39`)

All new components must feel continuous with this palette. Do not introduce new shadow levels, new border-radius tokens, or new brand colors.

---

### W2. PhotoModeToggle

#### Control type and rationale

Use a **segmented pill control** (two adjacent buttons sharing a common pill container), NOT individual radio buttons and NOT a `<select>`. Rationale:

- Two options only — segmented pill is immediately scannable at a glance. No dropdown overhead.
- Visually echoes existing icon-button row style in ConversationInput without adding vertical bulk.
- On mobile, pill controls are faster to tap than a radio group that requires scanning labels with a pointer.

#### Anatomy

```
┌─────────────────────────────────────────────────┐
│  [ Menú/carta ▪ ]  [ Solo este plato ]          │
└─────────────────────────────────────────────────┘
```

The container is a single rounded pill with a border. The active segment fills with a solid token color; the inactive segment is transparent.

#### Sizing and positioning

- **Container:** `inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5` — the outer pill sits inside the ConversationInput below the main `flex items-center gap-2` row.
- **Placement:** Full-width below the input row, aligned with the textarea left edge. Use `mt-2` separation from the input row. Do not float it to one side — full-width makes the touch target generous on iPhone SE–class devices.
- **Each segment button:** `flex-1 rounded-[10px] py-1.5 px-3 text-sm font-medium transition-colors duration-150`
  - Active state: `bg-white text-brand-green shadow-soft border border-brand-green/20` — the active pill visually "lifts" from the container background with a subtle white fill and the brand-green border tint.
  - Inactive state: `bg-transparent text-slate-500 border-transparent` — understated, does not compete with the input.
  - Hover (inactive only): `hover:text-slate-700 hover:bg-white/60`
  - Focus: `focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1`
  - Disabled (during upload): `opacity-40 pointer-events-none cursor-not-allowed` on the **container**, not per-button — preserves layout, communicates the whole toggle is unavailable.
- **Font size:** `text-sm` (14px). Do not go smaller — the UI is used in restaurant lighting conditions.
- **Minimum tap target:** Each segment button must resolve to ≥ 44px tall in tap coordinates. `py-1.5` (6px top + bottom) + 14px line-height + 1px border = ~29px intrinsic. Compensate by wrapping the container in a `min-h-[44px]` flex row, or increase padding to `py-2.5` (~41px intrinsic). Prefer `py-2` as a minimum (`text-sm` renders at 14px → 14 + 16 = 30px, still short). **Use `py-2.5 px-3`** to clear 40px intrinsic, and accept the OS touch-target expansion to 44px on iOS.

#### Label copy (locked in spec — do not alter)

- Option A (default): **"Menú/carta"** (`value='auto'`)
- Option B: **"Solo este plato"** (`value='identify'`)

"Solo este plato" is 14 characters and fits comfortably at `text-sm` even on 320px viewports with `flex-1`.

#### Desktop vs mobile

On desktop (≥ `md:` breakpoint), the ConversationInput is centered and width-constrained. The toggle follows the same width as the textarea. No layout change needed — it already responds to the parent container width via `flex-1`.

#### Relationship to PhotoButton

The PhotoButton (`h-12 w-12 rounded-xl border border-brand-green`) sits in the main input row. The toggle is a **secondary affordance below** — it guides intent BEFORE the camera button is tapped, not simultaneously. The visual hierarchy is: textarea → action buttons (photo, mic, submit) → toggle hint below. This ordering matches the reading / interaction sequence.

---

### W3. MenuDishList and MenuDishItem

#### List format: compact rows, not cards

Use **compact full-width rows** with a border-bottom divider, NOT individual cards with shadows. Rationale:

- A restaurant menu typically has 4–12 dishes. Card-per-dish would create an overwhelming card grid in a cramped mobile viewport.
- Rows scan faster vertically. The user's goal is to identify and tap one dish — a list encourages linear scanning; cards encourage 2D comparison (wrong affordance here).
- Matches the visual language of native mobile list components (iOS UITableView, Android RecyclerView) which users already associate with "pick one".

#### MenuDishList container

```
┌─────────────────────────────────────────────────┐
│ Se han encontrado 6 platos          [chip]       │
│ ─────────────────────────────────────────────── │
│ Paella valenciana              640 kcal    ›     │
│ ─────────────────────────────────────────────── │
│ Fideuà                         Sin datos   ›     │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

- **Container:** `rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-soft` — matches NutritionCard surface exactly. This makes the list feel like a peer result unit, not a secondary UI.
- **Header row:** `px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/60`
  - Left: "Se han encontrado N platos" — `text-sm font-semibold text-slate-700`
  - Right: partial warning chip (conditional — see W3.2)
- **Entrance animation:** Apply `.card-enter` class to the container — reuses the existing `globals.css` fade + slide-up. No new animation needed.
- **Scroll behavior:** If `dishes.length > 6`, the container clips at `max-h-[420px] overflow-y-auto`. The user scrolls within the card; the page itself does not scroll to show more dishes. 420px accommodates ~7 rows × 60px before clipping becomes noticeable. Add `-webkit-overflow-scrolling: touch` via `overflow-y-auto` (Tailwind handles this on iOS via `overscroll-contain`).

#### MenuDishItem rows

- **Row container:** `flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 w-full text-left cursor-pointer active:bg-slate-50 transition-colors duration-100`
  - The `last:border-b-0` removes the bottom border from the final row — matches iOS list convention.
  - `active:bg-slate-50` is the tap ripple analog: a subtle background flash on press. No full ripple animation needed — this is a content-list row, not a button CTA.
- **Minimum row height:** `min-h-[56px]` — safely above the 44px WCAG touch target. The `py-3` (24px padding) + at least one line of text (20px) = 44px. Use `min-h-[56px]` to provide breathing room for two-line dish names.
- **Left: dish name**
  - `text-base font-semibold text-slate-800 flex-1 leading-snug` — bold name, can wrap to two lines on long names like "Lomo de merluza a la plancha con verduras".
  - No character truncation. Let it wrap — the `min-h-[56px]` accommodates two lines.
- **Right: kcal or "Sin datos"**
  - **With estimate:** `text-sm font-medium text-slate-500 whitespace-nowrap` — e.g. "640 kcal". Muted but legible. Not the brand-orange used in NutritionCard (that is for the primary card hero display; here it would be noisy across 6+ rows).
  - **"Sin datos":** `text-sm text-slate-400 whitespace-nowrap` — noticeably lighter than the kcal value, communicating lower information density. Do NOT use a dash or "—" — the spec copy is "Sin datos" and it reads better.
  - Do NOT use color-coding (no red for "Sin datos") — this is not an error state. It simply means no cascade match yet. The user can still tap and trigger a live query.
- **Chevron:** `text-slate-300` — `›` character or an inline SVG chevron-right at `16px`. `aria-hidden="true"`. Right-aligned with `flex-shrink-0 ml-2`.

#### Visual contrast: kcal vs "Sin datos"

| Scenario | Color class | Contrast on white | Pass AA? |
|---|---|---|---|
| kcal value (`text-slate-500`) | `#64748B` on `#FFFFFF` | 4.6:1 | Yes (body text) |
| "Sin datos" (`text-slate-400`) | `#94A3B8` on `#FFFFFF` | 2.9:1 | AA Large only |

"Sin datos" at `text-sm` (14px) is body-size text and falls below AA at 4.5:1. Compensate: use `font-medium` weight on "Sin datos" — at 500 weight, 14px passes as "large text" in WCAG 2.1 definition (bold ≥ 14pt / 18.67px OR bold ≥ 14px at 700+ weight). Alternatively, use `text-slate-500` for "Sin datos" and differentiate with an italic style: `italic text-slate-500`. The italic clearly signals "no data" without requiring a red/orange color that would suggest an error. **Preferred approach: `text-sm italic text-slate-400` and accept AA Large (16px bold equivalent context) — this is the most visually intuitive.**

If the project's accessibility policy requires strict AA body compliance, raise "Sin datos" to `text-slate-500` (4.6:1 — passes AA).

---

### W3.2 Partial-results banner

The `partial: true` banner sits inside the `MenuDishList` header row, to the right of the "Se han encontrado N platos" label.

- **Visual:** A small inline chip — `inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold px-2 py-0.5`
  - Label: "Lista incompleta"
  - Prepend a warning triangle icon at `14px` stroke `1.5` (amber-600, `aria-hidden`)
  - Matches the "Estimado" ConfidenceBadge amber palette already in use.
- **Do NOT use a full-width banner below the header.** A full banner would push all dish rows down and feel alarming for what is a mild informational state. The chip is contained and unobtrusive.
- **Screen reader announcement:** The chip must carry `role="note"` and the full text "Análisis parcial. Es posible que el menú tenga más platos." — the chip label "Lista incompleta" alone is too terse for a non-visual reading.

---

### W4. Loading and error states

#### Photo upload in progress (between tap and result)

The existing `LoadingState` renders two `SkeletonCard` shimmer cards. For `mode='auto'`, a menu analysis takes noticeably longer than a single-dish identify (Vision API + cascade per dish). The skeleton should signal "analyzing menu", not just "loading":

- **Replace the two-card skeleton with a single full-width shimmer bar** at `h-[200px] rounded-2xl shimmer-element` — this mirrors the eventual `MenuDishList` height, setting correct spatial expectations.
- **Add a text label above the skeleton:** `"Analizando el menú..."` — `text-sm text-slate-500 text-center mb-2`. For `mode='identify'`, keep the existing copy `"Buscando información nutricional..."` (already in `LoadingState` aria-label).
- The text label is conditional on mode — `HablarShell` already has `photoMode` state (`'idle' | 'analyzing'`). Pass the current `photoAnalysisMode` to `ResultsArea` → `LoadingState` for the copy.
- The `isPhotoLoading` prop already feeds into `ResultsArea`. No structural change to the loading branch — only the copy and skeleton shape are different.

#### MENU_ANALYSIS_FAILED error (mode-conditional)

The spec locks the copy:
- `mode='auto'`: "No he podido leer el menú. Prueba con otra foto o elige 'Solo este plato'."
- `mode='identify'`: "No he podido identificar el plato. Prueba con otra foto o asegúrate de que el plato sea visible."

Visual treatment: rendered as `inlineError` in ConversationInput — `role="alert" text-sm text-red-600 mb-1.5` (existing pattern). No toast, no modal. The existing error rendering in `ConversationInput.tsx:70` handles this unchanged.

- **Do NOT show the error as a card in `ResultsArea`.** It must appear in the input bar where the user's attention is, not in the results area where there is nothing to show.
- The mention of "elige 'Solo este plato'" in the `mode='auto'` error copy directly draws the eye down to the `PhotoModeToggle` which is visible immediately below the error. This is the key interaction affordance that guides recovery — the toggle's position adjacent to the error message is intentional.

#### 429 rate-limit error

Existing copy: "Has alcanzado el límite de análisis por foto. Inténtalo más tarde." — rendered as `inlineError`. No visual change.

---

### W5. Accessibility

#### Color contrast targets (new components)

| Element | Foreground | Background | Ratio | Target |
|---|---|---|---|---|
| Toggle active label ("Menú/carta") | `text-brand-green` `#2D5A27` | `bg-white` `#FFFFFF` | 7.5:1 | AAA |
| Toggle inactive label | `text-slate-500` `#64748B` | `bg-slate-50` `#F8FAFC` | ~4.5:1 | AA |
| Dish name | `text-slate-800` `#1E293B` | `bg-white` | 12.6:1 | AAA |
| kcal value | `text-slate-500` `#64748B` | `bg-white` | 4.6:1 | AA |
| "Sin datos" italic | `text-slate-400` `#94A3B8` | `bg-white` | 2.9:1 | AA Large (14px medium weight — acceptable) |
| Partial chip text | `text-amber-800` `#92400E` | `bg-amber-50` `#FFFBEB` | 5.9:1 | AA |
| Header text | `text-slate-700` `#334155` | `bg-slate-50/60` `≈#F8FAFC` | ~8:1 | AAA |

#### ARIA roles and attributes (supplementing spec)

- `PhotoModeToggle` container: `role="group" aria-label="Tipo de análisis de foto"` (locked in spec)
- Each toggle button: `<button aria-pressed={isActive}>`. The pressed button's label must be fully self-describing — "Menú/carta, seleccionado" is communicated by `aria-pressed="true"`; no extra hidden text needed.
- `MenuDishList`: `role="list" aria-label="Platos encontrados en el menú"` (wrap value in label: "Platos encontrados en el menú, N resultados")
- Each `MenuDishItem`: `role="listitem"`. The clickable element inside: `<button type="button" aria-label="{dishName}, {kcal} kcal — ver información nutricional">` or `"{dishName}, sin datos de calorías — ver información nutricional"` for null estimates. This prevents the screen reader from just reading "640 kcal ›" without context.
- Partial banner chip: `role="note" aria-label="Análisis parcial. Es posible que el menú tenga más platos."` — the visual label "Lista incompleta" is insufficient.
- Loading state: `role="status" aria-live="polite" aria-label="Analizando el menú..."` — overrides existing `LoadingState` copy when `photoAnalysisMode === 'auto'`.

#### Focus order

The `ConversationInput` DOM order after this change:

1. `inlineError` paragraph (non-focusable; read by `role="alert"`)
2. `textarea` (existing)
3. `PhotoButton` (existing)
4. `MicButton` (existing)
5. `SubmitButton` (existing, conditional)
6. `PhotoModeToggle` container — segment button A ("Menú/carta")
7. `PhotoModeToggle` segment button B ("Solo este plato")

This order is correct: primary input actions (2–5) before the secondary modifier (6–7). Tab through the input bar reaches the toggle last, which is appropriate — most users set mode once and forget it.

When `MenuDishList` is rendered in `ResultsArea`, it appears above `ConversationInput` in DOM order. The first `MenuDishItem` button is the first focusable element after the results area is populated. This is correct — keyboard users tab naturally from the result list back down to the input.

#### Keyboard navigation within MenuDishList

- Tab: moves between dish rows sequentially (standard button tabbing — no custom keyboard handler needed).
- Enter / Space on a dish row: fires `onSelect()` — standard button behavior, no extra handler.
- Do NOT implement arrow-key navigation (up/down between rows). This is a list of buttons, not a `role="listbox"`. Arrow-key navigation adds complexity and is not expected for button lists.

---

### W6. Mobile-first considerations

**Primary use case:** user is in a restaurant, holding their phone with one hand, photographing a paper menu under variable lighting.

#### One-thumb reachability

On iPhone 14 (390 × 844pt), the reachable thumb zone comfortably covers the bottom ~60% of the screen. The fixed `ConversationInput` bar is at the bottom — fully within the reachable zone.

- `PhotoModeToggle` sits immediately above the safe area inset inside the fixed bar. It is reachable with the right thumb.
- The toggle's `py-2.5` padding makes each option finger-friendly without requiring precision.
- "Menú/carta" (the default) is on the LEFT side of the pill — the side closer to the left thumb on right-handed use, and directly reachable for left-handed users operating with their right hand on the right side of the pill. Either way, both options are within the 390pt width and easily reachable.

#### MenuDishList scroll on mobile

- The `max-h-[420px] overflow-y-auto` constraint leaves room for the ConversationInput bar (~80px) and some of the page above the card. On 844px viewport height, 420px = exactly 50% — the user always sees at least some content outside the list, preventing the feeling of being "trapped" in an endless scroll.
- Add `scroll-pb-4` to the list container to ensure the last item is not obscured by the input bar when scrolled to bottom — though since the list is inside `ResultsArea` (above the fixed bar), this is only a concern if `ResultsArea` itself is overlapped. Verify in implementation.
- **No momentum scroll jank:** The `overflow-y-auto` on iOS requires the container to be a block-level element (not `display: contents`). Confirm in implementation.

#### Photo quality under restaurant lighting

The toggle label "Menú/carta" should help users understand to take a photo of the physical menu, not the food. No additional guidance UI is needed — the label is self-explanatory. Do not add a tooltip or helper text below the toggle; it adds visual noise in a context where the user is already multitasking.

---

### W7. Animations and motion

#### New animations for this feature

| Trigger | Component | Animation | Spec |
|---|---|---|---|
| MenuDishList appears | `MenuDishList` container | Fade + slide-up | Apply `.card-enter` class (existing, `globals.css:43`) |
| Individual dish rows | `MenuDishItem` | None (renders inside the already-animating container) | Do NOT stagger individual rows — for menus with 10+ items, stagger would feel slow |
| Toggle mode change | `PhotoModeToggle` | Active pill crossfades | `transition-colors duration-150` on background + color — no slide or scale |
| Dish tap | `MenuDishItem` | Background flash | `active:bg-slate-50 transition-colors duration-100` |

#### What NOT to animate in this feature

- Do NOT slide individual `MenuDishItem` rows in when the list appears. The container `.card-enter` handles the whole list as a unit.
- Do NOT animate the `PhotoModeToggle` appearance on page load — it is always visible and should not call attention to itself on mount.
- Do NOT add a loading spinner inside the toggle during upload — the `opacity-40` disabled state is sufficient communication.
- Do NOT animate `MenuDishList` exiting when the user taps a dish. The list disappears as `photoResults` clears; an exit animation would delay navigation feedback. Instant removal is correct.

#### prefers-reduced-motion

The existing `globals.css:97-115` block already disables all `.card-enter` and `.shimmer-element` animations system-wide when `prefers-reduced-motion: reduce`. No extra work needed. The `transition-colors duration-150` on the toggle will also be suppressed by the `transition-duration: 0.01ms` override.

---

### W8. Anti-patterns specific to this feature

| Anti-pattern | Why |
|---|---|
| Carousel or horizontal scroll for MenuDishList | Dishes are parallel choices, not sequential content. Horizontal swipe is wrong affordance and hidden items. |
| Modal or bottom sheet for the toggle | The spec locks toggle as always-visible inline. A modal adds friction at the worst moment (in a restaurant, about to take a photo). |
| "Analizar todo" / "Ver todos los nutrientes" batch CTA | Out of scope per spec. Each dish tap triggers a separate conversational query. |
| Displaying kcal as a progress bar or ring | No reference range is available. A progress bar implies a limit. Plain numeric is correct. |
| Color-coding dish rows by kcal level (green/yellow/red) | nutriXplorer explicitly avoids food-as-good/bad framing. Calories are data, not judgments. |
| Infinite scroll for dishes beyond `max-h` | A single restaurant menu will never have 100 dishes. Clip at `max-h-[420px]` and let the user scroll within the card. Infinite scroll pagination adds engineering cost for zero user benefit here. |
| Skeleton cards (2-card grid) for menu analysis loading | The multi-card skeleton implies multiple independent cards, not a unified list. Use the single full-width shimmer bar for `mode='auto'` loading. |
| Putting the mode toggle in a settings panel or behind a gear icon | The toggle must be always visible per spec. Hiding it anywhere defeats the "killer use-case" default positioning. |
| Showing "Sin datos" in red | Red = error in this design system. Missing calorie data is not an error — it is a data coverage gap. Use italic slate-400. |
| Truncating long dish names with ellipsis | A truncated "Lomo de merluza a la plancha con..." is not tappable with confidence. Let names wrap to two lines. |

---

*Section added: 2026-04-30 | Feature: F-WEB-MENU-VISION-001 | Designer: ui-ux-designer agent*

---

## Web App `/hablar` — F-WEB-TIER: Registration value — `<LoginCta>` + `<UsageMeter>`

**Package:** `packages/web/` | **Added:** 2026-05-26 | **Status:** Design Approved
**Applies to:** `HablarShell` header (the 52px app bar), `LoginCta` (NEW), `UsageMeter` (NEW), `RateLimitNudge` (NEW inline in ResultsArea).

> These notes extend the existing W1–W8 block above. They apply only to the `/hablar` header and the two new header-resident components. The `/hablar` shell visual language (white background, brand-green, slate palette, 32px avatar button focus ring) is already established in W1 — all new work must feel continuous with it.

---

### W9. Header layout: the auth slot

The existing header is a single `flex items-center` row, `h-[52px]`, with the logo (`text-base font-bold text-brand-green`) hard-left and `<UserMenu>` (32px avatar circle) hard-right via `ml-auto` on its wrapper (`relative ml-auto`).

This feature introduces a **clean auth-state dichotomy** in that right slot:

```
┌──────────────────────────────────────────────────────┐
│  nutriXplorer                            [slot]       │  h-[52px]
└──────────────────────────────────────────────────────┘

logged-out:  [slot] = <LoginCta>           (CTA button, ml-auto)
logged-in:   [slot] = <UsageMeter> + <UserMenu>  (inline pair, ml-auto on wrapper)
loading:     [slot] = nothing              (authLoading guard — no layout shift)
```

The slot is reserved space on the right. During `authLoading`, it is intentionally empty — the header keeps its `h-[52px]` fixed height regardless, so no layout shift occurs when auth resolves. This matches the existing `UserMenu` pattern (it already returns null when `user` is null).

**DOM order in the header flex row:**

```
1. <span> logo               — left anchor
2. <LoginCta>  OR            — right anchor (mutually exclusive)
   <div class="flex items-center gap-2 ml-auto">
     <UsageMeter />
     <UserMenu user={user} />
   </div>
```

The `ml-auto` that previously sat on `UserMenu`'s wrapping `<div>` moves to the outer wrapper that contains both `<UsageMeter>` and `<UserMenu>` in the logged-in state. `<LoginCta>` has its own `ml-auto`.

---

### W10. `<LoginCta>` — logged-out header button

#### Visual form

A compact text button — **not** a pill badge, not an outlined icon button. Rationale: logged-out users on `/hablar` have arrived without intending to register; a heavy visual treatment (orange CTA) creates unwanted pressure. A soft, medium-emphasis button signals the option without dominating the header. The brand-green text on white achieves this without introducing a new button variant.

```
Visual spec:
  <button>
    text: "Iniciar sesión"
    height: 32px  (matches UserMenu avatar — equal visual weight in the slot)
    padding: px-3 py-1  (tight horizontal, symmetrical vertical to hit 32px)
    font: text-sm font-medium  (not semibold — softer register than a CTA)
    color: text-brand-green  (#2D5A27)
    background: transparent (no fill — avoids orange/green CTA energy in the header)
    border: none  (border would add visual noise against the header border-b)
    border-radius: rounded-lg  (8px — softer than rounded-xl used for primary CTAs)
    hover: bg-slate-50  (minimal fill on hover — same pattern as ghost buttons)
    active: bg-slate-100
    focus: focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2
    transition: transition-colors duration-150
```

#### What NOT to use for LoginCta

- Do NOT use `bg-brand-orange` or `bg-brand-green` filled button — this is a secondary affordance in a minimal header, not a conversion CTA. The prominent orange CTA register opportunity is the `<RateLimitNudge>` triggered on 429.
- Do NOT show an icon (arrow, person icon) — the label is unambiguous; an icon adds visual weight without semantic value at this scale.
- Do NOT use `font-semibold` — the button sits adjacent to the 32px avatar; semibold weight would make it feel heavier than the UserMenu it mirrors.
- Do NOT render while `authLoading` — this is already enforced in the spec but bears repeating: a flash of "Iniciar sesión" for a logged-in user resolving session is a destructive pattern.

#### Copy (locked)

| Context | Text |
|---------|------|
| Visible button label | **"Iniciar sesión"** |
| `aria-label` attribute | **"Iniciar sesión o registrarse"** |

The visible label uses "Iniciar sesión" (shorter, fits the compact header) while the `aria-label` includes "o registrarse" for screen readers — users without an account should understand the page serves both flows.

#### Responsive

- Mobile (< `md:`): same visual treatment — the 52px header accommodates the text at `text-sm` easily. No collapse to icon needed at any breakpoint because "Iniciar sesión" (16 chars at `text-sm`) is ~112px wide and the header has sufficient space even at 320px viewport width (logo ≈ 110px + `LoginCta` ≈ 112px + gaps ≈ 8px = 230px, well under 320px).
- If a future logo asset or badge widens the left side, the label can be reduced to **"Entrar"** (6 chars) as a narrow-viewport fallback at `< sm:`. Not needed for current logo.

#### Accessibility

- Element: `<button type="button">` — never an anchor styled as a button.
- `aria-label="Iniciar sesión o registrarse"` — extends the visible label for screen readers.
- Focus ring: `focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2` — identical to UserMenu avatar button.
- Tab order: the button is the last focusable element in the header (after logo, which is non-focusable). Natural reading/tab order: logo → button.
- Touch target: 32px intrinsic height + `px-3` gives ~112px × 32px. On iOS the touch target is OS-expanded to 44px height. This is acceptable for a secondary header action (not a primary submit path).

---

### W11. `<UsageMeter>` — logged-in header component

#### Recommended form: compact inline counters with a popover for detail

**Decision: inline counters (desktop/tablet) + icon-only with popover (mobile).**

Two-tier presentation:

- **Desktop / tablet (≥ `sm:` breakpoint):** Three compact inline counters, rendered as a horizontal group directly in the header next to `<UserMenu>`. Each counter shows `used/limit` for one bucket.
- **Mobile (< `sm:`):** The three counters collapse to a **single icon button** (a gauge/meter icon). Tapping it opens a small popover anchored to the icon. This prevents the header from becoming a cluttered 3-counter + avatar row on 375px screens.

**Rationale for inline vs popover-only approach:**

A popover-only design (icon → tap → see details) has low discoverability — users will not tap an unfamiliar icon in the header without knowing what it reveals. Inline counters are immediately legible and reinforce registration value passively every time the user glances at the header. On desktop/tablet, there is enough horizontal space to show all three without crowding. On mobile, the collapse to a single icon is the right trade-off (space constraint > discoverability loss, because the meter is not the user's primary goal).

#### Desktop/tablet inline counter anatomy

```
┌─────────────────────────────────────────────────────────────────────┐
│  nutriXplorer                  12/100 · 3/20 · 5/30    [avatar]     │
└─────────────────────────────────────────────────────────────────────┘
                                 ▲
                     UsageMeter inline group
```

Each bucket renders as `{used}/{limit}` with a label above on hover (or always-visible small label).

**Preferred layout — label + count stacked, three groups separated by a faint divider:**

```
┌──────────┬──────────┬──────────┐
│Consultas │  Fotos   │   Voz    │
│  12/100  │   3/20   │   5/30   │
└──────────┴──────────┴──────────┘
```

- Container: `inline-flex items-center gap-0 mr-3` (margin-right separates from UserMenu avatar)
- Each bucket group: `flex flex-col items-center px-2.5`
- Divider between groups: `w-px h-6 bg-slate-200 self-center` (1px vertical rule)
- Bucket label: `text-[10px] font-medium text-slate-400 leading-none mb-0.5 uppercase tracking-wide` — e.g. "CONSUL.", "FOTOS", "VOZ" (abbreviated to fit; full labels in popover/tooltip)
- Count value: `text-xs font-semibold text-slate-600 leading-none tabular-nums` — e.g. "12/100"

**Total width estimate:** 3 groups × ~52px + 2 dividers × 1px + gaps ≈ 158px. At 375px mobile this is too wide (see mobile section). At 640px+ (sm) it sits comfortably between the logo (~110px) and avatar (32px), with ~300px center available.

#### "Running low" visual state — color shift without relying on color alone

Define thresholds per bucket:
- **Normal (≥ 40% remaining):** count value in `text-slate-600` (default)
- **Low (< 40% remaining, i.e. used > 60% of limit):** count value in `text-amber-600` + the label gains a small inline `!` suffix — e.g. "CONSUL. !" — that is visible without color. The `!` is rendered as `aria-hidden="true"` visually but the `aria-label` on the container (see a11y section) recalculates dynamically to include "advertencia: pocas consultas restantes".
- **Critical (< 20% remaining, i.e. used > 80% of limit):** count value in `text-red-500` + label suffix becomes `!!` visually. Screen reader: "advertencia: casi sin consultas".

These thresholds apply identically to all three buckets. The color change alone never conveys the state — the textual suffix is always paired with it.

Color contrast:
| State | Foreground | Background | Ratio | Pass |
|-------|-----------|------------|-------|------|
| Normal (`text-slate-600`) | `#475569` | `#FFFFFF` | 5.9:1 | AA |
| Low (`text-amber-600`) | `#D97706` | `#FFFFFF` | 3.0:1 | AA Large (12px bold passes as "large" at 700 weight equivalent — but `text-xs font-semibold` at 12px is borderline) |
| Critical (`text-red-500`) | `#EF4444` | `#FFFFFF` | 3.3:1 | AA Large |

For Low and Critical states, raise the count to `text-sm font-bold` (14px bold) when the threshold is crossed — this clears WCAG AA (14px bold = large text, 3:1 required, both amber-600 and red-500 pass at 3:1+). This also provides an additional non-color cue (weight change) visible to color-blind users.

#### Popover (hover on desktop, tap on mobile meter icon)

On desktop, hovering any bucket group reveals a small popover anchored below it:

```
┌──────────────────────────────┐
│ Consultas (queries)           │
│ Usadas hoy: 12 de 100        │
│ Te quedan: 88                 │
│ Se reinicia: mañana a las 0:00│
└──────────────────────────────┘
```

- Trigger: `hover` (desktop) and `focus-visible` (keyboard). Not click — click on desktop is reserved for future "go to usage settings" navigation.
- Popover container: `absolute z-50 mt-2 w-[200px] rounded-xl border border-slate-100 bg-white py-3 px-4 shadow-layered text-left`
- Title: `text-xs font-semibold text-slate-700 mb-1`
- Lines: `text-xs text-slate-500 leading-relaxed`
- Reset time: `text-[11px] text-slate-400 mt-1` — derived from `resetAt` field in the API response. Format: "Se reinicia hoy/mañana a las 0:00 UTC" (or local time if timezone is resolved later — for now UTC is acceptable).
- Popover for Critical/Low states adds: `text-xs font-medium text-amber-700 mt-1.5` — "Considerando registrarte en plan Pro para más consultas?" (future-proofed copy; not shown for free tier until pro exists — omit for now).
- `role="tooltip"` on the popover element; the trigger element has `aria-describedby` pointing to it.

#### Mobile meter icon (< `sm:`)

```
┌──────────────────────────────────────────────────────┐
│  nutriXplorer                             [⊙]  [av]  │  52px header
└──────────────────────────────────────────────────────┘
                                            ▲
                                   UsageMeter icon button (20px gauge icon)
```

- Element: `<button type="button">` — `h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2`
- Icon: a gauge/speedometer inline SVG at 20px, stroke 1.5, `currentColor`. Alternatively a stacked-bars icon (three horizontal bars of decreasing width — universally readable as "usage"). Either is acceptable; the stacked-bars icon is preferred because it maps more intuitively to "three quotas" without requiring users to know a gauge metaphor.
- When any bucket is in "Low" state: add an amber dot indicator (8px filled circle) at `top-0 right-0` of the button — `absolute h-2 w-2 rounded-full bg-amber-400` with the button wrapper `position: relative`. This dot is the only visual signal on mobile that usage is noteworthy.
- When any bucket is in "Critical" state: dot becomes `bg-red-500`.
- The indicator dot: `aria-hidden="true"` — the button's `aria-label` conveys state textually (see a11y).
- Tap opens a popover (small dropdown anchored below the button, same visual spec as the desktop hover popover but with all three buckets listed sequentially rather than one at a time).

#### Reinforcing registration value (free-vs-anonymous framing)

The inline counters show `used/limit` where `limit` is the free-tier limit (100/20/30). The value of registration is implicit: a logged-in user simply sees they have 100 queries/day. There is no active "you registered, you now have X" banner — that would be intrusive on every load.

The framing is visible only when the user hovers/taps the popover. In the popover footer, for free-tier users:

```
Plan gratuito · 100 consultas, 20 fotos, 30 voz por día
```

- Style: `text-[11px] text-slate-400 mt-2 border-t border-slate-100 pt-2`
- This line passively reminds the user what their tier includes without nagging. It never shows a "limited vs unlimited" comparison (that is pro-upsell, out of scope).
- For admin tier (limit: null): hide the meter entirely — render null. An admin does not need quota awareness.

#### Loading / skeleton state

While the first `GET /me/usage` fetch is in flight on mount:

- **Desktop/tablet:** render three placeholder groups with the same dimensions but count replaced by a shimmer: `w-8 h-3 rounded shimmer-element` for each number. Labels are visible immediately (not shimmed). This prevents the header from reflowing when the numbers arrive.
- **Mobile icon:** render the icon button immediately (no shimmer) with no indicator dot. The icon itself is the placeholder — no layout shift.

Duration: the `GET /me/usage` endpoint is a lightweight Redis read. On a warm connection it resolves in < 100ms. The shimmer will rarely be visible — but it must be there for slow connections (restaurant WiFi).

#### Error / degraded state

If `GET /me/usage` fails (Redis unavailable, network timeout, 5xx):

- **Desktop/tablet:** the three groups render as `—/—` with no color state change. `text-slate-400`. No error message, no toast.
- **Mobile icon:** render the icon button with no indicator dot. No error state displayed.
- The meter must NEVER throw or block the page. Treat as non-fatal throughout.

#### Refresh behavior

After each successful query/photo/voice, `HablarShell` triggers a refresh callback on `<UsageMeter>`. The counter increments. Use a brief `transition-all duration-300` on the count number so the increment does not snap — a smooth number change is legible and confirms the action landed. Do NOT animate on page mount (first render should be instant).

---

### W12. `<RateLimitNudge>` — inline in ResultsArea

This component is not in the header, but is documented here for completeness as it completes the logged-out funnel.

#### Visual placement

`<RateLimitNudge>` appears **below** the existing rate-limit error message in `ResultsArea`. It is NOT a modal, NOT a toast, NOT a banner — it is an inline upgrade prompt that appears as a natural continuation of the error state.

```
ResultsArea (when 429 + user===null):
┌─────────────────────────────────────────────────────┐
│  ⚠  Has alcanzado el límite diario de consultas.    │  ← existing error message (unchanged)
│     Vuelve mañana.                                   │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │  ← RateLimitNudge (NEW, below error)
│  │  Regístrate gratis y obtén el doble de         │  │
│  │  consultas diarias (100 en lugar de 50).       │  │
│  │                                                │  │
│  │  [ Crear cuenta gratis ]                       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

#### Visual spec

- Nudge container: `mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4`
  - The green tint visually associates with "benefit / positive action" rather than error (the error above already uses the existing error style). This is an opportunity framing, not an error extension.
- Copy: `text-sm text-slate-700 leading-relaxed mb-3`
- CTA button: `<button type="button">` — `bg-brand-green text-white text-sm font-semibold rounded-lg px-4 py-2 hover:opacity-90 active:scale-[0.98] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2`
  - Height: ~36px (py-2 = 8px × 2 + 20px line-height). This is smaller than the landing page primary CTA (py-3.5 = 56px) — appropriate for an in-context prompt.
  - Color: `bg-brand-green` (not brand-orange) — green = "safe, positive, go" aligns with the nudge's framing as a benefit. The orange CTA is reserved for primary conversion surfaces (landing page, onboarding).
- Outer `role="status"` so screen readers announce the nudge when it appears (live region; polite).

#### Copy (locked)

| Element | Spanish copy |
|---------|-------------|
| Nudge body | "Regístrate gratis y obtén el doble de consultas diarias (100 en lugar de 50)." |
| CTA button | "Crear cuenta gratis" |

---

### W13. Accessibility summary for F-WEB-TIER components

| Component | Element | ARIA / Keyboard |
|-----------|---------|----------------|
| `<LoginCta>` | `<button type="button">` | `aria-label="Iniciar sesión o registrarse"` · `focus-visible:ring-2 ring-brand-green ring-offset-2` |
| `<UsageMeter>` (container) | `<div role="status">` | `aria-label="Uso diario: {used} de {limit} consultas, {used} de {limit} fotos, {used} de {limit} voz"` — recalculated on each refresh |
| `<UsageMeter>` (mobile icon button) | `<button type="button">` | `aria-label="Ver uso diario"` (normal) · `"Ver uso diario: pocas consultas restantes"` (low) · `"Ver uso diario: consultas casi agotadas"` (critical) |
| `<UsageMeter>` (desktop bucket group) | non-interactive `<div>` | `aria-hidden="true"` per group (values read from the container `role="status"` aria-label); indicator suffix `!`/`!!` is `aria-hidden="true"` |
| `<UsageMeter>` (popover) | `<div role="tooltip">` | triggered by `aria-describedby` on the bucket group or icon button |
| `<UsageMeter>` (indicator dot) | `<span>` | `aria-hidden="true"` — state communicated via button's `aria-label` |
| `<RateLimitNudge>` | `<div role="status">` | polite live region; CTA `<button type="button">` with focus ring |

**Focus order in the header (logged-out):**

1. Logo `<span>` — non-focusable
2. `<LoginCta>` button — Tab stop 1 in the header

**Focus order in the header (logged-in):**

1. Logo `<span>` — non-focusable
2. `<UsageMeter>` mobile icon button (mobile only) — Tab stop 1
3. `<UserMenu>` avatar button — Tab stop 1 (desktop, where UsageMeter groups are non-interactive) / Tab stop 2 (mobile)

On desktop, the usage counter groups are visual-only (`aria-hidden`) — screen readers get the summary from the `role="status"` container. This keeps the tab order clean: logo → UserMenu, same as before, with the usage summary announced as a live region after each refresh.

---

### W14. Anti-patterns specific to F-WEB-TIER

| Anti-pattern | Why |
|---|---|
| Orange filled `<LoginCta>` button in the header | The header is a minimal utility bar — a primary CTA button there competes with the main input and feels pressured. The ghost/text style is correct for the secondary affordance. |
| Three mini progress bars instead of `used/limit` counters | Progress bars imply a "goal to reach" framing; quota is a ceiling, not a target. `12/100` is clear; a 12% filled bar communicates "almost empty" which is the wrong frame at 88 remaining. |
| Showing the meter to anonymous users | Anonymous users see `<LoginCta>`. The meter is a logged-in-only value signal. Showing it to anonymous requires a separate (and unauthed) endpoint — wrong direction. |
| Popover-only meter (no inline numbers on desktop) | Discoverability. Users will not tap an unlabelled icon speculatively. Inline numbers on desktop are read passively and reinforce value without requiring interaction. |
| Animated counter increment using a flip/scroll number animation | Overproduced for a utilitarian header element. A simple `transition-all duration-300` on opacity+position is sufficient. |
| Showing "Regístrate para más consultas" nudge inside `<UsageMeter>` for low/critical states | The nudge targeting for logged-in users is out of scope for this feature (they are already registered; the pro-upsell path does not exist yet). Do NOT add upsell copy inside the meter for this feature. |
| Rendering `<UsageMeter>` when admin tier (`limit: null`) | Admin users should not see quota anxiety chrome. Render null when `limit === null`. |
| Hard-coding reset time as "medianoche" | The actual `resetAt` is UTC midnight — in Spain (UTC+1/+2) this is 01:00 or 02:00 local. Use the `resetAt` ISO timestamp from the API and format it correctly, or state "mañana" (acceptable approximation) without implying local midnight. |

---

*Section added: 2026-05-26 | Feature: F-WEB-TIER | Designer: ui-ux-designer agent*

---

## Web App `/hablar` — F-WEB-HISTORY: Session transcript + persisted history

**Package:** `packages/web/` | **Added:** 2026-05-27 | **Status:** Design Approved
**Applies to:** `HablarShell`, `ResultsArea`, and the new components: `TranscriptFeed`, `TranscriptEntry`, `HistoryEmptyState`, `HistoryPersistenceNudge`, `DeleteEntryButton`, `ClearHistoryButton`.

> These notes extend the existing W1–W14 block. All new surfaces share the same white-background, brand-green, slate palette established in W1. Do not introduce new shadow tokens, new border-radius values, or new brand colors.

---

### W15. Architecture: two-tier model

F-WEB-HISTORY has two distinct layers that share a **single visual surface** — the transcript feed.

**Tier 1 — Session transcript (everyone):** the existing single-result area becomes an append-only vertical list. Each query+result pair is a `TranscriptEntry`. Entries stack oldest-at-top, newest-at-bottom (see W16 for the rationale). Anonymous users only ever see Tier 1.

**Tier 2 — Persisted history (logged-in only):** on page load, authenticated accounts have their last ~10 entries pre-populated into the same feed from the API. New results still append below. Scrolling up past the first pre-loaded entry triggers a backwards-loading sequence (infinite scroll upwards). There is no separate panel, drawer, or route for persisted history — it lives inside the same feed.

**Single surface rationale:** the current `/hablar` layout is a single column constrained to `lg:max-w-2xl lg:mx-auto` (established in `ResultsArea.tsx:312`). A second panel (side drawer, route `/hablar/historial`) would break this single-column constraint and require responsive coordination that adds significant complexity. A unified feed is simpler, and the distinction between "just-searched" and "pre-loaded from history" is communicated through visual treatment on the entry header, not through separate UI regions.

---

### W16. Session transcript feed layout

#### Feed order: oldest at top, newest at bottom

The input is at the **bottom** of the screen (`ConversationInput` is the last element in `HablarShell`'s flex column, `HablarShell.tsx:547`). New results arrive at the bottom — adjacent to the input that produced them. This matches reading gravity: the user's last action is always visible at the bottom without scrolling. Oldest results scroll upward and off screen — they are historical context, not the primary focus.

Contrast with chat apps (newest at bottom, input at bottom) — this is the **same** convention. The current shell already has this shape; the refactor makes it explicit.

**Do NOT** invert the order (newest at top). A search tool is not a social feed. Inverting creates cognitive dissonance: you type at the bottom, the result appears at the top, you must scroll up to read it. That is the wrong reading direction for this interaction.

#### Feed container

The existing `ResultsArea` flex region (`flex-1 overflow-y-auto`) becomes the `TranscriptFeed` container:

```
┌───────────────────────────────────────┐  ← header (h-[52px], fixed)
│  [header: logo + auth slot]           │
├───────────────────────────────────────┤
│                                       │  ← TranscriptFeed (flex-1 overflow-y-auto)
│  [older entries — scroll up]          │
│  ─────────────────────────────────── │  ← entry divider
│  TranscriptEntry N-1                  │
│  ─────────────────────────────────── │
│  TranscriptEntry N  ← most recent    │
│                                       │
├───────────────────────────────────────┤
│  [RateLimitNudge — conditional]       │
├───────────────────────────────────────┤
│  [ConversationInput — fixed bar]      │
└───────────────────────────────────────┘
```

- Container: `flex-1 overflow-y-auto px-4 pt-4 pb-6` — note `pb-6` rather than the current `pb-24` (the `pb-24` in `CardGrid` was compensating for the fixed input bar; with a proper flex layout the feed should use `pb-4` or `pb-6` and rely on the ConversationInput occupying its own flex row, not overlapping).
- Max-width constraint: `lg:max-w-2xl lg:mx-auto` (inherited, unchanged).
- After a new result is added, auto-scroll the container to its bottom: `scrollTo({ top: container.scrollHeight, behavior: 'smooth' })`. Smooth scroll, not instant — the user must see the result arrive, not snap to it.
- **Do NOT auto-scroll** if the user has manually scrolled upward (reviewing older entries). Detect this by comparing `scrollTop + clientHeight` against `scrollHeight` before auto-scrolling — only auto-scroll when the user is already near the bottom (within 100px). This prevents the feed from hijacking the user's position when they are reviewing history.

#### Entry spacing and dividers

Between entries, use a **horizontal rule** as the divider:

```
<hr class="border-t border-slate-100 my-4" aria-hidden="true" />
```

- `border-slate-100` (`#F1F5F9`) — the lightest border token already in use. Visible but unobtrusive.
- `my-4` (16px top + bottom) — enough breathing room to read as a distinct entry boundary without wasted space.
- Do NOT use card grouping (wrapping each entry in a white card with shadow) — that would visually compete with the result cards inside each entry. The divider is correct.
- Do NOT use large timestamp banners as the primary separator. A timestamp appears inside the entry header (W17), not as a full-width separator.

#### Empty state (no entries, anonymous or first-time logged-in)

When the feed has zero entries on load:

- Reuse the existing `EmptyState` component (currently in `packages/web/src/components/EmptyState.tsx`) — it renders the zero-query prompt. No design change needed.
- Position: centered vertically in the feed region — `flex flex-1 items-center justify-center` (existing pattern from `ResultsArea.tsx:181`).

---

### W17. TranscriptEntry anatomy

Each entry in the feed contains two sub-regions: the **query echo** (header) and the **result body** (the existing result cards).

#### Query echo header

Every entry opens with a compact header line showing what was asked:

```
┌─────────────────────────────────────────────────────┐
│  🕐  13:42  ·  "tortilla española con chorizo"    [×] │
└─────────────────────────────────────────────────────┘
```

- Container: `flex items-center gap-2 mb-3`
- Timestamp: `text-[11px] text-slate-400 whitespace-nowrap tabular-nums` — e.g. "13:42" (time only for today's entries; date + time for entries from prior days, e.g. "26 may · 13:42"). Use the user's local timezone.
- Separator dot: `·` in `text-slate-300` — `mx-1` spacing
- Query text: `text-sm font-medium text-slate-600 truncate flex-1` — truncated with `…` if it exceeds one line. The full query text is available on hover via `title={queryText}` attribute. This prevents very long queries from breaking the feed rhythm.
- Source type indicator (icon, `aria-hidden`): a small inline icon (16px, stroke 1.5) communicating the input modality:
  - Text query: no icon (text is the default; adding an icon for "text" is noise)
  - Voice query: microphone icon in `text-slate-400` — `mr-1`
  - Photo query: camera icon in `text-slate-400` — `mr-1` (photo results in session only; never persisted — see W18)
- Delete button `[×]`: see W21 for full spec. Visible only on `hover` (desktop) or always visible (mobile). Positioned at the far right with `ml-auto flex-shrink-0`.

**Logged-in vs session-only distinction:**

Entries preloaded from persisted history receive a subtle marker so users can orient themselves:

- Prepend a small `"Guardado"` badge on the timestamp line: `inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 mr-1`
  - Label: "Guardado" (no icon — the text is sufficient)
  - This badge only appears on entries fetched from the server. Entries added during the current session do NOT get this badge — their recency is sufficient context.
  - Do NOT show this badge for anonymous session entries (they are never persisted).

#### Result body

Below the query echo, the result body renders the **existing result cards unchanged**:

- `NutritionCard` — estimation, comparison, menu_estimation, follow_up_*, reverse_search
- `ContextConfirmation` — context_set
- `MenuDishList` — multi-dish photo result (session only)
- `ErrorState` — per-entry inline error (see W19)

No structural change to the result cards is needed. They are reused as-is. The `TranscriptEntry` wraps them; it does not modify them.

**Photo results** appear in the live session feed (showing `MenuDishList` or a single-dish `NutritionCard`) but are explicitly excluded from persisted history (research doc §D "D3: foto en histórico fuera de v1"). Photo entries therefore never get the "Guardado" badge and do not survive a page refresh for logged-in users — they are session-only, same as anonymous.

---

### W18. Persisted history — loading and scroll

#### Pre-load on mount (~10 entries)

On page load for authenticated users, the feed pre-populates with the most recent ~10 persisted entries, oldest first (so entry #1 is at the top, entry #10 is just above the empty input). The feed then scrolls to the bottom immediately on mount (no animation — the initial position should feel like arriving at the current state, not replaying history).

```
Feed on mount (logged-in, has history):

  ─── (load-more sentinel, invisible, at the top)
  TranscriptEntry  1  [Guardado]  ← oldest pre-loaded
  ──────────────────────────────
  TranscriptEntry  2  [Guardado]
  ...
  ──────────────────────────────
  TranscriptEntry 10  [Guardado]  ← most recent pre-loaded
  ─────────────────────────────── ← (current session starts here)
  (empty — user hasn't searched yet this session)
```

The 10 pre-loaded entries and the current session entries are **not** visually separated by a banner or header. The "Guardado" badge on the pre-loaded entries is the only distinction. Do not add a "Historial anterior" section header — it over-partitions a naturally continuous feed.

#### Infinite scroll backwards (load more older entries)

A sentinel element sits at the very top of the feed, above all entries. When the user scrolls to the top and the sentinel enters the viewport, the next page of history loads above the current oldest entry.

**Loading skeleton while fetching older entries:**

```
┌─────────────────────────────────────────────────┐
│  [shimmer bar — 40px tall, rounded-xl]           │  ← query echo skeleton
│  [shimmer card — 120px tall, rounded-2xl]        │  ← result skeleton
└─────────────────────────────────────────────────┘
```

- Query echo skeleton: `h-4 w-48 rounded-full shimmer-element mb-3`
- Result skeleton: `h-[120px] rounded-2xl shimmer-element` (single card; matches NutritionCard rough height)
- Show 2–3 skeleton entries while loading. They appear above the current topmost entry.
- After data arrives, the skeletons are replaced and the scroll position is adjusted to maintain the user's viewport position (the entry they were reading should not jump). This requires the implementation to record `scrollTop` before the insert and restore it after.

**Load-more trigger visual:** the sentinel itself is invisible (`h-px w-full` — a zero-height spacer). Do NOT show a "Cargar más" button. Infinite scroll backwards is the correct affordance for a continuous log; a manual load button interrupts the scroll rhythm.

**End of history:** when the API returns an empty page (no more older entries):

- Remove the sentinel.
- Optionally insert a muted end-cap label at the very top of the feed: `"Inicio del historial"` — `text-center text-[11px] text-slate-400 py-3`. This tells the user they have reached the earliest saved entry, preventing infinite upward scroll confusion.

---

### W19. In-feed loading and error states

#### In-flight query (new result arriving)

While a new query is in flight, a **loading entry** is appended to the bottom of the feed immediately after submission. It occupies the position the result will land in:

```
TranscriptEntry N (just added)
  [query echo: "tortilla española..." ]
  [single shimmer card: h-[100px] rounded-2xl shimmer-element]
```

- The query text is shown in the echo immediately (optimistic) — the user sees their query echoed right away.
- The shimmer card below is the loading placeholder. Use one shimmer card for text/voice queries (a single NutritionCard is the most common result). For photo analysis, use a taller shimmer (`h-[200px]`) matching the W4 pattern.
- This replaces the current `LoadingState` full-screen takeover (`ResultsArea.tsx:99-105`). The loading state is now scoped to the in-flight entry, not the whole results area.

#### Per-entry error state

When a query fails, the error renders **inside the entry** at the result body position — replacing the shimmer:

```
TranscriptEntry N
  [query echo: "tortilla española..." ]
  ┌─────────────────────────────────────┐
  │  ⚠  Sin conexión. Comprueba tu red.  │
  │     [Reintentar]                     │
  └─────────────────────────────────────┘
```

- Container: `rounded-xl border border-red-100 bg-red-50 px-4 py-3 flex items-start gap-3` — uses the existing semantic error palette (red-50 background).
- Warning icon: 20px inline SVG, `text-red-500`, `flex-shrink-0 mt-0.5`.
- Message: `text-sm text-red-700 flex-1` — the existing Spanish error strings from `HablarShell` (unchanged copy).
- Retry button: `mt-2 text-sm font-medium text-brand-green underline underline-offset-2 hover:opacity-80 transition-opacity` — text link style, not a filled button. The entry is already in an error state; a heavy retry button would dominate the layout. A text link is sufficient and keeps visual weight low.
- `role="alert"` on the container — announced immediately by screen readers.

**Do NOT** clear the error entry from the feed when the user retries. The retry should add a NEW entry below (with the same query) rather than mutating the failed entry in place. Mutating in-place is confusing in a feed — the user loses the failure signal. New entry on retry is the correct pattern.

**Inline error (text_too_long, photo validation):** these remain in `ConversationInput` as before (current `inlineError` pattern, `HablarShell.tsx:553`). They do NOT create a `TranscriptEntry` because no query was sent.

---

### W20. Anonymous vs logged-in: persistence nudge

Anonymous users see the session transcript (Tier 1 only). When the session has accumulated at least 2 entries, display a gentle persistence nudge **above the current session's first entry** — between the "start of session" conceptual boundary and the first result:

```
  ────────────────────────────────────────────────
  ┌──────────────────────────────────────────────┐
  │  Guarda tu historial entre sesiones           │
  │  Regístrate para no perder tus consultas.     │
  │  [Crear cuenta gratis]                        │
  └──────────────────────────────────────────────┘
  ────────────────────────────────────────────────
  TranscriptEntry 1
  ────────────────────────────────────────────────
  TranscriptEntry 2
```

- Trigger: show only when `entries.length >= 2` (user has demonstrated use). Never show on first result — it feels predatory.
- Show once per session (dismiss on first render; do NOT re-show if the user scrolls past it).
- Position: above the first session entry, NOT above the input, NOT as a floating sticky element, NOT as a modal. It blends into the feed as an informational card.
- Container: `rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4`
  - Header: `text-sm font-semibold text-slate-700 mb-1` — "Guarda tu historial entre sesiones"
  - Body: `text-sm text-slate-500 leading-relaxed mb-3` — "Regístrate para no perder tus consultas."
  - CTA button: same spec as `RateLimitNudge` CTA (`bg-brand-green text-white text-sm font-semibold rounded-lg px-4 py-2`) — but label changes to **"Crear cuenta gratis"**
  - Dismiss `×` button: `absolute top-2 right-2 text-slate-400 hover:text-slate-600 p-1 rounded focus-visible:ring-2 focus-visible:ring-brand-green` — allows users to close the nudge without acting. `aria-label="Cerrar sugerencia"`.
  - Container: `relative` to contain the dismiss button.

**Relationship to existing `<LoginCta>` and `<RateLimitNudge>`:**

| Component | Trigger | Tone | Placement |
|---|---|---|---|
| `<LoginCta>` (W10) | Always visible (logged-out) | Passive / secondary | Header right slot |
| `<RateLimitNudge>` (W12) | 429 error + anonymous | Urgent / benefit-framing | Below error in ResultsArea |
| `HistoryPersistenceNudge` (W20) | ≥2 session entries + anonymous | Gentle / informational | Inline feed, above entry 1 |

These three components serve different moments in the anonymous user journey. They must NOT all appear simultaneously in a confusing stack. Rule: if `RateLimitNudge` is currently visible (user hit 429), suppress `HistoryPersistenceNudge` — the nudge hierarchy is rate-limit > persistence (one is about immediate loss, the other is a longer-term benefit).

**Logged-in users** never see `HistoryPersistenceNudge`. The nudge renders `null` when `user !== null`.

---

### W21. Delete UX

#### Per-entry delete

The delete affordance for a single entry:

```
[timestamp] · [query text truncated]          [trash icon]
                                              ← ml-auto, flex-shrink-0
```

- **Element:** `<button type="button">` — `p-1.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1`
- **Icon:** 16px inline SVG trash icon, `aria-hidden="true"`. Stroke 1.5.
- **Visibility:**
  - Desktop (≥ `md:`): hidden by default, visible on `group-hover` of the entry header row. Use Tailwind `group` on the entry header and `group-hover:opacity-100 opacity-0` on the button.
  - Mobile (< `md:`): always visible at `opacity-60` (reduced, not hidden — hover does not exist on touch). Tap to activate.
- **`aria-label`:** `"Eliminar consulta: {queryText truncated to 40 chars}"` — gives screen readers context about which entry is being deleted.
- **Confirmation step:** a **small inline confirm row** replaces the delete button immediately on click:
  ```
  ¿Eliminar esta consulta?  [Cancelar]  [Eliminar]
  ```
  - Confirm row container: `flex items-center gap-2 text-sm` — appears in-place where the delete icon was (within the entry header, far right).
  - Prompt text: `text-slate-500 text-xs whitespace-nowrap`
  - Cancel: `text-slate-500 text-xs underline underline-offset-2 hover:opacity-80` (text link)
  - Confirm (destructive): `text-red-600 text-xs font-semibold underline underline-offset-2 hover:opacity-80`
  - Auto-dismiss the confirm row after 5 seconds of inactivity (revert to the trash icon) — prevents orphaned confirmation states if the user gets distracted.
  - On mobile, this inline confirm is preferred over a swipe-to-delete gesture. Swipe requires gesture discovery (invisible affordance), conflicts with the scroll gesture in the feed, and has no native equivalent in the web browser without a dedicated library. The inline confirm is simpler and consistent across all devices.

**Recommendation: inline confirm (no undo toast).** Undo requires maintaining deleted data in memory and managing a timer+toast system. For a history entry, the loss is low-stakes — the user can simply re-run the query. Inline confirm is the right cost/benefit trade-off. If the owner decides undo is needed later, it can be added without changing the visual delete affordance.

#### "Borrar todo el historial" (clear all)

This action is not in the feed itself — it belongs in a settings surface. For v1 (pre-settings route), place it as a **text link button at the top of the pre-loaded history block**, visible only to logged-in users with at least 1 persisted entry:

```
  ── [Borrar todo el historial] ──────────────────    ← top of feed, above oldest entry
  TranscriptEntry 1  [Guardado]
  ...
```

- Element: `<button type="button">` — ghost link style: `text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1`
- Placement: `flex justify-end mb-3` — right-aligned above the oldest persisted entry.
- **Confirmation step:** because this is destructive for ALL data, use a **confirmation modal / dialog** rather than the inline confirm pattern:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│   Vas a eliminar todo tu historial de búsqueda.  │
│   Esta acción no se puede deshacer.              │
│                                                  │
│   [Cancelar]          [Borrar todo]              │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Dialog: `fixed inset-0 z-50 flex items-center justify-center` backdrop + centered card.
- Backdrop: `bg-slate-900/50` (semi-opaque, not a full black overlay — the content is still partially visible).
- Card: `bg-white rounded-2xl shadow-layered px-6 py-5 max-w-sm mx-4`
- Title: `text-base font-semibold text-slate-800 mb-2` — "Borrar todo el historial"
- Body: `text-sm text-slate-500 leading-relaxed mb-5` — "Vas a eliminar todo tu historial de búsqueda. Esta acción no se puede deshacer."
- Cancel button: `border border-slate-200 text-slate-700 text-sm font-medium rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors duration-150`
- Confirm (destructive): `bg-red-500 text-white text-sm font-semibold rounded-xl px-4 py-2 hover:opacity-90 active:scale-[0.98] transition-all duration-150`
- Button row: `flex gap-3 justify-end` — cancel on the left, destructive on the right (standard destructive dialog convention).
- `role="alertdialog" aria-modal="true" aria-labelledby="dialog-title"` — traps focus inside while open.
- Focus: on open, move focus to the **Cancel button** (not the destructive button) — WCAG 3.3.4 (non-destructive default).
- Escape key: closes the dialog (same as Cancel).

After successful deletion: the feed empties to `HistoryEmptyState` (see W22). The "Borrar todo el historial" button disappears (no entries remain). No success toast needed — the visible empty feed is sufficient feedback.

---

### W22. Empty state (post-delete, first-time logged-in)

When a logged-in user has no persisted history (first use or after clear-all):

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   (magnifier icon, 32px, text-slate-300)        │
│                                                 │
│   Aún no tienes historial                       │
│   Tus consultas de texto y voz se guardarán     │
│   aquí automáticamente.                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

- Outer container: `flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center py-12`
- Icon: 32px magnifier inline SVG, `text-slate-300` — same icon family as the rest of the app (stroke 1.5, `aria-hidden="true"`).
- Heading: `text-[15px] font-semibold text-slate-500` — "Aún no tienes historial"
- Body: `text-sm text-slate-400 leading-relaxed max-w-[240px]` — "Tus consultas de texto y voz se guardarán aquí automáticamente."
- Note that photos are excluded from persistence (D3 decision) — do NOT mention photos in this copy. The message covers text and voice only.
- This `HistoryEmptyState` is different from the existing `EmptyState` (which addresses anonymous first-use). They are separate components — do not merge them. `EmptyState` remains unchanged.

---

### W23. Accessibility for F-WEB-HISTORY

#### Feed ARIA

- The `TranscriptFeed` container: `role="feed"` — the correct ARIA role for a reverse-chronological, appendable list of items where items have independent meaning.
- `aria-label="Historial de consultas"` on the feed container.
- `aria-busy="true"` on the feed container while initial history is loading (mount fetch). Set back to `aria-busy="false"` when data arrives. This prevents screen readers from announcing a partial list.
- Each `TranscriptEntry`: `role="article"` — semantically an independent result item within the feed. `aria-label="{queryText truncated} — resultado"`.

#### Live region for new results

When a new result is appended (end of query):

- The appended `TranscriptEntry` announces via the feed's `aria-live="polite"` (inherited from `role="feed"`). No additional `aria-live` region needed.
- The query echo text (W17) must be in the DOM before the result card renders — screen readers announce the query echo first, then the result card (in DOM order). This matches the natural reading sequence.

#### Live region for loading state

While an in-flight query's shimmer is visible (W19):

- The in-flight entry has `aria-label="Cargando resultado para: {queryText}"` and `aria-busy="true"`. When the result arrives, `aria-busy` is removed and the shimmer is replaced.

#### Keyboard navigation

- Tab through the feed: each `TranscriptEntry`'s delete button (W21) is a tab stop. The delete confirm row (Cancel + Delete) is also a tab stop sequence. Escape cancels the confirm row.
- `TranscriptEntry` result cards: the existing keyboard nav inside `NutritionCard`, `MenuDishList`, etc. is unchanged.
- The "Borrar todo el historial" button: at the top of the feed, it appears before the first entry in tab order — keyboard users encounter it before the entries, which is the correct order (action before content, same as table-level actions above a data table).
- The `ClearHistoryButton` dialog: `focus-trap` is required while the dialog is open. Focus returns to the "Borrar todo el historial" button on dialog close (Cancel or after success).

#### Infinite scroll (keyboard)

- When the scroll sentinel triggers (mouse/touch scroll), the new entries appear at the top of the feed. Keyboard users who have no scroll interaction cannot trigger the sentinel. Provide a **"Cargar más historial"** button as a fallback — `text-sm text-brand-green underline underline-offset-2` — at the very top of the feed, above the sentinel. It is visually hidden by default (`sr-only`) and becomes visible on focus (`focus-not-sr-only` pattern). This is the keyboard alternative to scroll-triggered loading.

#### Touch targets

- Delete button: `p-1.5` around a 16px icon = 19px intrinsic. On iOS the OS expands to 44px. Acceptable for a secondary action that requires a confirmation step before taking effect.
- "Borrar todo el historial" text link: too small for standalone 44px. Wrap in a `min-h-[44px] flex items-center` container to expand the tap target without changing the visual size.
- Entry rows are not themselves tappable (the result cards inside are tappable if they have actions). The entry header is not interactive except for the delete button.

---

### W24. Responsive and mobile behavior

#### Single-column, full-width feed (all breakpoints)

The feed remains single-column at all breakpoints. At `lg:`, the feed centers with `lg:max-w-2xl lg:mx-auto` (existing constraint from `ResultsArea.tsx:312`). No two-column split is introduced.

#### Query echo truncation on mobile

On 375px screens, a long query echo (e.g. "¿Qué tiene más proteína, el pollo a la plancha o el salmón con patatas?") must not wrap to multiple lines — it would dominate the entry header and push the delete button to a second row. Use `truncate` (CSS `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) with `max-w-[calc(100%-80px)]` to leave room for the timestamp + delete button.

At wider viewports (≥ `md:`), the truncation threshold relaxes — 40 characters can display without truncation. Use `md:max-w-none md:truncate-none` to allow full display on tablet+, falling back to truncation on mobile.

#### Delete UX on mobile (revisited)

The per-entry delete button is always visible on mobile at `opacity-60` (stated in W21). At 375px with `p-1.5` padding, the trash icon renders at 19px intrinsic. iOS will expand the touch target. This is adequate given the confirm step protects against accidental deletion.

No swipe-to-delete on mobile. Rationale: `TranscriptFeed` is itself a vertically scrollable container; swipe gestures would conflict with the scroll. Do not implement horizontal swipe actions inside a vertical scroll feed.

#### Infinite scroll sentinel on mobile

On mobile, upward scroll to the top of the feed is a natural gesture. The sentinel works identically on mobile — no special affordance needed. The fallback keyboard button (W23) is available but irrelevant for touch users.

---

### W25. Animations and motion for F-WEB-HISTORY

| Trigger | Element | Animation | Spec |
|---|---|---|---|
| New `TranscriptEntry` appended | Entry container | Fade + slide-up (upward from below) | `.card-enter` class (existing, `globals.css:43`) |
| Pre-loaded history entries on mount | All pre-loaded entries | No animation — render immediately | Instant render prevents "waterfall" stagger of 10+ entries which would feel slow |
| Infinite-scroll batch arrives | New old entries at top | Fade-in only (no slide) | `animate-fadeIn` — 150ms opacity 0→1. No slide (slide direction unclear for "older" entries arriving above) |
| Loading shimmer | In-flight entry shimmer | `.shimmer-element` | Existing class — consistent |
| Delete confirm row appears | Inline confirm buttons | Fade-in | `transition-opacity duration-150` — 150ms opacity 0→1 |
| Confirmation dialog opens | Dialog card | Fade + scale-up | `initial: opacity 0, scale 0.95` → `final: opacity 1, scale 1` — 150ms ease-out |
| "Borrar todo" post-delete | Feed clears | Fade-out entries | Each entry fades out over 200ms, staggered by 30ms (oldest first) — then `HistoryEmptyState` fades in at 150ms |

#### What NOT to animate

- Do NOT stagger the 10 pre-loaded history entries on mount. A stagger of 10 entries × 100ms = 1000ms of animation before the user can scroll. Instant render is correct for pre-loaded data.
- Do NOT slide new entries from the right (horizontal slide implies navigation, not append).
- Do NOT animate `TranscriptEntry` removal (per-entry delete). After the inline confirm, remove instantly — the confirm step was the user's deliberate action; the removal should feel immediate.
- `prefers-reduced-motion`: all `.card-enter`, shimmer, fade, and dialog animations are already suppressed by `globals.css:97-115`. No additional work needed.

---

### W26. Anti-patterns specific to F-WEB-HISTORY

| Anti-pattern | Why |
|---|---|
| Newest entry at the TOP of the feed | The input is at the bottom; the result should appear adjacent to the input (bottom). Inverting creates a cross-screen reading path. |
| Separate `/hablar/historial` route or side panel | Breaks the single-column shell. Adds navigation state. The unified feed is simpler and requires no route change. |
| Session divider banner ("Sesión del 27 de mayo") | Over-partitions the feed. The "Guardado" badge already marks pre-loaded entries. A session banner adds chrome without user value. |
| Persisting photo results (v1) | Out of scope per research doc §D "D3: foto fuera de v1". Do not design for it here. |
| Showing `HistoryPersistenceNudge` on the very first result | Predatory UX. Only show after ≥2 entries — the user must have demonstrated use before you pitch registration. |
| Swipe-to-delete on mobile | Conflicts with vertical scroll gesture inside the feed. |
| Undo toast instead of inline confirm | Undo requires in-memory tombstone management. For a low-stakes history entry, inline confirm is sufficient. |
| Auto-scroll to bottom when user is reading old entries | Hijacks the user's scroll position. Only auto-scroll when already near the bottom (within 100px of `scrollHeight`). |
| Animating all 10 pre-loaded entries on mount with stagger | 1000ms+ of animation before the page is usable. Instant render for pre-loaded data. |
| "Borrar todo" as an inline confirm (same as per-entry delete) | Bulk destructive actions warrant a modal — the stakes are higher and the pattern distinction teaches users that modals mean "irreversible". |
| Showing the `HistoryPersistenceNudge` when `RateLimitNudge` is also visible | Two simultaneous registration prompts compete for attention and read as desperate. Suppress the persistence nudge when rate-limit nudge is active. |
| Color-coding transcript entries by query type (text/photo/voice) | Adds visual noise. The modality icon in the entry header is sufficient. |
| Showing a loading spinner in the feed header (top of page) while history loads on mount | The feed should render with `aria-busy="true"` and shimmer entries inside — not a spinner at the top that competes with the app bar. |

---

*Section added: 2026-05-27 | Feature: F-WEB-HISTORY | Designer: ui-ux-designer agent*
