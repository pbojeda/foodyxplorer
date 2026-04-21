# Design Guidelines — /hablar Conversational Assistant (Phase C)

**Version:** 1.0
**Created:** 2026-04-08
**Status:** Approved
**Applies to:** `packages/web/` package, `/hablar` route
**Companion document:** `docs/specs/design-guidelines.md` (landing page system — read that first)

> This document is feature-specific. It does NOT repeat global values from `design-guidelines.md`.
> It only defines what is different, extended, or new for the /hablar interface.

---

## 1. Visual Direction

### Relationship to the Landing Page

`/hablar` shares the same brand DNA as the landing page — same font, same color tokens, same border-radius scale — but it is a different type of interface:

| Dimension | Landing Page | /hablar |
|-----------|-------------|---------|
| Purpose | Marketing conversion | Operational utility |
| Mental model | Article / product page | Tool / assistant |
| Primary interaction | Scroll + single form | Repeated query + results |
| Visual density | Low (breathing room) | Medium (results need space) |
| Animation budget | Generous (entrance animations) | Minimal (speed is the feature) |
| Background | Ivory `#FDFBF7` | White `#FFFFFF` (cleaner for results scanning) |
| Layout structure | Vertical sections | Single-screen shell with scrollable results area |

### Mood

Clean, fast, focused. The interface should feel like a professional tool that respects the user's time. They are in a restaurant. They are hungry. They need an answer in seconds.

Key principle: **The result is the hero, not the interface.** Chrome, decoration, and animation should recede. The nutrition data should pop.

### What it is NOT

- Not a chatbot with message bubbles (no chat history by default)
- Not a dashboard (no sidebar navigation, no persistent panels)
- Not a search engine results page (results are structured cards, not a list of links)
- Not a full-screen marketing experience (no hero sections, no CTAs, no landing-page rhythm)

---

## 2. Color Palette

Reuse all tokens from `design-guidelines.md` section 2. The additions below are exclusively for voice interaction states.

### 2.1 Inherited Tokens (use without change)

```
brand-green:  #2D5A27   — focus rings, confidence badges, active states
brand-orange: #FF8C42   — primary CTA, non-voice submit button
ivory:        #FDFBF7   — not used as page bg here, but used for card surfaces on white
paper:        #F7F7F2   — input area background
mist:         #EEF4EC   — subtle chip/badge backgrounds
slate-700:    #334155   — primary text
slate-500:    #64748B   — secondary text, metadata
slate-300:    #CBD5E1   — borders
slate-100:    #F1F5F9   — card borders
white:        #FFFFFF   — page background, nutrition card surface
```

### 2.2 Voice State Colors (new additions)

These are ONLY used in the voice overlay and mic button states. Do not bleed them into the rest of the UI.

| Token | Hex | Role |
|-------|-----|------|
| `voice-idle-ring` | `rgba(203, 213, 225, 0.35)` | Concentric ring color, idle state (soft slate) |
| `voice-listening-ring` | `rgba(45, 90, 39, 0.15)` | Concentric ring color, active listening (brand-green tint) |
| `voice-listening-ring-mid` | `rgba(45, 90, 39, 0.08)` | Outer ring, listening (more transparent) |
| `voice-processing-ring` | `rgba(255, 140, 66, 0.20)` | Ring color during API processing (brand-orange tint) |
| `mic-surface` | `#2D5A27` | Mic button fill (brand-green — NOT red like Google Maps; this is nutriXplorer) |
| `mic-surface-hover` | `#245220` | Mic button hover (brand-green darkened ~8%) |
| `mic-surface-active` | `#1C4019` | Mic button pressed |
| `mic-surface-disabled` | `#64748B` | Mic button disabled / not supported |
| `tts-playing-ring` | `rgba(212, 168, 67, 0.25)` | Ring color when TTS is speaking (accent-gold tint) |

Design rationale: Google Maps uses red for their mic because it mirrors the Google brand color. nutriXplorer's mic uses brand-green to maintain brand coherence and because green communicates "active / go / safe" which fits a nutrition context better than the urgency of red.

### 2.3 Nutrition Card Semantic Colors

These extend the landing's confidence levels (section 2.2 of design-guidelines.md) with additional macronutrient-specific accent colors for the results cards:

| Nutrient | Accent color | Background chip | Usage |
|----------|-------------|----------------|-------|
| Calories / kcal | `#FF8C42` (brand-orange) | `bg-orange-50 text-orange-700` | Primary calorie number |
| Protein | `#2D5A27` (brand-green) | `bg-emerald-50 text-emerald-800` | Protein grams |
| Carbohydrates | `#D4A843` (accent-gold) | `bg-amber-50 text-amber-800` | Carbs grams |
| Fat | `#64748B` (slate-500) | `bg-slate-100 text-slate-700` | Fat grams |
| Fiber | `#4ADE80` → `text-green-700` | `bg-green-50 text-green-700` | Fiber grams |
| Allergen warning | `#EF4444` (red-500) | `bg-red-50 text-red-700 border border-red-200` | Allergen tags |

These do NOT require new Tailwind tokens — they use standard Tailwind color classes.

---

## 3. Typography

Same font stack as landing: `Inter` via `next/font/google`.

The scale differs because /hablar is an interactive tool, not a long-form page.

### 3.1 /hablar Type Scale

| Element | Size | Weight | Line-height | Tailwind |
|---------|------|--------|-------------|----------|
| Page title (if shown) | `20px` | `700` | `1.3` | `text-xl font-bold` |
| Dish / result name | `18px` | `700` | `1.3` | `text-lg font-bold` |
| Primary macro value (kcal) | `28px` | `800` | `1` | `text-[28px] font-extrabold` |
| Macro label | `11px` | `600` | `1.4` | `text-[11px] font-semibold uppercase tracking-wide` |
| Macro value (other) | `18px` | `700` | `1` | `text-lg font-bold` |
| Card body / description | `14px` | `400` | `1.55` | `text-sm leading-normal` |
| Confidence badge text | `11px` | `600` | `1` | `text-[11px] font-semibold` |
| Input placeholder | `16px` | `400` | `1.5` | `text-base` (minimum 16px to prevent iOS zoom) |
| Input typed text | `16px` | `400` | `1.5` | `text-base` |
| Voice overlay prompt ("Habla ahora") | `18px` | `400` | `1.4` | `text-lg` |
| Voice overlay hint | `13px` | `400` | `1.5` | `text-[13px]` |
| Error / empty state message | `15px` | `500` | `1.5` | `text-[15px] font-medium` |
| Section label / chip | `12px` | `600` | `1` | `text-xs font-semibold uppercase tracking-widest` |

### 3.2 Text Color Rules for /hablar

- Dish name: `text-slate-800` (slightly heavier than body — it's the primary identifier)
- Primary kcal value: `text-brand-orange`
- Other macro values: `text-slate-700`
- Macro labels: `text-slate-500`
- Card description text: `text-slate-500`
- Input text: `text-slate-700`
- Voice prompt "Habla ahora": `text-slate-400` (intentionally receded — the mic button is the focus)
- Error messages: `text-red-600`

---

## 4. Component Inventory

These are the key UI components for /hablar. All components inherit base styles (Button, Card, Input) from the landing's `packages/landing/src/components/ui/` when the web package is set up, or replicate their token usage exactly.

### 4.1 ConversationInput

The primary input bar, fixed at the bottom of the viewport on mobile. Contains the text field, mic button, and photo button in a horizontal row.

```
Layout: fixed bottom-0 left-0 right-0
Background: bg-white border-t border-slate-200
Padding: px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]
Blur backdrop: backdrop-blur-sm (for content scrolling underneath)

Inner row: flex items-center gap-2

Text input:
  flex-1 bg-paper rounded-2xl px-4 py-3 text-base
  border border-slate-200
  focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 focus:outline-none
  placeholder:text-slate-400
  transition-colors duration-200
  min-height: 48px (touch target)

Mic button: see 4.2
Photo button: see 4.3
Submit button: see 4.4
```

Safe area inset is required for iOS home indicator.

### 4.2 MicButton

The primary voice trigger. This is the most important interactive element in /hablar.

```
Shape: rounded-full (circle)
Size: 48px x 48px (touch-friendly minimum)
Default state:
  bg-brand-green text-white shadow-soft
  hover:bg-[#245220]
  active:scale-[0.96]
  transition-all duration-150
  focus:ring-2 focus:ring-brand-green focus:ring-offset-2

Listening state:
  bg-brand-green (same fill — animation communicates state, not color change)
  ring variant removed (rings are the animation, not the focus ring)

Processing state:
  bg-slate-400 cursor-not-allowed (interaction disabled while waiting)

Disabled / not supported:
  bg-slate-300 text-slate-400 cursor-not-allowed

Icon: Microphone SVG, 24px, currentColor, stroke 1.5px
Aria: aria-label="Iniciar búsqueda por voz" | aria-label="Detener escucha"
     aria-pressed="true" when listening
```

### 4.3 PhotoButton

Secondary action trigger for photo mode (F092).

```
Shape: rounded-xl
Size: 48px x 48px
Style: border border-slate-200 bg-white text-slate-500
       hover:bg-slate-50 hover:text-slate-700
       active:scale-[0.96]
       transition-all duration-150
Icon: Camera SVG, 22px, currentColor, stroke 1.5px
Aria: aria-label="Buscar por foto del menú"
```

### 4.4 SubmitButton

Appears when text is present in the input. Replaces or complements the mic button.

```
Shape: rounded-xl
Size: 48px x 48px (square variant of primary button)
Style: bg-brand-orange text-white shadow-soft
       hover:opacity-90
       active:scale-[0.98]
       disabled:opacity-40 disabled:pointer-events-none
       transition-all duration-200
Icon: Send/Arrow SVG, 20px, currentColor, OR text "Buscar" for tablet+
Aria: aria-label="Buscar"
```

### 4.5 NutritionCard

The primary result unit. One card per dish or item identified from the query.

```
Container:
  bg-white rounded-2xl border border-slate-100 shadow-soft
  p-4 md:p-5
  overflow-hidden

Header row: flex items-start justify-between gap-3
  Dish name: text-lg font-bold text-slate-800  (left)
  Confidence badge: right-aligned               (right)

Calorie block: mt-3
  kcal value: text-[28px] font-extrabold text-brand-orange leading-none
  kcal label: text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-0.5

Macros row: mt-3 flex gap-4
  Each macro:
    value: text-lg font-bold text-slate-700 leading-none
    label: text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-0.5

Allergen row (conditional): mt-3 flex flex-wrap gap-1.5
  Each allergen: chip style (see 4.6)

Description (conditional): mt-3 text-sm text-slate-500 leading-normal
  Max 2 lines, truncated with ellipsis. Tap/click to expand.

Source footer: mt-3 pt-3 border-t border-slate-100
  text-[11px] text-slate-400 flex items-center gap-1.5
```

Entrance animation: see section 7.2.

### 4.6 AllergenChip

```
Style: inline-flex items-center rounded-full
       bg-red-50 text-red-700 border border-red-200
       px-2 py-0.5 text-[11px] font-semibold
       gap-1 (small warning icon + label)
Icon: 12px triangle-warning SVG or ⚠ character fallback
```

### 4.7 ConfidenceBadge

Inherits semantic colors from `design-guidelines.md` section 2.2.

```
HIGH:   bg-emerald-50 text-emerald-800 border border-emerald-200  — "Verificado"
MEDIUM: bg-amber-50 text-amber-800 border border-amber-200        — "Estimado"
LOW:    bg-rose-50 text-rose-800 border border-rose-200           — "Aproximado"

Style: inline-flex items-center rounded-full px-2.5 py-0.5
       text-[11px] font-semibold gap-1.5
```

### 4.8 VoiceOverlay

Full-screen overlay activated by MicButton. Inspired directly by the Google Maps voice search reference.

```
Container:
  position: fixed inset-0
  bg-white z-50
  flex flex-col items-center justify-between
  px-6 pt-12 pb-[calc(48px+env(safe-area-inset-bottom))]

Entrance: fade in bg-white from opacity-0, duration 200ms ease-out
Exit: fade out to opacity-0, duration 150ms ease-in

Top area (state-dependent text):
  position: absolute top-12 left-6 right-6
  "Habla ahora" — text-lg text-slate-400 (shown in listening state)
  "Escuchando..." — text-lg text-slate-400 (shown after detecting audio)
  "Procesando..." — text-lg text-slate-500 font-medium (shown in processing state)
  "" — empty / hidden in idle/ready state

Center area (mic button + rings):
  flex-1 flex items-center justify-center
  MicButton variant: 80px x 80px (larger in overlay)
  Surrounded by concentric ring animations (see section 7.3)

Dismiss button (bottom-right):
  position: absolute bottom-[calc(48px+env(safe-area-inset-bottom))] right-6
  40px x 40px rounded-full
  bg-slate-100 text-slate-500
  hover:bg-slate-200
  Icon: X, 20px
  Aria: aria-label="Cerrar búsqueda por voz"
```

### 4.9 LoadingState (Processing skeleton)

Shown in the results area while the API call is in flight.

```
1–3 skeleton cards (same dimensions as NutritionCard):
  Animated shimmer on all content areas
  Use CSS animation: shimmer (see section 7.4)

Skeleton elements:
  Title bar: h-5 w-48 rounded-lg bg-slate-100
  Calorie block: h-9 w-24 rounded-lg bg-slate-100
  Macro row: 3x (h-6 w-16 rounded-lg bg-slate-100)
  All elements: animate-shimmer (defined in section 7.4)
```

### 4.10 EmptyState

Shown on first load before any query, or after clearing results.

```
Container: flex flex-col items-center justify-center flex-1
           px-8 text-center

Illustration: optional, small SVG (fork + magnifier, ~80px)
Headline: text-[15px] font-medium text-slate-600 mt-4
          "¿Qué quieres saber?"
Subtext: text-sm text-slate-400 mt-1.5 max-w-[280px]
         "Escribe el nombre de un plato o usa el micrófono."
```

### 4.11 ErrorState

```
Container: same as EmptyState

Icon: 32px warning circle SVG, text-red-400
Headline: text-[15px] font-medium text-slate-700 mt-3
          Context-dependent copy (see section 8.3)
Subtext: text-sm text-slate-400 mt-1
Retry button: secondary variant (see design-guidelines.md 5.1), size sm
              "Intentar de nuevo"
```

---

## 5. Voice Interaction States

This is the core UX definition for F091. The state machine has six states.

### 5.1 State Definitions

| State | Trigger | Visual | Audio |
|-------|---------|--------|-------|
| **idle** | App load, query cleared | Empty state, input bar, mic button at rest | None |
| **ready** | Mic button tapped, overlay opens | VoiceOverlay visible, large mic button, static rings | Browser mic permission request if needed |
| **listening** | Mic permission granted, recording starts | "Habla ahora" text, pulsing rings, mic button solid | Recording |
| **processing** | User stops speaking OR silence timeout (2s) | "Procesando..." text, rings replaced by spinner, mic button dims | Recording stops |
| **speaking** | TTS response starts playing | Results visible, TTS indicator active (accent-gold rings on a small speaker icon) | TTS audio |
| **results** | API response rendered | Cards visible, input bar re-enabled, overlay dismissed | None |

### 5.2 State Transitions

```
idle → ready         User taps MicButton
ready → listening    Browser mediaDevices.getUserMedia resolves
ready → idle         User taps X (dismiss)
listening → processing  Silence detected (2s timeout) OR user taps mic again
listening → idle     User taps X (dismiss)
processing → results API response arrives, overlay dismisses automatically
processing → idle    API error (overlay dismisses, error state shown)
results → ready      User taps MicButton again (new query)
results → idle       User clears results or navigates away
```

### 5.3 State-Specific MicButton Appearance

| State | Size in bar | Size in overlay | Color | Animation |
|-------|-------------|----------------|-------|-----------|
| idle | 48x48 | — | `bg-brand-green` | none |
| ready | — | 80x80 | `bg-brand-green` | static rings visible |
| listening | — | 80x80 | `bg-brand-green` | pulsing rings |
| processing | 48x48 (grayed) | — | `bg-slate-400` | spinner replaces icon |
| speaking | 48x48 | — | `bg-brand-green` | small wave animation (not rings) |
| results | 48x48 | — | `bg-brand-green` | none |

---

## 6. Responsive Strategy

### 6.1 Primary Target: Mobile in Portrait

The primary use context is a user at a restaurant table, holding their phone. Design every layout decision for a 390px-wide screen held vertically.

### 6.2 Layout Shell

```
Full viewport height: h-[100dvh] (use dvh not vh — avoids browser chrome overlap on mobile)

Structure (top to bottom):
  ┌─────────────────────────────┐
  │  AppBar (optional, ~52px)   │  fixed top, only if needed
  ├─────────────────────────────┤
  │                             │
  │   ResultsArea (flex-1)      │  scrollable, padding-bottom for input bar
  │                             │
  ├─────────────────────────────┤
  │   ConversationInput (~68px) │  fixed bottom
  └─────────────────────────────┘

ResultsArea:
  overflow-y: auto
  padding-bottom: 84px (height of ConversationInput + safe area)
  -webkit-overflow-scrolling: touch

AppBar (if present):
  height: 52px
  bg-white border-b border-slate-100
  Content: logo left, optional settings icon right
  Do NOT include navigation items — /hablar is a single-purpose tool
```

### 6.3 Breakpoint Behavior

| Breakpoint | Layout change |
|------------|--------------|
| `< 640px` (mobile default) | Single column results, full-width cards |
| `sm: 640px` | No change — still single column |
| `md: 768px` (tablet) | Results in 2-column grid (`grid grid-cols-2 gap-4`). Input bar remains full-width at bottom. |
| `lg: 1024px` (desktop) | Results in 2-column grid, max-width container (`max-w-2xl mx-auto`). Input bar centered at bottom or transitions to a centered bar. VoiceOverlay stays full-screen. |
| `xl: 1280px+` | Same as lg. No changes. |

### 6.4 VoiceOverlay on Tablet/Desktop

VoiceOverlay remains full-screen even on desktop. This is intentional — voice input is a focused, single-purpose action that warrants removing all distractions. Do not convert it to a modal dialog on desktop.

### 6.5 Results Card Layout per Breakpoint

```
Mobile:  single card = full width. grid grid-cols-1 gap-3
Tablet:  grid grid-cols-2 gap-4 (two cards per row)
Desktop: grid grid-cols-2 gap-4 max-w-2xl mx-auto (same grid, constrained width)
```

If only 1 result is returned, the card is full-width at all breakpoints (`col-span-full`).

---

## 7. Animation Guidelines

### 7.1 General Principle

Animation budget for /hablar is much tighter than the landing page. The user is task-focused. Every animation must have a functional purpose (communicate state, guide attention, provide feedback). Decorative animations are prohibited here.

| Purpose | Allowed | Duration |
|---------|---------|----------|
| State change feedback | Yes | 150–250ms |
| Card entrance (results arrival) | Yes | 300–400ms |
| Overlay open/close | Yes | 150–200ms |
| Voice ring pulse | Yes | Continuous, 1.2–2s cycle |
| Loading shimmer | Yes | Continuous, 1.5s cycle |
| Scroll-triggered entrance | No | — |
| Hover decorative animations | No | — |

### 7.2 Card Entrance Animation

Results cards animate in when the API response arrives. They should feel like they appeared, not that they slid in dramatically.

```css
/* Each card, staggered */
initial: { opacity: 0, y: 12 }
animate: { opacity: 1, y: 0 }
transition: { duration: 0.35, ease: "easeOut" }
stagger: 0.08s between cards (fast — all cards should be visible within 300ms of the first)
```

If using CSS only (no Framer Motion in web package):
```css
@keyframes card-enter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.card-enter {
  animation: card-enter 0.35s ease-out forwards;
}
.card-enter:nth-child(2) { animation-delay: 0.08s; }
.card-enter:nth-child(3) { animation-delay: 0.16s; }
```

### 7.3 Voice Ring Pulse Animation (Core interaction)

This animation is the primary visual feedback for the listening state. Three concentric rings outside the MicButton.

**Ring structure:**
```
Ring 1 (innermost): diameter = button + 24px  → 80+24 = 104px in overlay, 48+24 = 72px in bar
Ring 2 (middle):    diameter = button + 48px
Ring 3 (outermost): diameter = button + 80px
```

**Idle/ready state (static rings):**
```css
rings: visible but not animating
color: rgba(45, 90, 39, 0.10) — very subtle green tint
border: 1.5px solid rgba(45, 90, 39, 0.12)
```

**Listening state (pulsing rings):**

Each ring pulses independently with staggered delays, mimicking the Google Maps reference behavior where rings expand and contract to communicate that audio is being received.

```css
@keyframes ring-pulse {
  0%   { transform: scale(1);    opacity: 0.6; }
  50%  { transform: scale(1.12); opacity: 0.3; }
  100% { transform: scale(1);    opacity: 0.6; }
}

.voice-ring-1 {
  animation: ring-pulse 1.4s ease-in-out infinite;
  background: rgba(45, 90, 39, 0.12);
  border: 1.5px solid rgba(45, 90, 39, 0.18);
}
.voice-ring-2 {
  animation: ring-pulse 1.4s ease-in-out infinite;
  animation-delay: 0.2s;
  background: rgba(45, 90, 39, 0.07);
  border: 1.5px solid rgba(45, 90, 39, 0.10);
}
.voice-ring-3 {
  animation: ring-pulse 1.4s ease-in-out infinite;
  animation-delay: 0.4s;
  background: rgba(45, 90, 39, 0.03);
  border: 1.5px solid rgba(45, 90, 39, 0.06);
}
```

**Audio volume response (enhanced UX):** If the Web Audio API is available, scale the rings proportionally to the input audio level. Ring 1 scales between 1.0–1.15, Ring 2 between 1.0–1.20, Ring 3 between 1.0–1.30. This makes the animation feel alive and responsive rather than looping mechanically.

**Processing state transition:**
```css
/* Rings fade out when transitioning to processing */
transition: opacity 200ms ease-out → opacity: 0
/* Spinner appears in place of rings */
```

**TTS speaking state:**
```css
/* Rings use accent-gold color when speaking output */
ring-1: rgba(212, 168, 67, 0.20)
ring-2: rgba(212, 168, 67, 0.12)
ring-3: rgba(212, 168, 67, 0.06)
/* Same pulse animation, but slower: 2s cycle */
```

### 7.4 Loading Shimmer

Used in skeleton cards while waiting for API response.

```css
@keyframes shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

.shimmer-element {
  background: linear-gradient(
    90deg,
    #f1f5f9 0px,
    #e2e8f0 40px,
    #f1f5f9 80px
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

### 7.5 Overlay Open/Close

```css
/* Open */
VoiceOverlay: opacity 0 → 1, duration 200ms, ease-out
MicButton inside overlay: scale 0.85 → 1, duration 250ms, ease-out, delay 100ms

/* Close */
VoiceOverlay: opacity 1 → 0, duration 150ms, ease-in
```

### 7.6 Reduced Motion

All animations must respect `prefers-reduced-motion: reduce`.

```css
@media (prefers-reduced-motion: reduce) {
  .voice-ring-1, .voice-ring-2, .voice-ring-3 {
    animation: none;
    opacity: 0.4; /* rings remain visible but static */
  }
  .card-enter {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .shimmer-element {
    animation: none;
    background: #f1f5f9; /* static light gray */
  }
}
```

---

## 8. Accessibility

### 8.1 Voice Fallback

Every voice-only affordance must have a text equivalent. The ConversationInput text field is ALWAYS present alongside the mic button. Users who cannot or will not use voice can complete all tasks via text.

### 8.2 Keyboard Navigation

| Element | Key behavior |
|---------|-------------|
| ConversationInput text field | Enter submits query |
| MicButton | Space or Enter activates voice overlay |
| VoiceOverlay dismiss button | Escape key closes overlay (in addition to X button) |
| NutritionCard | Focusable via Tab, Enter to expand description if truncated |
| AllergenChip | Focus shows full allergen name via tooltip or aria-label |

Focus trap: when VoiceOverlay is open, trap focus within the overlay. Return focus to MicButton on close.

### 8.3 ARIA Patterns

**MicButton:**
```html
<button
  aria-label="Iniciar búsqueda por voz"
  aria-pressed="false"     <!-- true when listening -->
  aria-haspopup="dialog"   <!-- opens overlay -->
>
```

**VoiceOverlay:**
```html
<div
  role="dialog"
  aria-modal="true"
  aria-label="Búsqueda por voz"
  aria-live="polite"       <!-- announces state changes -->
>
```

**NutritionCard:**
```html
<article aria-label="[Dish name]: [kcal] calorías">
  <!-- Use article element — each card is a discrete content unit -->
```

**Results region:**
```html
<section aria-label="Resultados nutricionales" aria-live="polite">
  <!-- polite live region: screen reader announces when new results arrive -->
```

**Loading state:**
```html
<div role="status" aria-label="Buscando información nutricional...">
  <!-- skeleton cards are aria-hidden="true" -->
```

### 8.4 Touch Targets

All interactive elements: minimum 44px × 44px.

| Element | Minimum size |
|---------|-------------|
| MicButton (input bar) | 48 × 48px |
| MicButton (overlay) | 80 × 80px |
| PhotoButton | 48 × 48px |
| SubmitButton | 48 × 48px |
| Overlay dismiss (X) | 44 × 44px |
| AllergenChip (if tappable) | 32px height, 44px min touch area via padding |

### 8.5 Screen Reader Announcements for Voice States

Announce state transitions via a visually-hidden live region:

```
idle → listening:    "Micrófono activado. Habla ahora."
listening → processing: "Procesando tu consulta."
processing → results: "Se encontraron [N] resultados."
error: "No se pudo completar la búsqueda. [Error description]."
```

### 8.6 Color Contrast

All text/background combinations must meet WCAG 2.1 AA (4.5:1 body, 3:1 large):

| Combination | Ratio | Pass |
|-------------|-------|------|
| `#334155` on `#FFFFFF` | 8.7:1 | AAA |
| `#FF8C42` (kcal) on `#FFFFFF` | 3.0:1 | AA (large text only — 28px bold, qualifies) |
| `#FFFFFF` on `#2D5A27` (mic) | 7.5:1 | AAA |
| `#64748B` on `#FFFFFF` | 5.1:1 | AA |
| `#92400E` on `#FEF3C7` | 5.9:1 | AA |
| `#065F46` on `#D1FAE5` | 6.4:1 | AA |
| `#9F1239` on `#FFE4E6` | 5.2:1 | AA |

Note: The `#FF8C42` kcal value at 28px bold (extrabold) qualifies as large text under WCAG (18px+ bold). If ever used at smaller sizes, add `text-orange-700` (`#C2410C`) instead, which achieves 4.5:1 on white.

---

## 9. Error States and Copy

### 9.1 Error Types and Messages

| Error type | Headline | Subtext | Action |
|------------|---------|---------|--------|
| No mic permission | "Sin acceso al micrófono" | "Permite el acceso en la configuración de tu navegador." | No retry button — explain where to go |
| Mic not supported | "Tu navegador no admite voz" | "Usa el campo de texto para buscar." | — (auto-dismiss overlay) |
| API timeout | "La búsqueda tardó demasiado" | "Inténtalo de nuevo o simplifica tu consulta." | "Intentar de nuevo" |
| No results found | "No encontramos este plato" | "Prueba con otro nombre o describe los ingredientes." | — |
| Network error | "Sin conexión" | "Comprueba tu conexión e inténtalo de nuevo." | "Intentar de nuevo" |
| Speech not recognized | "No entendimos bien" | "Habla más despacio o escribe tu consulta." | — (re-enables input) |

### 9.2 Error State Visual

- Network/API errors: ErrorState component (see 4.11) replaces results area
- "No results": EmptyState variant with different copy (not an error — softer visual treatment)
- Voice-specific errors (permission, not supported, not recognized): shown as a toast notification at the top of the VoiceOverlay, NOT as a full-screen error. VoiceOverlay then dismisses after 2.5s.

### 9.3 Toast (Voice errors only)

```
Position: top of VoiceOverlay, below status text area
Style: bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3
       text-sm font-medium
       mx-6 (horizontal padding from overlay edges)
Entrance: slide down from top 200ms, ease-out
Exit: fade out 150ms after 2.5s display
```

---

## 10. Dark Mode

### 10.1 Strategy for Phase C

Dark mode is NOT in scope for Phase C. The /hablar interface is light mode only.

Rationale: the primary use context is a restaurant with ambient lighting. A clean white interface with dark text is easier to read quickly in varied lighting conditions than a dark interface. Dark mode introduces significant testing overhead and the problem it solves (battery, personal preference) is secondary to the core use case.

### 10.2 Future Consideration

If dark mode is added in a future phase, the implementation approach should be CSS custom property overrides (same pattern as the landing's `[data-palette='med']` override), not a separate stylesheet. Document the token set at that point.

---

## 11. Constraints and Anti-Patterns for /hablar

### 11.1 Prohibitions

| Anti-Pattern | Why |
|-------------|-----|
| Chat bubble UI (iMessage-style) | /hablar is a query → results tool, not a conversation history. Bubbles imply persistent thread which is not the model here. |
| Bottom navigation bar | Single-purpose tool. Navigation between sections is not needed. |
| Floating action button (FAB) | The ConversationInput bar IS the FAB equivalent. Two CTAs compete for attention. |
| Displaying raw API response or JSON | Never surface error IDs, stack traces, or raw field names to users |
| Scroll-triggered animations in the results area | Results load dynamically — scroll position is unpredictable. Entrance animation is triggered by data arrival, not scroll. |
| Sticky section headers within results | Results are a flat list/grid. No sections, no headers. |
| Full-screen loading (blocking UI while API call runs) | Show skeleton cards immediately. The input bar must remain accessible during loading. |
| Auto-submit on voice transcript (no confirmation) | F091 scope: show transcript text briefly in input field, then auto-submit after 800ms (allows user to see and optionally cancel). Do NOT submit instantaneously with no visual feedback. |
| More than 3 concentric rings in voice animation | Beyond 3 rings, the visual becomes noisy. Reference: Google Maps uses 3. |
| Playing TTS audio without user having activated voice mode | Only play TTS if user is in voice-initiated flow. Text-initiated queries never auto-play TTS. |
| z-index above 50 | VoiceOverlay uses `z-50`. Nothing else should exceed this. |
| `!important` in CSS | Not permitted. Specificity issues indicate a structural problem. |

### 11.2 Performance Constraints for /hablar

| Metric | Target | Notes |
|--------|--------|-------|
| Time to Interactive | < 2s on 4G | User is at a restaurant, likely on mobile data |
| Input → first skeleton visible | < 100ms | Immediate feedback on submit |
| Skeleton → first card visible | Depends on API, target < 3s | Show loading state, never blank |
| VoiceOverlay open animation | < 16ms first frame | Must feel instant |
| JS bundle (first load) | < 120KB gzip | Tighter than landing — no marketing content |
| Voice ring animation | CSS-only (no JS) | Never use JS animation loop for the rings |

### 11.3 Input Bar Fixed Positioning Rules

- Always use `h-[100dvh]` for the shell, never `h-screen` — `dvh` accounts for browser chrome on mobile
- Always add `env(safe-area-inset-bottom)` padding to the input bar for iOS home indicator
- Always set `padding-bottom` on the results area equal to the input bar height — prevent last card from being hidden under the bar
- Test on Safari iOS 15+ (most restrictive browser for fixed positioning + keyboard behavior)

---

## 12. Photo Mode Design Notes (F092 — preview)

Photo mode shares the same layout shell and result card system. The interaction difference is:

**Photo upload trigger:** PhotoButton opens native file picker (`<input type="file" accept="image/*" capture="environment">`) — this triggers the camera on mobile or file browser on desktop.

**Processing state:** Same skeleton cards as text/voice mode. Add a small thumbnail of the uploaded photo above the skeleton cards so the user has confirmation their photo was received.

```
Photo thumbnail:
  w-20 h-20 rounded-xl object-cover border border-slate-200 shadow-soft
  positioned: left edge of results area, top of results, mb-4
  label below: text-xs text-slate-400 "Analizando foto..."
```

**Result cards:** Identical to text mode cards. The distinction is the query display — instead of showing the typed text, show the thumbnail as the "query representation."

Full design spec for F092 to be done in a dedicated ticket design notes section.

---

## 13. F091 Implementation Notes

Feature F091 (Async Push-to-Talk Voice) introduces several design elements not covered in this document: the dual tap/hold interaction model, the voice picker drawer with auto-voice-selection heuristic, extended error states (rate-limit, budget cap, empty transcription, TTS unavailable), first-time mic permission pre-screen, and multi-platform design reflection notes. All F091-specific design decisions are documented in:

**`docs/specs/f091-voice-design-notes.md`**

That document is an addendum to this spec. The voice state colors (§2.2), ring animations (§7.3), overlay structure (§4.8), and state machine (§5) defined here remain authoritative. The F091 notes only fill gaps and add new states — they do not override anything in this document.
