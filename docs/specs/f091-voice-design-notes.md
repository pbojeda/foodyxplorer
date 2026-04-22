# F091 Voice Design Notes — Async Push-to-Talk

**Feature:** F091 — Async Push-to-Talk Voice in /hablar
**Version:** 1.0
**Created:** 2026-04-20
**Status:** Draft — pending frontend-planner review
**Parent spec:** `docs/specs/hablar-design-guidelines.md`
**Architecture reference:** `docs/specs/voice-architecture-decision.md` §6 + §8

> This document fills gaps not covered by `hablar-design-guidelines.md`.
> It does NOT redefine existing voice state colors, ring animations, typography, or overlay structure.
> All token values, ring pulse specs, and state machine definitions in the parent spec remain authoritative.
> Read the parent spec first.

---

## 1. Dual Interaction Model

F091 introduces two distinct ways to trigger voice: **tap-to-open** (existing spec, §5) and **long-press-to-record** (new). Both must feel natural and discoverable. Neither replaces the other.

### 1.1 Gesture Disambiguation

The two gestures are distinguished by press duration. The threshold is **200ms** — measured from `pointerdown` to `pointerup` on the MicButton.

| Press duration | Classification | Behavior |
|----------------|---------------|----------|
| < 200ms | Tap | Opens VoiceOverlay (existing §4.8 behavior). User explicitly starts and stops recording inside the overlay. |
| ≥ 200ms | Long-press | Inline hold-to-record. Overlay does NOT open. Recording happens in-place with a condensed visual treatment on the MicButton itself. |

**Why 200ms?** It mirrors the WhatsApp voice note standard. Users who have sent voice messages in any major messaging app will have the muscle memory. Anything shorter risks false positives from fast taps; anything longer feels sluggish.

The timer starts at `pointerdown`. At 180ms, provide a **haptic hint** (if `navigator.vibrate` is available: `vibrate(10)` — a single 10ms pulse). This tells the user the gesture is being recognized before they consciously think about it. At 200ms, transition to hold state.

### 1.2 Hold-to-Record Visual Treatment

When the 200ms threshold is crossed, the MicButton enters **hold-to-record state**. The overlay does NOT open. Instead:

**MicButton in hold state:**
```
Scale: animate to 1.15× (from 1.0) over 150ms ease-out
Color: bg-brand-green (unchanged — the scale change communicates the state)
Ring: a single condensed ring appears immediately around the button (Ring 1 only)
      diameter: 48 + 16px = 64px
      color: rgba(45, 90, 39, 0.25) — slightly more opaque than listening state
      animation: ring-pulse 1.2s ease-in-out infinite (same keyframe as §7.3)
Icon: Microphone remains visible — do NOT show a waveform or change the icon
Shadow: shadow-lg (elevation increase signals active state)
```

**Cancel zone (WhatsApp-style drag-out):**
Position a cancel zone 80px to the LEFT of the MicButton center (or upward on small screens where left space is constrained). As the user drags their pointer left, a visual indicator appears:

```
Cancel affordance:
  Appears after pointer moves > 20px from MicButton center
  Shows: trash / X icon + "Desliza para cancelar" label
  Position: horizontally between the pointer and the MicButton center
  Style: text-[12px] text-slate-400 flex items-center gap-1.5
  Icon: 14px chevron-left SVG, text-slate-300

MicButton during drag toward cancel:
  Gradually desaturate fill: mix toward bg-slate-400 as distance increases (0px → full desaturate at 80px)
  Scale: 1.15 → 1.0 as user drags (feedback that recording is about to be dropped)
```

If the pointer is released inside the cancel zone (> 80px from center), the recording is discarded silently. No API call. Return to idle state. Brief haptic: `vibrate([5, 50, 5])` — two very short pulses to confirm cancellation.

If the pointer is released outside the cancel zone, recording stops and transitions to processing (same as tap-to-stop in overlay mode).

### 1.3 Tap vs Hold Disambiguation: Edge Cases

**What if user lifts finger immediately after 200ms?**
If `pointerup` occurs < 50ms after hold threshold is crossed (i.e., 200–250ms total), treat as a hold-record that produced a very short clip. Do NOT re-classify as a tap. The recording may be too short for Whisper to process; if transcription returns empty or fails, surface the empty-transcription error state (see §4.3 below).

**What if user holds > 200ms but never moves?**
Normal hold-to-record. Recording continues until `pointerup` or silence timeout (2s, same as overlay mode).

**Silence timeout in hold mode:**
If the user holds the button but says nothing for 2 seconds, stop recording and transition to processing. This prevents silent recordings consuming API quota. Visual feedback: the ring pulse should slow noticeably (cycle from 1.2s → 2.5s over 500ms) before stop, giving the user a hint that silence was detected.

**Mouse on desktop:**
Hold-to-record uses `mousedown` / `mouseup` on desktop. The cancel gesture uses horizontal drag. This works identically to mobile pointer events. No separate desktop-specific code is needed if pointer events are used uniformly.

### 1.4 Discoverability

Neither gesture is obvious without hints. Two discovery mechanisms:

**First-time hint tooltip:**
On the FIRST visit (localStorage flag `hablar_mic_hint_shown` not set), after the page has been idle for 2 seconds, display a tooltip anchored to the MicButton:

```
Style: bg-slate-800 text-white rounded-xl px-3 py-2 text-[13px] shadow-lg
       max-width: 220px text-center
Position: above MicButton, centered
Arrow: small downward triangle (CSS, 6px) pointing to the button
Content (two lines):
  Line 1: "Toca para hablar"
  Line 2 (dimmed, text-slate-400): "o mantén pulsado para grabar"
Dismiss: auto-dismiss after 4s, or on any interaction with the button
```

Set `hablar_mic_hint_shown = true` in localStorage after tooltip is shown. Never show again.

**EmptyState subtext update (existing §4.10):**
Change the EmptyState subtext from:
> "Escribe el nombre de un plato o usa el micrófono."

To:
> "Escribe un plato, toca el micrófono, o mantenlo pulsado para grabar."

This passive copy reinforces discoverability without requiring a tooltip.

---

## 2. Voice Picker UI

### 2.1 Placement Decision

The voice selector lives inside the VoiceOverlay, accessible via a small **settings pill** in the bottom-left corner of the overlay. It does NOT live on the MicButton (too small, wrong moment) or in an app-level settings panel (too buried).

```
Voice settings pill:
  position: absolute bottom-[calc(48px+env(safe-area-inset-bottom))] left-6
  (symmetric to dismiss X button at right-6)
  Size: auto — text label with icon, not a square button
  Style: inline-flex items-center gap-1.5
         bg-slate-100 hover:bg-slate-200 rounded-full
         px-3 py-2 text-[12px] text-slate-500 font-medium
         transition-colors duration-150
  Content: Speaker icon (16px) + voice name (e.g., "Monica")
  Aria: aria-label="Cambiar voz del asistente"
  Visibility: shown only in idle and ready states — hidden during listening/processing/speaking
```

### 2.2 Voice Picker Drawer

Tapping the voice settings pill opens a **bottom drawer** (not a modal, not a new overlay). It slides up over the existing VoiceOverlay.

```
Drawer container:
  position: absolute inset-x-0 bottom-0
  bg-white rounded-t-2xl shadow-2xl
  padding: px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]
  max-height: 60vh (prevents it from covering the full overlay)
  Entrance: translateY(100%) → translateY(0), duration 280ms, ease-out
  Exit: translateY(0) → translateY(100%), duration 200ms, ease-in

Drag handle:
  w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4

Heading:
  text-[15px] font-semibold text-slate-700 mb-3
  Content: "Voz del asistente"

Voice list:
  Scrollable list of available voices (filtered to Spanish `lang` attribute)
  Each row (see §2.3)

Note below list:
  text-[11px] text-slate-400 mt-3 text-center
  "Las voces disponibles dependen de tu dispositivo."
```

Close behavior: tap outside the drawer, drag down, or tap the currently-selected voice (toggle behavior).

### 2.3 Voice Row

Each voice in the list is a tappable row.

```
Voice row:
  flex items-center gap-3 py-3 px-2
  border-b border-slate-100 (last row: no border)
  cursor-pointer rounded-lg hover:bg-slate-50 transition-colors duration-100

Left: radio circle (20px) — brand-green fill when selected, slate-300 border otherwise
Center:
  Voice name: text-[14px] font-medium text-slate-700
  Locale hint: text-[11px] text-slate-400 (e.g., "Español · España" / "Español · México")
Right: Preview play button
  32px × 32px rounded-full
  bg-slate-100 hover:bg-brand-green hover:text-white
  transition-colors duration-150
  Icon: Play triangle 14px (changes to Pause 14px while preview plays)
  Aria: aria-label="Escuchar voz [name]"
```

**Preview playback:** Tapping the play button speaks a fixed Spanish preview phrase using that voice:
> "Hola, soy tu asistente nutricional. ¿En qué puedo ayudarte?"

Duration is approximately 4–5 seconds. The SpeechSynthesisUtterance is constructed with the selected voice but does NOT change the persisted selection — the user must tap the row's radio to select.

Only one preview plays at a time. If a second preview is triggered while one is playing, cancel the first (`speechSynthesis.cancel()`) and start the new one.

### 2.4 Best-Spanish-Voice Auto-Select Heuristic

On first load (before the user has made a manual selection), auto-select the best available Spanish voice using this priority order:

1. Filter `speechSynthesis.getVoices()` to voices where `lang` starts with `es`
2. Score each by checking name against a priority list (highest to lowest):

```
Priority list (ordered):
  "Monica"          — macOS/iOS, neural quality
  "Paulina"         — macOS/iOS, neural quality
  "Siri (Spanish)"  — iOS, Siri voice
  "Google español"  — Android Chrome, cloud-backed
  "Google español de Estados Unidos" — Android Chrome
  (any voice with lang = "es-ES") — prefer Spain Spanish for EU users
  (any voice with lang = "es-MX") — Mexico Spanish fallback
  (any voice with lang starts "es") — generic Spanish as last resort
```

3. If no Spanish voice is found at all, fall back to the first available voice. In this case, display a soft warning in the drawer: "No hay voces en español disponibles en este dispositivo."

Store the selected voice name in `localStorage.setItem('hablar_voice', voiceName)`. On subsequent loads, look up by name. If the stored voice is no longer present (e.g., user changed OS language settings), re-run the heuristic.

**Important iOS timing note:** `speechSynthesis.getVoices()` returns an empty array on iOS until the first user gesture. The voice list must be populated inside a `voiceschanged` event handler, OR deferred until `pointerdown` on the MicButton. Do NOT call `getVoices()` during page initialization on iOS — it will return empty and the heuristic will fail silently.

### 2.5 "Disable Spoken Response" Toggle

Below the voice list in the drawer, a toggle to disable TTS entirely:

```
Toggle row:
  flex items-center justify-between py-3 mt-2 border-t border-slate-100
  Label left: text-[14px] font-medium text-slate-700
              "Respuesta hablada"
  Toggle right: standard on/off toggle (brand-green when on, slate-300 when off)
                32px × 20px, thumb 16px
  Sublabel: text-[11px] text-slate-400 mt-0.5 (below label)
            "Desactiva si usas un lector de pantalla"
```

State stored in `localStorage.setItem('hablar_tts_enabled', 'false')`. Default: enabled (`true`).

When TTS is disabled: the speaking state and TTS rings never appear. Voice responses are shown as text only (result cards appear normally). The voice settings pill still shows in the overlay, but the preview play button is also disabled.

---

## 3. Accessibility

### 3.1 Screen Reader Coexistence

The primary risk is that a screen reader (VoiceOver on iOS, TalkBack on Android) will attempt to read newly arrived result cards WHILE `SpeechSynthesis` is playing the same content — producing a confusing audio collision.

**Resolution mechanism:**

Before calling `speechSynthesis.speak()`, check if the user has a screen reader active. There is no reliable programmatic way to detect VoiceOver/TalkBack from JavaScript. Therefore:

1. The "Disable spoken response" toggle (§2.5) serves as the manual opt-out. Its sublabel explicitly references screen readers.
2. The toggle's default state should be ON. This is the right default for sighted users. Screen reader users will find the toggle quickly because it is surfaced in the voice drawer, not buried in app settings.
3. Apply `aria-live="polite"` (not `assertive`) on the results region so that screen reader announcements yield to the user's current focus, reducing collision probability even when TTS is on.

**The `aria-live` placement rule:**
Only the results region gets `aria-live="polite"`. The VoiceOverlay's own state text ("Habla ahora", "Procesando...") uses `aria-live="polite"` on the overlay's `role="dialog"` container. Do NOT add `aria-live` to every element — over-announcements are as harmful as silence.

**Spoken response + screen reader interaction order:**
```
1. Processing completes → results data available
2. aria-live region announces: "Se encontraron [N] resultados." (screen reader reads this)
3. SpeechSynthesis.speak() is queued (if TTS enabled)
4. SpeechSynthesis does NOT attempt to cancel or interrupt screen reader
   — they run concurrently; if collision occurs, user uses the toggle to opt out
```

### 3.2 Focus Management

**On VoiceOverlay open:**
Move focus to the overlay's dismiss button (X), not the MicButton inside the overlay. The MicButton inside the overlay is the NEXT action (recording), but focus on the X first gives screen reader users an immediate escape route before they commit to recording.

ARIA pattern for the initial focus target:
```html
<button
  data-initial-focus
  aria-label="Cerrar búsqueda por voz"
>
```

**Focus trap while overlay is open:**
Tab cycles through: Dismiss button → MicButton (overlay) → Voice settings pill → Dismiss button. Nothing outside the overlay is reachable via Tab while it is open.

**On VoiceOverlay close:**
Return focus to the MicButton in the input bar. This is the element that triggered the overlay, so returning focus there follows ARIA dialog best practice and positions the screen reader user to interact with the same control again.

**On error toast (§9.3 in parent spec):**
The toast inside the overlay must be announced via `role="alert"` so it is read immediately, even if focus is elsewhere:
```html
<div role="alert" aria-live="assertive">
  <!-- error copy -->
</div>
```

### 3.3 Keyboard Shortcuts

These supplement (but never replace) the touch/click interactions.

| Action | Shortcut | Scope | Notes |
|--------|----------|-------|-------|
| Open VoiceOverlay | Space or Enter | When MicButton in bar is focused | Standard button activation |
| Start recording | Space | When overlay is open, MicButton focused | |
| Stop recording | Space | When in listening state | Toggle behavior |
| Cancel and close overlay | Escape | Any time overlay is open | Works from any focused element in overlay |
| Cancel hold-to-record | Escape | During hold gesture on desktop | Releases the hold without sending |
| Close voice picker drawer | Escape | When drawer is open | Falls back to overlay |

Do NOT add global keyboard shortcuts (e.g., Ctrl+M to open voice from anywhere on the page). Global shortcuts conflict with screen readers and browser shortcuts. Only shortcut within the context of focused elements.

### 3.4 Color Contrast Validation for Voice State Colors

The parent spec (§8.6) covers text contrast. This section validates the voice state ring and surface colors that were NOT in that table.

**Critical: rings are decorative, not informational.** The spec already requires text announcements for all state transitions (§8.5 of parent spec). The rings communicate state redundantly (color + animation). Therefore, rings do NOT need to meet contrast ratios — they are background decoration.

However, the following combinations ARE informational and must be validated:

| Combination | Ratio | WCAG AA | Notes |
|-------------|-------|---------|-------|
| `#FFFFFF` icon on `#2D5A27` mic button | 7.5:1 | AAA | Confirmed in parent spec |
| `#FFFFFF` icon on `#64748B` disabled mic | 4.6:1 | AA | Passes |
| `#FFFFFF` icon on `#245220` mic hover | 8.2:1 | AAA | Passes |
| `#FFFFFF` icon on `#1C4019` mic active | 9.1:1 | AAA | Passes |
| Voice settings pill: `#64748B` text on `#F1F5F9` | 4.0:1 | Fail at body size | Use `#475569` (slate-600) for pill text instead — achieves 5.0:1 on `#F1F5F9` |
| Toast: `#B91C1C` text on `#FEF2F2` | 5.5:1 | AA | Passes |
| Cancel affordance: `#94A3B8` (slate-400) on `#FFFFFF` | 2.8:1 | Fail | Decorative/transient — pair with icon + motion. If used as static label, use `#64748B`. |

**Action required:** Update the voice settings pill text color in implementation from `text-slate-500` (`#64748B`) to `text-slate-600` (`#475569`). This is a one-token change.

---

## 4. State Transitions — Error States and Retry

The parent spec §5.2 defines the happy-path state machine. This section adds error states and the retry UX.

### 4.1 Extended State Machine

New states added to §5.2:

```
listening → error_empty_transcription   Whisper returns empty string or whitespace only
listening → error_mic_permission        getUserMedia throws NotAllowedError BEFORE recording starts
listening → error_mic_hardware          getUserMedia throws NotFoundError / NotReadableError
processing → error_network              fetch() rejects or timeout > 15s
processing → error_rate_limit           API returns 429
processing → error_whisper_failure      API returns 500 or malformed response
speaking → error_tts_unavailable        SpeechSynthesis not supported, OR voices empty after timeout
any → error_budget_cap                  API returns custom 503 with body { code: "BUDGET_CAP" }
```

All error states transition back to `idle` when the user dismisses, OR to the appropriate retry action (see §4.4).

### 4.2 Visual Treatment Per Error State

All errors that occur inside the VoiceOverlay are shown as a toast (parent spec §9.3). The overlay then auto-dismisses after 2.5s. Do NOT leave the user stranded in the overlay on error.

Errors that occur after the overlay closes (processing errors) are shown as the ErrorState component (parent spec §4.11) in the results area.

| Error state | Location | Toast / ErrorState | Auto-dismiss |
|-------------|----------|--------------------|--------------|
| `error_empty_transcription` | Overlay | Toast | 2.5s, then idle |
| `error_mic_permission` | Overlay | Toast | 3s, then idle (no retry — user must go to browser settings) |
| `error_mic_hardware` | Overlay | Toast | 2.5s, then idle |
| `error_network` | Results area | ErrorState | No (user retries manually) |
| `error_rate_limit` | Results area | ErrorState (rate-limit variant) | No |
| `error_whisper_failure` | Results area | ErrorState | No |
| `error_tts_unavailable` | Results area | Soft inline notice (not ErrorState) | N/A |
| `error_budget_cap` | Results area | ErrorState (budget-cap variant) | No |

**`error_tts_unavailable` special treatment:**
Do NOT show a full ErrorState for TTS unavailability — the request succeeded and results are present. Show a small inline notice above the first result card:

```
Style: flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl
       px-4 py-2.5 mb-3 text-[13px] text-amber-800
Icon: Speaker with X, 16px
Copy: "La voz del asistente no está disponible en este navegador."
Dismiss: small X icon, right-aligned, aria-label="Cerrar aviso"
```

This notice persists until dismissed. It does not block interaction with the result cards.

### 4.3 Error Copy

Additions and replacements to the parent spec §9.1 table:

| Error state | Headline | Subtext | Action button |
|-------------|---------|---------|---------------|
| `error_empty_transcription` | "No detectamos ninguna voz" | "Habla más fuerte o prueba de nuevo." | — (overlay dismisses; re-tap to retry) |
| `error_mic_hardware` | "No se pudo acceder al micrófono" | "Comprueba que tu micrófono esté conectado." | — |
| `error_rate_limit` | "Demasiadas consultas" | "Has alcanzado el límite de búsquedas por voz por hoy. Inténtalo mañana o usa el texto." | — (no retry — limit is hard) |
| `error_whisper_failure` | "Error al procesar la voz" | "No pudimos entender el audio. Inténtalo de nuevo o escribe tu consulta." | "Intentar de nuevo" |
| `error_budget_cap` | "Búsqueda por voz no disponible" | "El servicio de voz está temporalmente pausado. Por favor, usa el campo de texto." | — (see §6.3) |

### 4.4 Retry Flow

For errors that support retry (`error_network`, `error_whisper_failure`), the retry experience must NOT require the user to re-record their audio.

**Retry preserves the last transcript:**
If a transcript was successfully obtained but the downstream API call failed, store the transcript text in component state. The ErrorState's retry button re-submits this transcript directly — it skips recording entirely and goes straight to `processing`.

Visual confirmation: when retry is triggered, the ErrorState is replaced by the LoadingState skeleton. The transcript text appears briefly in the ConversationInput field for 1 second (so the user knows what is being retried), then clears when results arrive.

**Retry for `error_empty_transcription`:**
No transcript was captured. Retry means re-recording. The retry affordance here is simply the input bar's MicButton returning to its ready state. No explicit "retry" button — the user's natural next action (tap mic again) is the retry.

**Maximum automatic retries:** None. All retries are user-initiated. Do NOT implement silent auto-retry for voice errors. The user spoke something specific; silently re-sending a failed transcript could produce unexpected behavior if the failure was content-related.

### 4.5 Voice-Locked State (Future-Proof)

F091 is open to all tiers (EAA compliance). However, if future requirements tier-gate voice (for example, gating premium realtime voice in F095-F097), the visual treatment for a locked voice feature should be consistent.

**This state is NOT rendered in F091 release.** The spec is provided for design consistency when F095+ gating is implemented.

```
MicButton locked state (tier gate):
  bg-slate-200 text-slate-400 cursor-not-allowed
  Overlay does not open on tap
  Instead: show a small tooltip or bottom sheet explaining the gate

Lock tooltip:
  Anchored to MicButton
  Style: bg-slate-800 text-white rounded-xl px-3 py-2 text-[13px] max-w-[240px] shadow-lg
  Content: "La voz en tiempo real es una función premium."
           + text-[12px] text-brand-orange mt-1 underline: "Ver planes"
  Duration: auto-dismiss after 3s

Lock icon:
  Overlay the MicButton with a small lock badge (12px, bottom-right of button)
  bg-slate-300 text-slate-600 rounded-full p-0.5
```

Do NOT show this treatment for F091 voice (which is always unlocked). Only apply to `realtime_voice` rate-limit tier in future.

---

## 5. Multi-Platform Reflection

F091 is web-first. Future native platforms (iOS, Android, desktop) will reimplement the same UX with native primitives. This section documents which design decisions translate cleanly and which will need native adaptation.

### 5.1 Design Decisions That Translate Cleanly to Native

| Decision | Web implementation | Native equivalent |
|----------|--------------------|------------------|
| Hold-to-record gesture (200ms threshold) | `pointerdown` / `pointerup` events | `UILongPressGestureRecognizer` (iOS) / `GestureDetector` (Android) — same 200ms threshold works |
| Cancel-on-drag-out gesture | Pointer delta from `pointermove` | Same gesture works natively — standard UX in messaging apps |
| Ring pulse animation (3 concentric rings) | CSS `@keyframes` | `CABasicAnimation` (iOS) / ObjectAnimator (Android) — same ring count, same opacity/scale values |
| Voice state machine (idle/ready/listening/processing/speaking/results/error) | React state | UIKit state machine / ViewModel states — protocol-first means same state names |
| VoiceOverlay as full-screen modal | `position: fixed inset-0` | `UIViewController.present(.fullScreen)` / `Dialog(fullscreen=true)` |
| Error states and copy | Toast + ErrorState components | Native snackbar / alert — same copy |
| "Disable spoken response" toggle | localStorage + UI toggle | UserDefaults / SharedPreferences — same UX placement |
| Voice picker drawer | Bottom sheet over overlay | Native `UISheetPresentationController` / `BottomSheetDialog` |

### 5.2 Web-Specific Affordances That Need Native Equivalents

**SpeechSynthesis voices:**

The web uses `SpeechSynthesis.getVoices()` which returns OS-level voices. Native platforms have equivalent but differently-named voices:

| Platform | Voice API | Best Spanish voice | Notes |
|----------|-----------|--------------------|-------|
| Web / macOS | `SpeechSynthesis` | "Monica" (macOS), "Paulina" (macOS) | Requires `voiceschanged` event |
| iOS native | `AVSpeechSynthesisVoice` | "es-ES" or "es-MX" identifier | `AVSpeechSynthesisVoice(language: "es-ES")` |
| Android native | `TextToSpeech` | `Locale("es", "ES")` | Quality varies by manufacturer TTS engine |
| Desktop (future) | Electron `SpeechSynthesis` or `say` | OS-dependent | macOS inherits same voices as web |

The auto-select heuristic (§2.4) uses voice names specific to web. Native implementations need a separate heuristic using native voice identifiers. The priority logic (Spain > Mexico > generic Spanish) is the same. Store voice preference as a locale string (`"es-ES"`) rather than a display name — this is cross-platform compatible.

**MediaRecorder → native audio capture:**

Web F091 uses `MediaRecorder` to capture audio as a WebM/Opus blob and POST it to F075. Native platforms:
- iOS: `AVAudioRecorder` — records to a local file (AAC/MP4 or WAV). The upload to F075 is the same multipart endpoint.
- Android: `MediaRecorder` — same name, different API. Records to MP4/AAC.
- F075 already accepts multiple MIME types (it pipes to Whisper which accepts MP4, WebM, MP3, WAV). No backend changes needed for native.

The design implication: the upload affordance (progress during `processing` state) must account for variable audio file size. WebM/Opus on web is very small. Native AAC may be larger for the same duration. Keep the "Procesando..." text generic — do NOT show upload progress (it would show for < 500ms anyway).

**iOS `pointerdown` SpeechSynthesis unlock:**

On iOS, `SpeechSynthesis.speak()` only works if called within a user gesture handler. The voice preview in the picker drawer (§2.3) and the first TTS playback after a voice query both require this. The implementation must call `speechSynthesis.speak()` directly inside the `pointerdown` or `click` event handler — NOT in an async callback after the fact.

Design consequence: the "speaking" state visual (gold TTS rings) will not appear until after the first user interaction that unlocks audio. On first use, the rings may not play for the first query. This is a platform limitation, not a design gap. Do NOT add a "tap to hear" affordance — it complicates the UX for all other platforms. Accept the first-query silence on iOS.

**VoiceOverlay on desktop browsers:**

The parent spec (§6.4) already specifies that VoiceOverlay stays full-screen even on desktop. This is the correct call — do not revisit it. Desktop native (Electron or future PWA) should follow the same convention. A centered modal on desktop would feel inconsistent with the mobile-first experience users built muscle memory for.

---

## 6. Privacy and Compliance UX

### 6.1 First-Time Mic Permission: Pre-Permission Context Screen

The browser's native mic permission dialog provides no context. Before triggering `getUserMedia()`, show a **pre-permission screen** within the VoiceOverlay to explain what will happen and why.

This pre-permission screen replaces the `ready` state visual on first voice use only. Subsequent uses skip it and go directly to the existing `ready → listening` flow.

**Trigger condition:** Show when `localStorage.getItem('hablar_mic_consented')` is null or absent.

```
Pre-permission screen layout (inside VoiceOverlay, same bg-white overlay):
  Position: same as VoiceOverlay center stack
  
  Icon: Microphone SVG, 48px, text-brand-green (same as MicButton icon, scaled up)
  
  Headline:
    text-[18px] font-semibold text-slate-700 mt-4 text-center
    "¿Podemos escucharte?"
  
  Body copy (2 paragraphs, text-[14px] text-slate-500 mt-3 leading-normal text-center px-2):
    P1: "Cuando uses la búsqueda por voz, tu audio se envía a OpenAI Whisper
        para convertirlo en texto. El audio se procesa y descarta inmediatamente —
        no lo almacenamos."
    P2: "Consulta nuestra [política de privacidad] para más detalles."
    — "[política de privacidad]" is a link: text-brand-green underline
      href="/privacidad" (or wherever privacy policy lives)
      Opens in new tab (target="_blank" rel="noopener")
  
  Primary button:
    Full-width, bg-brand-green text-white rounded-2xl py-3 text-[15px] font-semibold
    "Permitir micrófono"
    → triggers getUserMedia() on tap
  
  Secondary text link:
    text-[13px] text-slate-400 underline mt-3 text-center
    "Cancelar"
    → closes overlay, returns to idle
  
  Dismiss button (X): visible at top-right (same as overlay, aria-label="Cerrar")
```

**After permission is granted OR denied:**
Set `localStorage.setItem('hablar_mic_consented', 'shown')` — this records that the user saw the contextual screen. Do not store the actual permission result (browsers manage that; we just need to know the context was shown).

If the user denies permission, transition to `error_mic_permission` state with the existing toast, then idle.

### 6.2 Privacy Notice Affordance

The privacy policy must be updated to cover:
- Voice audio is captured via browser MediaRecorder API
- Audio is transmitted to OpenAI Whisper API for transcription
- Audio is NOT stored on nutriXplorer servers
- Transcription text may be used as query input and subject to standard nutriXplorer data handling

**In-product placement (passive, always accessible):**

Add a small "Privacidad de voz" link to the voice settings drawer (§2.2), below the TTS toggle:

```
Style: text-[11px] text-slate-400 underline mt-3 text-center block
       hover:text-slate-600 transition-colors
Content: "Cómo procesamos tu voz →"
Link: to voice-specific section of privacy policy (anchor link)
      Opens in new tab
```

This link is the ongoing disclosure mechanism after the first-time pre-permission screen. It does not need to be prominent — it just needs to exist and be reachable.

### 6.3 Monthly Budget Cap: Global Throttle UI

When the monthly voice budget cap is hit (API returns HTTP 503 with `{ code: "BUDGET_CAP" }`), all users globally see the `error_budget_cap` state. This requires careful UX to avoid panic or confusion.

**Visual treatment:**

Use the ErrorState component (parent spec §4.11) with a distinct visual to differentiate from a network error:

```
Error icon: Clock or Calendar SVG, 32px, text-amber-400
            (NOT the red warning icon used for network errors — budget cap is not user-caused)

Headline (text-[15px] font-medium text-slate-700):
  "Búsqueda por voz pausada momentáneamente"

Subtext (text-sm text-slate-400 mt-1):
  "Hemos alcanzado el límite mensual del servicio de voz.
   Puedes seguir buscando platos por texto."

Action: NO retry button (retrying will hit the same 503 until the month resets)

Inline CTA below subtext:
  text-[13px] text-brand-green underline cursor-pointer
  "Buscar por texto"
  → focuses the ConversationInput text field (not a navigation — just focus management)
```

**Persistence during cap period:**

While the cap is active, the MicButton in the input bar should show a visual hint that voice is unavailable — but do NOT fully disable it (user may not know why). Use a small badge on the MicButton:

```
Small dot badge on MicButton (top-right corner, 8px × 8px):
  bg-amber-400 rounded-full
  This appears ONLY when a prior voice request returned BUDGET_CAP
  Stored in sessionStorage (not localStorage — clears on browser restart; cap resets monthly anyway)
```

On tap, instead of opening the overlay, show the budget cap ErrorState inline (no overlay). This spares the user from entering the overlay only to see an error.

**Copy tone note:** The budget cap copy uses "pausada momentáneamente" (paused momentarily) rather than "sin servicio" (no service). Tone should communicate this is temporary and operational, not a product failure. Users at pre-revenue discovery phase are less likely to be frustrated by temporary limits than paying customers would be.

---

## Appendix: Open Questions for Spec-Creator and Frontend-Planner

The following questions were identified during design but are outside the UI/UX scope to resolve:

1. **Privacy policy anchor link:** What is the exact URL/anchor for the voice-specific section of the privacy policy? The pre-permission screen (§6.1) links to it but the policy may not exist yet.

2. **`error_budget_cap` HTTP contract:** The design assumes `503 { code: "BUDGET_CAP" }`. Frontend-planner must confirm this exact error shape with the backend spec, or update the error detection logic to match whatever shape is chosen.

3. **Pre-permission screen — is it mandatory for all first-time users, or only on first overlay open?** Current spec: first overlay open. If there is a legal requirement to show it before ANY microphone access (even if user previously granted permission in a prior session), the trigger condition changes.

4. **Voice picker drawer — what if `speechSynthesis.getVoices()` returns 0 Spanish voices on the user's device?** §2.4 specifies a fallback message. Confirm whether to hide the drawer's voice list entirely (showing only the TTS toggle) or keep the empty list visible with the warning.
