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

The primary input bar. Sits at the natural bottom of the flex column — NOT `position: fixed`. Contains the text field, mic button, and photo button in a horizontal row.

```
Layout: flex-shrink-0 w-full (in-column, NOT fixed bottom-0)
Background: bg-white border-t border-slate-200
Padding: px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]
  (iOS safe area inset retained — required for home indicator clearance)
Blur backdrop: backdrop-blur-sm (for content scrolling underneath)

Note (ADR-030, F-WEB-HISTORY-FU7): position: fixed bottom-0 is REMOVED.
The composer is a flex-shrink-0 block sibling inside h-[100dvh] flex-col.
Safari iOS raises the dvh viewport on keyboard open, so the in-column
composer naturally stays above the keyboard without fixed positioning.
Empirically validated on real iPhone Safari (2026-06-09 prototype test).

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
  │  AppBar (~52px, flex-shrink-0) │  in-flow, always at top
  ├─────────────────────────────┤
  │                             │
  │   TranscriptFeed (flex-1)   │  scrollable feed (overflow-y: auto)
  │                             │
  ├─────────────────────────────┤
  │  RateLimitNudge (optional)  │  flex-shrink-0 sibling, only on anon 429
  ├─────────────────────────────┤
  │  ConversationInput          │  flex-shrink-0 in-column (NOT fixed)
  └─────────────────────────────┘

TranscriptFeed:
  overflow-y: auto
  overscroll-behavior: contain
  -webkit-overflow-scrolling: touch
  No padding-bottom clearance — in-column composer eliminates the need.
  Desktop centering: lg:max-w-2xl lg:mx-auto w-full
  (ADR-030, F-WEB-HISTORY-FU7: native <div> scroll, not react-virtuoso)

RateLimitNudge (conditional sibling):
  flex-shrink-0 px-4 pb-2
  Renders only for anonymous users who received a 429. Not inside the feed.
  Shrinks the feed area naturally via flex layout when active.

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

---

## Admin Analytics UI Design Notes (F-ADMIN-ANALYTICS-UI)

**Ticket:** F-ADMIN-ANALYTICS-UI | **Step:** 2 — Design Notes for frontend-planner
**Applies to:** `packages/web/src/app/admin/` and `packages/web/src/components/admin/`
**Primary audience:** Pablo (admin), desktop + tablet. Phone is degraded-but-functional; no phone-specific ACs.

> These notes ADD visual, spacing, and interaction specifications on top of the component contracts already defined in `docs/specs/ui-components.md` (lines 56–265). Do NOT look there for visual decisions — look here. Do NOT look here for prop shapes — look there.
>
> Brand tokens inherited from §2 of this document and `docs/specs/design-guidelines.md §2`. No new color tokens are introduced.

---

### W27. Admin Layout Shell

#### Sidebar

The sidebar exists for future growth (more admin sections) but currently carries one nav link. Keep it minimal and non-distracting.

```
Width:          w-56 (224px) — fixed, never collapsible on desktop
Background:     bg-white border-r border-slate-100
Height:         h-full (fills the sidebar column, which is 100dvh minus AppBar if present)
Padding:        pt-6 px-3

Logo / wordmark area (top of sidebar):
  px-3 pb-5 border-b border-slate-100
  Text: "nutriXplorer admin"
  Style: text-sm font-semibold text-slate-500 tracking-wide uppercase
  (No logo SVG required — pure text treatment; admin tool, not marketing surface)

Nav link — "Analytics":
  Style (inactive):
    flex items-center gap-2.5 rounded-lg px-3 py-2
    text-sm font-medium text-slate-600
    hover:bg-slate-50 hover:text-slate-800
    transition-colors duration-150
  Style (active — current route):
    bg-mist text-brand-green font-semibold
    (mist = #EEF4EC — the same chip background used in /hablar badges)
  Icon: a simple 18px chart-bar or layout-grid SVG (stroke 1.5px, currentColor)
  Active indicator: the bg-mist fill is sufficient — do NOT add a left border accent bar
    (that pattern is too heavy for a one-item menu)
```

`bg-mist` is already defined in §2.1 of this document. No new token needed.

#### Content area

```
Layout:         flex h-[100dvh] (full viewport, same dvh pattern as /hablar — no chrome overflow)
Structure:
  ┌──────────┬──────────────────────────────────────────────┐
  │ Sidebar  │  TopBar (40px, tablet only — see W36)        │
  │  w-56    ├──────────────────────────────────────────────┤
  │          │  Scrollable content area (overflow-y: auto)  │
  │          │  max-w-7xl mx-auto px-6 py-8                 │
  └──────────┴──────────────────────────────────────────────┘

Content area:   flex-1 overflow-y-auto bg-slate-50
  (Slight off-white page background distinguishes it from white panel cards)
Max-width:      max-w-7xl mx-auto (1280px cap — wide enough for Panel C's card grid)
Padding:        px-6 py-8 (desktop); px-4 py-6 (tablet)
```

Using `bg-slate-50` for the page background (vs the sidebar's `bg-white`) creates a clean card-lifts-off-surface effect without requiring shadows on every panel.

#### Loading state (AdminGuard — auth checking)

```
Full-page centered spinner while auth resolves:
  Container: fixed inset-0 bg-white flex items-center justify-center
  Spinner: w-8 h-8 rounded-full border-2 border-slate-200 border-t-brand-green animate-spin
  Below spinner: text-sm text-slate-400 mt-3 "Verificando acceso..."
```

No skeleton of the dashboard behind the spinner — the spec explicitly requires that no panels render before the guard clears.

#### 403 pages — see W35 for full treatment

---

### W28. Panel Layout Strategy

**Decision: stacked vertical panels, no tabs.**

Rationale: Pablo uses this dashboard for pre-beta operational review, not realtime monitoring. He will typically scroll top-to-bottom in one pass — first triaging missed queries (Panel A), then spot-checking responses (Panel B), then reviewing aggregates (Panel C). Tabs would hide two-thirds of the data at all times, forcing unnecessary switching. The content is complementary, not competing. Stacked panels also make keyboard navigation natural (Tab through each panel's controls in order).

Tab UI would be appropriate if panels were mutually exclusive flows (e.g., "create / edit / delete"). Here they are parallel views. Stacked is correct.

#### Panel container

Each of the three panels is a visual card that sits on the `bg-slate-50` page background.

```
Panel card:
  bg-white rounded-2xl border border-slate-100
  (no box-shadow — the border + off-white bg provides sufficient elevation; matches NutritionCard shape)
  mb-8 (gap between panels)

Panel header:
  px-5 pt-5 pb-4 border-b border-slate-100
  flex items-center justify-between flex-wrap gap-3

Panel body:
  px-5 py-5
```

#### Panel header pattern

```
Left side:
  Panel title: text-lg font-bold text-slate-800
  Count badge (row count or "N entradas"): inline-flex items-center rounded-full
    bg-slate-100 text-slate-600 text-xs font-semibold px-2.5 py-0.5 ml-2.5
    (matches the chip style used in /hablar confidence badges)

Right side:
  Filter bar (see W29)
```

On narrow tablet, the filter bar wraps below the title line. Both elements are `flex-shrink-0`.

#### Section dividers within a panel

Whitespace is the primary divider — no `<hr>` lines between filter bar and table. Within Panel C, where distinct sections (scalars / distribution charts / top-queries / top-intents) need visual separation, use:

```
Section subheading + top border pattern:
  mt-6 pt-5 border-t border-slate-100
  text-xs font-semibold uppercase tracking-widest text-slate-400
  mb-3
```

This mirrors the existing section-label style from §3.1 of this document (`text-xs font-semibold uppercase tracking-widest`).

#### Scroll strategy

**Page scroll, not per-panel scroll.** The content area's `overflow-y: auto` handles all scrolling. Individual panels have no scroll — they expand to full height. This avoids nested scrollers, which are problematic on touch devices and degrade keyboard navigation. The only exception is Panel A's table on very short viewports — see W30.

---

### W29. Filter Controls

#### TimeRange preset picker (Panels A and C)

Use a **segmented button group** (not a `<select>` dropdown). Segmented controls communicate all available options at a glance, which matters for a power user (Pablo) who switches between ranges repeatedly.

```
Container: inline-flex rounded-lg border border-slate-200 overflow-hidden
  (single rounded border containing all segments — no gap between buttons)

Each segment:
  px-3.5 py-1.5 text-sm font-medium
  Inactive: bg-white text-slate-600 hover:bg-slate-50
  Active:   bg-brand-green text-white
  Transition: background-color 150ms ease-out
  Border-right: border-r border-slate-200 (except last segment)
  Minimum width: 44px (touch target rule)

Segments: "24h" | "7d" | "30d" | "Todo"
Default active: "7d"

Accessibility:
  role="group" aria-label="Período de tiempo"
  Each button: aria-pressed="true/false"
```

Do NOT use a `<select>` here. `<select>` is appropriate for long lists (e.g., the intent dropdown in Panel B). For 4 fixed options, the segmented control is faster to operate and reads better.

#### Numeric inputs (topN, minCount, hours, limit)

```
Container: flex items-center gap-1.5

Label: text-xs font-medium text-slate-500 whitespace-nowrap
  (Label LEFT of the input — inline label, not floating. This is a dense admin form, not a user-facing registration form.)

Input:
  w-16 (4 chars wide — enough for values up to 720)
  h-8 (compact, touch-friendly minimum met via label area)
  rounded-lg border border-slate-200 bg-white
  px-2 text-sm text-center text-slate-700
  focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 focus:outline-none
  (same focus ring pattern as ConversationInput text field in §4.1)

Validation feedback (inline, below input):
  text-[11px] text-red-500 mt-0.5
  Appears immediately on blur if value is out of range
  Example: "Mín. 1" or "Máx. 720"
  Do NOT show a toast — inline validation is sufficient for this density

Disabled state (during active fetch):
  opacity-50 pointer-events-none
  (Prevent filter changes while a fetch is in flight to avoid race conditions)
```

#### Intent dropdown (Panel B — 8 ConversationIntent values + "Todos")

9 options total — a `<select>` is appropriate here (list is longer than the 4-option threshold for segmented controls).

```
Container: flex items-center gap-1.5

Label: "Intención:" text-xs font-medium text-slate-500

Select:
  h-8 pl-3 pr-8 rounded-lg border border-slate-200 bg-white
  text-sm text-slate-700
  focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 focus:outline-none
  appearance: use Tailwind's `appearance-none` + custom chevron SVG positioned absolutely
  (consistent with project's form styling convention — native select chrome is inconsistent cross-browser)

Options (in this display order):
  "Todos" (value: undefined / empty string)
  "Estimación"        (estimation)
  "Comparación"       (comparison)
  "Menú"              (menu_estimation)
  "Búsqueda inversa"  (reverse_search)
  "Contexto"          (context_set)
  "Texto largo"       (text_too_long)
  "Seguimiento"       (follow_up_attribute)
  "Refinamiento"      (follow_up_refinement)
```

Display labels are Spanish-readable translations of the enum values, NOT the raw enum strings. The i18n key tree in W34 provides these under `admin.intent.*`.

#### "Apply" button vs auto-fetch

**No explicit "Apply" button. Auto-fetch on change.**

Rationale: Pablo is the sole user. The dataset is small (analytics on a pre-beta product). Latency is predictable (same endpoints already in prod). Auto-fetch on change is a faster workflow. The tradeoff — a fetch triggered on every keystroke in numeric inputs — is mitigated by fetching on **blur** (not on each keypress) for numeric fields. The TimeRange picker and intent dropdown auto-fetch immediately on selection.

Pattern:
- TimeRange segmented control: fetch on click
- Intent dropdown: fetch on change
- Numeric inputs: fetch on blur (after validation passes)

#### Filter bar spacing

```
Filter bar container: flex items-center flex-wrap gap-3
  (gap-3 = 12px between each filter group; wraps gracefully on tablet)
```

---

### W30. Tables

#### Row density

```
Row height: 48px (tr: h-12)
Cell padding: px-4 py-3
  (Slightly more generous than a data-dense SaaS table — Panel A rows carry action buttons that need breathing room)

Font size: text-sm (14px)
Line height: leading-snug
```

#### Header style

```
thead > tr:
  bg-slate-50 (same off-white as page background — subtle, not heavy)
  border-b border-slate-200

th:
  px-4 py-2.5
  text-xs font-semibold uppercase tracking-wide text-slate-400
  text-left (all columns left-aligned; count column right-aligned)

Sticky headers: YES on both Panel A and Panel B tables.
  thead: sticky top-0 z-10 bg-slate-50
  (z-10 is safe — no overlapping elements; VoiceOverlay's z-50 is on a different route entirely)
  Rationale: Pablo will scroll long tables to find specific queries. Fixed column headers prevent losing context.
```

#### Truncate vs wrap policy

| Panel | Column | Policy |
|-------|--------|--------|
| A | queryText | `truncate` at 80 chars (single line, ellipsis). Full text in `title` attribute for hover tooltip. |
| A | count | No truncate (always a small integer) |
| A | trackingStatus | No truncate (badge, fixed width) |
| A | actions | No truncate (button group) |
| B | queryText | `truncate` at 100 chars (single line, ellipsis). Full text in `title` attribute. |
| B | intent | No truncate (badge) |
| B | kind | No truncate (badge) |
| B | createdAt | No truncate (relative time, short) |
| B | expand icon | Fixed width column |
| C topQueries | queryText | `line-clamp-2` (two lines max, no `truncate` — queries may be more descriptive and a second line is useful) |
| C topQueries | count | No truncate |

`title` attribute on truncated cells gives hover tooltip with full text at zero implementation cost and no extra component.

#### Empty state

```
Container: w-full py-16 flex flex-col items-center justify-center text-center

Icon: 32px SVG
  Panel A: magnifier with strikethrough — text-slate-300
  Panel B: clock with question mark — text-slate-300
  (Simple inline SVG — no icon library needed. Stroke 1.5px, currentColor, on text-slate-300)

Text: text-[15px] font-medium text-slate-500 mt-3 max-w-xs

Do NOT render the table shell (thead + empty tbody) for the empty state.
Replace the entire table area with this centered block.
```

#### Loading skeleton

Mirrors the shimmer pattern from §7.4 of this document (same `@keyframes shimmer` + `.shimmer-element` class). Apply to placeholder rows inside the `<tbody>` while data loads.

```
Skeleton row (5 rows for Panel A, 5 rows for Panel B):
  tr: h-12 border-b border-slate-50

  Panel A skeleton cells:
    queryText column: shimmer-element h-4 w-48 rounded-md
    count column:     shimmer-element h-4 w-8 rounded-md
    status column:    shimmer-element h-5 w-16 rounded-full (pill shape)
    actions column:   shimmer-element h-7 w-24 rounded-lg (button shape)

  Panel B skeleton cells:
    queryText:  shimmer-element h-4 w-56 rounded-md
    intent:     shimmer-element h-5 w-20 rounded-full
    kind:       shimmer-element h-5 w-14 rounded-full
    createdAt:  shimmer-element h-4 w-16 rounded-md
    expand:     shimmer-element h-4 w-4 rounded

Render the thead with real headers during skeleton — only the tbody rows are replaced.
This avoids layout shift when real data arrives (column widths are already defined by the headers).
```

#### Error state

```
Container: w-full px-4 py-4
  (inline — replaces table body, not a full-page takeover)

Banner: flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3

Icon: 16px circle-x SVG, text-red-400
Text: text-sm font-medium text-red-700 (error message from useT key)
Retry button:
  ml-auto text-sm font-medium text-red-600 underline underline-offset-2
  hover:text-red-800 cursor-pointer
  (Underlined text link, not a full button — keeps the banner compact)
```

---

### W31. Per-Row Tracking Actions (Panel A)

**Decision: inline 3-button group, not a dropdown menu.**

Rationale: Pablo performs these actions repeatedly (he is the only user, and he will be triaging tens of rows). A dropdown adds two taps per action (open menu + click item). An inline button group is one tap. Three short Spanish labels ("Investigando", "Resuelto", "Ignorar") fit comfortably in a `w-56` cell at `text-xs`. Dropdown menus make sense when there are 5+ actions or when the label text is long — neither condition applies here.

```
Action cell: w-56 min-w-[224px]

Button group container: inline-flex rounded-lg border border-slate-200 overflow-hidden

Each button:
  px-3 py-1.5 text-xs font-medium
  border-r border-slate-200 (last button: no border-r)
  Inactive/default: bg-white text-slate-600 hover:bg-slate-50
  transition-colors duration-150

Active state (current status matches this button's action):
  "Investigando" active:  bg-amber-50 text-amber-700
  "Resuelto" active:      bg-emerald-50 text-emerald-700
  "Ignorar" active:       bg-slate-100 text-slate-500

Loading state (isUpdating === true for this row):
  All three buttons: opacity-50 pointer-events-none
  The active button shows a tiny inline spinner (8px, currentColor) replacing the label text

Error state per-row:
  Below the action cell (NOT in a toast, NOT in the panel error banner):
  text-[11px] text-red-500 mt-1
  "Error al actualizar. Inténtalo de nuevo."
  Position: absolute or a separate <td> colspan row below the affected row
  Recommendation: use a colspan="4" row inserted immediately after the affected row,
    padding-left matching the action cell column, so it reads as belonging to that row
```

#### Badge colours (trackingStatus column)

```
pending:   inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold
           bg-amber-50 text-amber-700 border border-amber-200
           Label: "Investigando"

resolved:  bg-emerald-50 text-emerald-700 border border-emerald-200
           Label: "Resuelto"

ignored:   bg-slate-100 text-slate-500 border border-slate-200
           Label: "Ignorado"

untracked: No badge rendered. Show "—" in text-slate-300 (em dash, centered).
```

Badge style is identical to the ConfidenceBadge pattern from §4.7 of this document — same token set, different semantic colours.

#### Optimistic update visual cue

When `isUpdating === true` for a row (optimistic update in flight):

```
Row background: bg-amber-50/30 (very subtle warm tint — noticeable but not alarming)
Transition: background-color 200ms ease-out
On success: background transitions back to white (200ms)
On error: background transitions to bg-red-50/30 for 1.5s, then back to white
```

Do NOT add a border color shift or a pulse animation — the subtle background tint is sufficient feedback and less visually noisy during rapid sequential updates.

---

### W32. Expand-Row UX (Panel B)

#### Chevron icon

```
Position: rightmost column, fixed width w-10, centered
Icon: 16px chevron-right SVG (stroke 1.5px, text-slate-400)
Collapsed: chevron-right (pointing right)
Expanded:  chevron-down (pointing down)
  (Use CSS transform: rotate(90deg) with transition-transform duration-200 ease-out
   to avoid swapping the icon and keep the animation smooth)

Whole row:
  hover: bg-slate-50 (subtle highlight — the row is clickable anywhere)
  cursor-pointer on the entire tr
  (Clicking anywhere on the row should toggle expand, not just the chevron icon)
```

#### Animation

```
Height transition using CSS grid trick (avoids max-height estimation issues):
  Collapsed: grid-rows-[0fr]  overflow-hidden
  Expanded:  grid-rows-[1fr]
  Transition: grid-template-rows 250ms ease-out

Inner wrapper: min-h-0 (required for the grid trick to work)

Do NOT use max-height animation — the resultData payload size is variable
(estimation intent returns fewer fields than comparison intent).
The grid trick handles arbitrary height without a hardcoded max.
```

#### Expanded content container

```
Expanded row: tr with td colspan="5" (all columns)
  (No additional border below the parent row — the expanded area is visually part of the same row)

Expanded content:
  py-4 px-6 bg-slate-50/60
  (Slightly indented off-white surface — similar to how GitHub PR diff blocks show context)

Left border accent:
  border-l-2 border-brand-green/30 ml-2
  (Subtle visual anchor connecting the expanded block to the parent row)
```

#### `resultData` rendering

**Recommendation: structured cards, not a JSON tree.**

Rationale: A raw JSON tree (`<pre>` + JSON.stringify) is developer-readable but not useful for the actual audit task — Pablo needs to quickly assess whether the *response quality* is correct for the *intent*. A structured renderer that shows the intent type prominently, the key fields in readable format (dish name, kcal, portions), and flags any anomalies (e.g., missing confidence) is far more useful than raw JSON.

This aligns with the ticket's option (a) — extract `<ResultBody>` from `TranscriptEntry.tsx` — which is the preferred path per the spec. The design expectation for the expanded area is:

```
Section heading: intent badge (same badge style as the table column) + intent label in larger text
  text-sm font-semibold text-slate-700 mt-0

Result body: rendered with the same visual language as NutritionCard (§4.5 of this document)
  bg-white rounded-xl border border-slate-100 p-4 mt-3
  (A mini NutritionCard inside the expanded row — uses existing component or a stripped-down version)

Raw JSON toggle (secondary, below the card):
  text-[11px] text-slate-400 underline cursor-pointer "Ver JSON bruto"
  Clicking reveals a <pre> block with monospace text, bg-slate-100, rounded-lg, p-3, overflow-x-auto
  (Escape hatch for debugging — hidden by default, available if needed)
```

---

### W33. Overview Panel C — Cards and Distributions

#### Scalar card grid

```
Grid: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4
  (1 column on phone, 2 on tablet, 4 on desktop)
  All 4 engine scalar cards in one grid row on desktop.

Scalar card:
  bg-white rounded-2xl border border-slate-100 p-5
  (Same rounded-2xl + border-slate-100 as NutritionCard — consistent card DNA)

Card internal layout:
  Heading: text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1
  Big number: text-[32px] font-extrabold leading-none text-slate-800
  Caption: text-xs text-slate-400 mt-1.5
```

Colour differentiation for `webTotalQueries` (from `/analytics/web-events`, not the engine):

```
webTotalQueries card:
  border-brand-green/20 bg-mist/30
  (Subtle green tint — same mist token from §2.1 — visually separates this
   "web session metric" from the four engine metrics without requiring a layout change)
  Heading: "Sesiones web · queries totales"
  Number color: text-brand-green (vs text-slate-800 for engine cards)
  Caption: "Confirma que NEXT_PUBLIC_METRICS_ENDPOINT está activo"
```

Position the `webTotalQueries` card as the 5th card in the grid (after the 4 engine cards), on its own row on desktop (`lg:col-span-1` within a second row, or `lg:col-span-4` if it should span full width). **Recommendation: place it alone in its own grid row with `col-span-full`, preceded by a `mt-6 pt-5 border-t border-slate-100` section separator and a subheading "Métricas web"**. This makes the source distinction visually explicit.

#### Distribution — byLevel (horizontal bar chart)

No chart library. Pure Tailwind + inline SVG / styled divs.

```
Section title: "Distribución por nivel" (subheading pattern from W28)

For each level (l1, l2, l3, l4, miss):
  Row: flex items-center gap-3 mb-2

  Label: text-xs font-medium text-slate-500 w-8 text-right
         (L1, L2, L3, L4, Miss — uppercase 2-char codes)

  Bar track: flex-1 bg-slate-100 rounded-full h-2
  Bar fill:  h-2 rounded-full transition-all duration-500 ease-out
             Width: percentage of total (inline style: width: X%)

  Bar colors:
    l1: bg-emerald-400
    l2: bg-brand-green   (same as #2D5A27, use bg-[#2D5A27])
    l3: bg-amber-400
    l4: bg-orange-400    (brand-orange family)
    miss: bg-red-400

  Count + percent: text-xs text-slate-500 w-20 text-right tabular-nums
                   "142 (38%)"
```

This is a pure CSS implementation — no SVG path math required. The bar fill width is set via inline `style` (`width: XX%`). Tailwind `transition-all duration-500` handles the enter animation naturally when data loads.

#### Distribution — bySource (api / bot)

```
Layout: flex items-center gap-8 justify-center py-4

For each source (api, bot):
  flex flex-col items-center gap-1.5

  Icon: 24px SVG (monochrome)
    api: code-bracket or terminal icon
    bot: chat-bubble-left icon
    Color: text-slate-400

  Count: text-2xl font-bold text-slate-700 tabular-nums

  Label: text-xs font-medium text-slate-400 uppercase tracking-wide
         "API" / "Bot"

  Percentage: text-xs text-slate-400 "(XX%)"
```

No pie chart. An icon + count + percent pair is faster to read at a glance and requires zero SVG arc math.

#### Top Queries and Top Intents (mini-tables)

```
Section layout: grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6
  (Side by side on desktop, stacked on tablet/phone)

Mini-table:
  No thead (section heading serves as the header)
  Each row: flex items-center justify-between py-2 border-b border-slate-50 last:border-0

  queryText cell: text-sm text-slate-600 truncate flex-1 mr-4
  count cell:     text-sm font-semibold text-slate-700 tabular-nums flex-shrink-0

  intent cell (topIntents): intent badge (same style as Panel B intent badges) + count
```

#### Per-data-source error visual

```
When queriesData fetch fails:
  Replace scalar cards + distributions with the error banner (W30 error state style)
  webTotalQueries card continues to render if webEventsData succeeded

When webEventsData fetch fails:
  webTotalQueries card shows error state:
    Same card shape but content replaced with:
    Icon: 16px warning SVG, text-red-400
    Text: text-sm text-red-600 "Error al cargar métricas web"
    Retry link (inline underline, same W30 pattern)
  topIntents section replaced with the error banner
  Engine scalar cards and distributions continue to render normally
```

---

### W34. i18n Key Structure — `messages/es/admin.json`

Namespace structure follows the component hierarchy: `admin.layout.*`, `admin.panel.missedQueries.*`, `admin.panel.responseReview.*`, `admin.panel.overview.*`. Shared strings (common across panels) live under `admin.common.*`.

**Placeholder convention:** `{count}`, `{hours}`, `{intent}`, `{min}`, `{max}` — curly braces, no spaces inside. The `useT` hook must support basic interpolation or the developer uses them as format strings with `String.replace`. Flag this for the frontend-planner — the spec's hook signature returns a plain string (`(key) => string`), which means interpolation is the caller's responsibility (`.replace('{count}', count.toString())`). This is consistent with the YAGNI i18n-light approach.

```json
{
  "layout": {
    "brandName": "nutriXplorer",
    "adminSuffix": "admin",
    "navAnalytics": "Analytics",
    "loading": "Verificando acceso...",
    "403": {
      "notProvisioned": {
        "title": "Acceso restringido",
        "body": "No se pudo verificar tu cuenta. Esto puede ocurrir si es la primera vez que accedes.",
        "hint": "Llama a /me primero para activar tu cuenta y vuelve a intentarlo.",
        "cta": "Ir a nutriXplorer"
      },
      "forbidden": {
        "title": "Acceso denegado",
        "body": "Se requiere nivel administrador para acceder a este panel.",
        "cta": "Volver"
      },
      "verifyFailed": {
        "title": "Acceso denegado",
        "body": "No se pudo verificar el nivel de cuenta. Inténtalo de nuevo.",
        "cta": "Volver"
      }
    }
  },
  "common": {
    "loading": "Cargando...",
    "retry": "Reintentar",
    "apply": "Aplicar",
    "all": "Todos",
    "timeRange": {
      "label": "Período",
      "24h": "24h",
      "7d": "7d",
      "30d": "30d",
      "all": "Todo"
    },
    "badge": {
      "pending": "Investigando",
      "resolved": "Resuelto",
      "ignored": "Ignorado",
      "untracked": "—"
    },
    "kind": {
      "text": "Texto",
      "voice": "Voz"
    }
  },
  "intent": {
    "estimation": "Estimación",
    "comparison": "Comparación",
    "menu_estimation": "Menú",
    "reverse_search": "Búsqueda inversa",
    "context_set": "Contexto",
    "text_too_long": "Texto largo",
    "follow_up_attribute": "Seguimiento",
    "follow_up_refinement": "Refinamiento"
  },
  "panel": {
    "missedQueries": {
      "title": "Búsquedas sin respuesta",
      "filterTopN": "Top N",
      "filterMinCount": "Mín. repeticiones",
      "filterTopNValidation": "Entre 1 y 100",
      "filterMinCountValidation": "Mínimo 1",
      "col": {
        "query": "Consulta",
        "count": "Repeticiones",
        "status": "Estado",
        "actions": "Acciones"
      },
      "action": {
        "track": "Investigando",
        "resolve": "Resuelto",
        "ignore": "Ignorar"
      },
      "actionError": "Error al actualizar. Inténtalo de nuevo.",
      "empty": "No hay búsquedas sin respuesta en este período.",
      "error": "Error cargando datos.",
      "rowCount": "{count} consultas"
    },
    "responseReview": {
      "title": "Respuestas para revisar",
      "filterIntent": "Intención:",
      "filterHours": "Horas",
      "filterLimit": "Límite",
      "filterHoursValidation": "Entre 1 y 720",
      "filterLimitValidation": "Entre 1 y 100",
      "filterIntentAll": "Todos",
      "summary": "Últimas {count} entradas en las últimas {hours} horas",
      "col": {
        "query": "Consulta",
        "intent": "Intención",
        "kind": "Tipo",
        "createdAt": "Cuándo",
        "expand": ""
      },
      "expandAriaLabel": "Ver respuesta completa",
      "collapseAriaLabel": "Cerrar respuesta",
      "rawJson": "Ver JSON bruto",
      "hideJson": "Ocultar JSON",
      "empty": "No hay entradas en el período seleccionado.",
      "error": "Error cargando muestras.",
      "rowCount": "{count} entradas"
    },
    "overview": {
      "title": "Vista general",
      "sections": {
        "engine": "Métricas del motor",
        "web": "Métricas web",
        "levels": "Distribución por nivel",
        "sources": "Distribución por origen",
        "topQueries": "Consultas más frecuentes",
        "topIntents": "Intenciones más frecuentes"
      },
      "card": {
        "totalQueries": {
          "label": "Consultas totales",
          "caption": "Peticiones procesadas por el motor"
        },
        "cacheHitRate": {
          "label": "Tasa de caché",
          "caption": "Respuestas servidas desde caché"
        },
        "avgResponseTimeMs": {
          "label": "Tiempo de respuesta",
          "caption": "Media en milisegundos"
        },
        "missRate": {
          "label": "Tasa de fallos",
          "caption": "Consultas sin resultado (nivel miss)"
        },
        "webTotalQueries": {
          "label": "Sesiones web · queries totales",
          "caption": "Confirma que NEXT_PUBLIC_METRICS_ENDPOINT está activo"
        }
      },
      "level": {
        "l1": "L1",
        "l2": "L2",
        "l3": "L3",
        "l4": "L4",
        "miss": "Miss"
      },
      "source": {
        "api": "API",
        "bot": "Bot"
      },
      "col": {
        "query": "Consulta",
        "count": "Veces",
        "intent": "Intención"
      },
      "noTopQueries": "Sin datos de consultas frecuentes.",
      "noTopIntents": "Sin datos de intenciones frecuentes.",
      "errorEngine": "Error al cargar métricas del motor.",
      "errorWeb": "Error al cargar métricas web.",
      "rowCount": "{count} entradas",
      "units": {
        "ms": "ms",
        "percent": "%"
      }
    }
  }
}
```

**Frontend-planner note:** The `useT` hook returns a plain string. Interpolation of placeholders like `{count}` and `{hours}` must be handled at the call site. Example:

```
// At call site (not inside the hook):
const summary = t('panel.responseReview.summary')
  .replace('{count}', String(data.items.length))
  .replace('{hours}', String(filters.hours));
```

This is consistent with the YAGNI i18n-light design. Do not add interpolation to the hook in this ticket.

---

### W35. Distinct 403 Page Treatments

Both 403 variants use the same layout shell (centered card) but differ in accent colour and copy. They are rendered by `AdminGuard` in place of `{children}` — the sidebar is NOT shown.

#### Layout (shared)

```
Outer: fixed inset-0 bg-white flex items-center justify-center p-6
  (Same full-page treatment as the auth loading spinner — prevents any dashboard chrome from showing)

Card: max-w-sm w-full bg-white rounded-2xl border p-8 text-center shadow-sm

Icon: 40px SVG, centered, mb-4

Title: text-xl font-bold mb-2

Body: text-sm text-slate-500 leading-relaxed mb-1

Hint (NOT_PROVISIONED only): text-xs text-slate-400 font-mono mt-2 mb-4
  (Monospace styling for the "Llama a /me primero" hint — visually communicates a technical instruction)

CTA button: full-width, centered, mt-5
```

#### NOT_PROVISIONED variant (recoverable)

Triggered when `account === null` after auth loaded AND the API returned `403 NOT_PROVISIONED`.

```
Card border: border-amber-200
Icon: 40px warning-triangle SVG, text-amber-400
Title: i18n key "layout.403.notProvisioned.title" — "Acceso restringido"
Body: i18n key "layout.403.notProvisioned.body"
Hint: i18n key "layout.403.notProvisioned.hint"
  Styled: text-xs font-mono bg-amber-50 text-amber-700 rounded px-2 py-1 inline-block

CTA: brand-orange button (same SubmitButton style from §4.4 of this document)
  Label: i18n key "layout.403.notProvisioned.cta" — "Ir a nutriXplorer"
  href: "/hablar"
```

Yellow/amber accent communicates: "this is a recoverable state, not a permanent denial."

#### FORBIDDEN variant (non-recoverable in this session)

Triggered when `account.tier !== 'admin'` — the user IS authenticated and provisioned, but lacks admin tier.

```
Card border: border-red-200
Icon: 40px shield-x SVG (or lock-closed), text-red-400
Title: i18n key "layout.403.forbidden.title" — "Acceso denegado"
Body: i18n key "layout.403.forbidden.body"
  (No hint — the user does not need a technical fix; they simply do not have admin access)

CTA: secondary/ghost button
  Style: border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl px-4 py-2 text-sm font-medium
  Label: i18n key "layout.403.forbidden.cta" — "Volver"
  Action: router.back() (or href="/hablar" if no history)
```

Red accent communicates: "this is a hard permission boundary."

#### Verify-failed variant (network error, not a permissions issue)

Triggered when `account === null` after sign-in but the cause is a network error (not `NOT_PROVISIONED`).

```
Card border: border-slate-200
Icon: 40px wifi-off or cloud-error SVG, text-slate-400
Title: i18n key "layout.403.verifyFailed.title" — "Acceso denegado"
Body: i18n key "layout.403.verifyFailed.body"

CTA: secondary/ghost button, same style as FORBIDDEN variant
  Label: i18n key "layout.403.verifyFailed.cta" — "Volver"
```

Neutral (slate) accent — no strong colour signal because this is a transient server error, not a permissions state.

**Anti-pattern: do NOT render a blurred/dimmed dashboard behind any of these 403 variants.** The dashboard panels must not render at all. The 403 page replaces `{children}` entirely.

---

### W36. Responsive Strategy

#### Desktop (≥1024px) — full layout

```
Shell: flex h-[100dvh]
  Sidebar: w-56 flex-shrink-0 (fixed-width, always visible)
  Content: flex-1 overflow-y-auto bg-slate-50
    max-w-7xl mx-auto px-6 py-8

Tables: full column widths, no horizontal scroll
Filter bar: inline, single row
Scalar card grid: lg:grid-cols-4
Distribution sections: side by side (lg:grid-cols-2)
```

#### Tablet (768–1023px) — sidebar collapses to header

```
Shell: flex-col h-[100dvh]
  TopBar: h-10 bg-white border-b border-slate-100 flex items-center px-4
    Left: "nutriXplorer admin" wordmark (text-sm font-semibold text-slate-500)
    Right: current page name "Analytics" (text-sm text-slate-600)
    (No hamburger menu — single nav link doesn't warrant a drawer)
  Content: flex-1 overflow-y-auto bg-slate-50
    px-4 py-6

Sidebar: hidden on tablet (the TopBar serves as orientation)

Tables: full columns still fit at 768px for Panel A (action buttons are the widest element at w-56)
  If the viewport is exactly 768px, the actions column may need to wrap within the cell — acceptable
Filter bar: flex-wrap gap-3 — wraps to two rows if needed, no truncation

Scalar card grid: md:grid-cols-2 (2 cards per row)
Distribution sections: stacked (single column)
```

#### Phone (<768px) — degraded-but-functional

```
Shell: flex-col h-[100dvh]
  Same TopBar as tablet
  Content: px-3 py-4

Tables:
  Outer wrapper: overflow-x-auto -mx-3 px-3
    (Negative margin + matching padding = edge-to-edge horizontal scroll without clipping the panel card)
  Table: min-w-[640px] (preserves column layout; user scrolls horizontally to see full table)
  Sticky headers remain (still useful even with horizontal scroll)

Filter bar: flex-wrap gap-2, numeric inputs narrow to w-14

Panel A action buttons: collapse to a compact icon-only dropdown on phone
  Each row gets a single "..." (more) button that opens a small popover with the 3 action options
  (The 3-button inline group is too wide for a 320px screen)
  Popover: bg-white rounded-xl border border-slate-100 shadow-lg p-2
    Each action: full-width text button in the popover

Panel B expand-row: on phone, the expanded content renders as a card BELOW the collapsed row
  (Not inside a td colspan — the column is too narrow for the result card to be readable)
  Card: full-width, bg-slate-50, rounded-xl, p-4, mt-1 mb-2

Scalar card grid: grid-cols-1 (single column, full width)
```

#### Anti-patterns for responsive

- Do NOT hide Panel C's distributions on tablet/phone — they render stacked, not hidden. Operator needs them for the NEXT_PUBLIC_METRICS_ENDPOINT smoke test (AC27).
- Do NOT prevent horizontal table scroll with `overflow-x-hidden` — that truncates data without a way to access it.
- Do NOT convert the sidebar link to a hidden hamburger with slide-out drawer on tablet. One nav item is not worth the interaction cost of a drawer. The TopBar wordmark is sufficient context.

---

### W37. Admin UI Anti-Patterns

(Specific to the admin panel — see §11 of this document for /hablar-specific anti-patterns)

| Anti-Pattern | Why |
|---|---|
| Showing all panels inside tabs | Hides complementary data; stacked is better for a single-user triage workflow |
| Dropdown action menu for Panel A row actions | Too slow for repeated triage; inline button group is faster |
| Rendering a JSON tree as the primary resultData view | Not useful for quality auditing; structured card is the primary view |
| Auto-submitting numeric inputs on every keypress | Causes fetch storms; validate and submit on blur only |
| Full-page error takeover when a single panel fails | Other panels still have data; per-panel error state is the correct scope |
| Using `max-height` animation for expand-row | Breaks for variable-height content; use CSS grid-template-rows trick |
| Showing the dashboard (even blurred) behind a 403 page | The guard must replace children entirely; no data behind the wall |
| Adding a shadow to panel cards | Border + off-white page background provides sufficient elevation; shadow is too heavy for a tool UI |
| Using a `<select>` for the TimeRange picker | 4 options belong in a segmented control; `<select>` adds unnecessary indirection |
