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
