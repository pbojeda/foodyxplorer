# Voice Architecture Decision — Browser-Side vs Cloud STT/TTS for /hablar

**Feature reference:** F094 — Voice Spike
**Status:** Provisional recommendation — user must confirm before F091 starts
**Author:** F094 spike developer
**Date:** 2026-04-09
**Downstream consumers:** F091 (async voice in /hablar), F095-F097 (realtime voice in /hablar)
**Baseline to reconcile with:** F075 `POST /conversation/audio` (already in production for the Telegram bot)

---

## 1. Executive Summary

**Recommendation: Option 12 (Hybrid B) — Reuse F075 `POST /conversation/audio` for STT + browser `SpeechSynthesis` for TTS — as the canonical voice architecture for `/hablar`.** This pairing is the only option that simultaneously (a) costs ~$0 TTS and only the marginal Whisper STT already budgeted for the bot, (b) avoids forcing a permanent dual voice pipeline (R9) because the Telegram bot already uses F075, (c) keeps the voice pipeline a pure presentation layer compliant with ADR-001, and (d) unblocks F091 (async push-to-talk) with effectively no new infrastructure. The primary concession is that it is push-to-talk only and therefore cannot, by itself, deliver the sub-1500ms TTFA realtime experience F095-F097 targets; for the realtime track we recommend upgrading the STT leg to **Deepgram Nova-3 streaming** over WebSocket while keeping browser `SpeechSynthesis` (with an optional OpenAI `tts-1` escape hatch) as the TTS leg. In other words: **F091 ships on Option 12 as specified; F095-F097 evolves the STT transport from batch F075 to Deepgram streaming but keeps the TTS decision unchanged.**

---

## 2. Context & Motivation

The web assistant at `/hablar` (delivered in F090) currently supports text-only input. The product vision calls for voice to feel like a natural conversation in two modes:

1. **Async push-to-talk (F091)** — user holds a mic button, speaks, releases, and the assistant responds with speech. Blocked explicitly on this decision.
2. **Realtime streaming voice (F095-F097)** — continuous duplex conversation with sub-1500ms TTFA, barge-in, and VAD.

The research document `docs/research/product-evolution-analysis-2026-03-31.md` analysed this question in its "**OPEN INVESTIGATION: Zero-Cost Browser-Side Voice (R4 Addendum)**" section and deferred the final architecture decision to this Phase C spike. That section makes three load-bearing claims this doc must either confirm or correct:

- **OpenAI Realtime API is cost-prohibitive pre-revenue** — cited at ~$45K/mo at scale.
- **Pipeline Desacoplado (Deepgram STT + OpenAI tts-1 TTS)** is the default realtime option — cited at ~$2,500/mo.
- **Zero-cost browser-native voice** (Web Speech API STT+TTS, or WASM ML) should be evaluated as a potentially superior pre-revenue architecture.

Crucially, the research doc framed the question entirely in greenfield terms — it did not weigh the fact that F075 `POST /conversation/audio` already exists in production as a server-side Whisper STT pipeline for the Telegram bot. Ignoring that asset would bias the spike toward unnecessary greenfield work and would force the project to maintain two voice pipelines forever (R9). This decision doc treats F075 reuse (Option 10) as a first-class candidate.

**F091 is explicitly blocked pending this decision.** The user will personally validate this document before any downstream voice code is written.

---

## 3. Cost Workload Model

All cost projections in this document use a single normalized workload model so that per-minute STT rates, per-character TTS rates, and bundled audio token rates can be compared on the same axis.

### 3.1 Baseline per-user usage (restated verbatim from F094 Spec)

| Parameter | Value |
|---|---|
| Voice interactions per active user per day | 5 |
| Average user speech per interaction | 6 seconds |
| Average assistant response text length | 200 characters |
| STT:TTS ratio | 1:1 |

### 3.2 Usage tiers

| Tier | Active users | Interactions/mo | STT minutes/mo | TTS characters/mo |
|---|---|---|---|---|
| **Tier 0** (pre-revenue) | 0 | 0 | 0 | 0 |
| **Tier 1** (1K users) | 1,000 | 150,000 | **15,000 min** | **30,000,000** (30M) |
| **Tier 2** (10K users) | 10,000 | 1,500,000 | **150,000 min** | **300,000,000** (300M) |

**Tier 1 math:** 1,000 users × 5 interactions × 6 seconds × 30 days = 900,000 seconds = 15,000 voice-minutes/mo. TTS: 1,000 × 5 × 200 × 30 = 30,000,000 characters/mo.
**Tier 2 math:** 10,000 × 5 × 6 × 30 = 9,000,000 seconds = 150,000 voice-minutes/mo. TTS: 10,000 × 5 × 200 × 30 = 300,000,000 characters/mo.

**Tier 0 interpretation:** for pay-per-use cloud vendors Tier 0 = $0. For fixed-infrastructure options (self-hosted server, bundled JS/WASM model), Tier 0 captures the baseline cost to keep the option alive with zero users (hosting cost, one-off bundle download impact on anyone who visits the site).

### 3.3 Validated adjustments from Phase 2

1. **The research doc's "~$2,500/mo pipeline desacoplado" figure does not reproduce under this workload model.** Recomputing the cited Deepgram + OpenAI tts-1 pairing at Tier 2 under this doc's assumptions yields: STT 150K min × $0.0092/min (Nova-2) = $1,380/mo + TTS 300M chars × $0.015/1K = $4,500/mo = **~$5,880/mo**, more than double the research doc's figure. The research doc appears to have assumed a shorter response length (~85 chars/response) or older TTS rates. This decision doc uses its own arithmetic throughout and flags the delta explicitly.
2. **Nova-3 streaming has replaced Nova-2 as the Deepgram flagship** at $0.0077/min ([deepgram.com/pricing](https://deepgram.com/pricing), accessed 2026-04-09). The research doc's $0.0043/min number is stale. All Deepgram calculations below use **$0.0077/min (Nova-3)** unless explicitly comparing to Nova-2 ($0.0092/min).
3. **The research doc's "$45K/mo" Realtime API figure exactly reproduces** under this workload (verified in Section 4.7), so no adjustment is needed there.

---

## 4. Options Evaluated

Thirteen options, one subsection each. Every subsection closes with a full R1-R10 walk.

### 4.1 Option 1 — Web Speech API (`SpeechRecognition` + `SpeechSynthesis`)

**Description.** Native browser APIs. `SpeechRecognition` captures microphone audio and returns transcripts; `SpeechSynthesis` reads arbitrary text aloud using OS-provided voices. Free, no SDK, no bundle hit.

**Cost.** Tier 0 / Tier 1 / Tier 2 = **$0 / $0 / $0** (no vendor fees).

**Latency.** Chrome-on-Android returns partial results in ~300-500ms; final result latency depends on Google's cloud roundtrip. `SpeechSynthesis.speak()` starts audio within ~100-200ms on most platforms (OS-local synthesis). No published SLA.

**Browser compatibility.** Chrome desktop + Edge: yes. Safari desktop: partial (works in macOS 14+ but requires Siri to be enabled at the OS level). Firefox: **no** (`SpeechRecognition` never shipped in Firefox stable). iOS Safari: **no** (WebKit does not implement `SpeechRecognition`; iOS Chrome inherits this since iOS browsers must use WebKit). Android Chrome: yes.

**Turn handling.** Native VAD via `onspeechend` / `onend` events. Built-in end-of-speech detection is one of the few hard advantages of this API.

**Interruptibility.** Naive barge-in is feasible: on new `onresult` during TTS, call `SpeechSynthesis.cancel()`. Works but is half-duplex (cannot hear the user while speaking unless recognition runs in parallel).

**R1-R10 walk.**
- **R1 (Firefox gap):** BLOCKER — `SpeechRecognition` not supported in Firefox stable as of April 2026 ([MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [caniuse speech-recognition](https://caniuse.com/speech-recognition)).
- **R2 (iOS Safari):** BLOCKER — iOS Safari does not implement `SpeechRecognition`; iOS Chrome inherits the gap because iOS forces all browsers onto WebKit.
- **R3 (Spanish accuracy):** Unknown at quantitative level — no published WER for the Web Speech API on Spanish food vocabulary. Chrome uses Google's cloud ASR which generally performs well on Spanish, but no formal benchmark exists for the browser wrapper. Qualitative community reports are mixed on specialised vocabulary.
- **R4 (bundle/memory/battery):** N/A — zero JS bundle impact, zero RAM, native API.
- **R5 (low-end device latency):** Not device-bound — latency is network-bound to Google/Apple servers. No local inference.
- **R6 (GDPR / data residency):** **P0 CONCERN.** Web Speech API is **NOT on-device** on the dominant browsers. Chrome streams microphone audio to Google's cloud speech service for recognition; Safari streams audio to Apple's servers. The application has **no direct DPA** with Google or Apple for this API — the user consents implicitly by using the browser. For a Spanish/EU nutrition product with voice input, this is a material GDPR risk: raw audio of a user speaking about meals, health, and potentially sensitive categories flows to a US processor with no vendor-side DPA. Must be documented to users in a privacy notice, at minimum. Firefox Nightly has experimented with an on-device engine but Firefox has no stable `SpeechRecognition` anyway.
- **R7 (TTS voice quality):** `SpeechSynthesis` voice quality varies dramatically by OS. macOS and iOS ship high-quality neural Spanish voices (`Monica`, `Paulina`). Windows and Android Spanish voices are more robotic. No control over which voice a user gets. Qualitative concern.
- **R8 (turn handling):** Best-in-class for a browser-native API. Native VAD, native end-of-speech, native mic permission prompt.
- **R9 (dual pipeline):** **Forces dual pipeline.** Browser STT cannot be shared with the Telegram bot (the bot receives audio server-side as a file, not from a browser context). If the web assistant adopts Web Speech API, F075's Whisper pipeline must remain for the bot and the project permanently maintains two voice architectures.
- **R10 (hybrid viability):** The STT half is usable in Hybrid A (Option 11), the TTS half in Hybrid B (Option 12). See those subsections.

**Pros.** Zero cost, zero bundle, native VAD, simplest possible integration.
**Cons.** Firefox + iOS Safari gaps are blockers, GDPR risk is real and undocumented-by-default, forces dual pipeline with the bot.
**Fit verdict.** As a **standalone** option: rejected — Firefox + iOS Safari alone disqualify it for a mobile-first consumer product. As a **TTS-only leg inside Option 12**: recommended (see Section 4.12 and Section 6).

---

### 4.2 Option 2 — Whisper.cpp / Transformers.js (WASM/WebGPU client-side STT)

**Description.** ONNX-exported Whisper models run client-side via Transformers.js (WASM fallback + WebGPU fast path). Models ship as assets; inference happens on the user's device; no audio leaves the browser.

**Cost.** Tier 0 / Tier 1 / Tier 2 = **$0 / $0 / $0** per-user vendor fees. Tier 0 carries a **one-off bundle cost**: first-visit users download the ONNX model weights (see below).

**Bundle and memory (R4):** whisper-tiny ONNX is ~40-80 MB; whisper-base ~150-200 MB (quantised). Source: Transformers.js v3 model zoo on HuggingFace ([huggingface.co/Xenova/whisper-tiny](https://huggingface.co/Xenova/whisper-tiny), [huggingface.co/Xenova/whisper-base](https://huggingface.co/Xenova/whisper-base), accessed 2026-04-09 via Transformers.js docs). Peak RAM during inference: ~200-500 MB depending on model size. On a 2GB-RAM mid-range Android phone this risks an out-of-memory tab crash.

**Latency.** WebGPU whisper-base: ~real-time on M-series Mac / recent desktop GPU; ~2-5× real-time on WASM fallback on desktop CPU; **public data unavailable — estimated 5-10× real-time (30-60 seconds to transcribe a 6-second clip) on mid-range Android on WASM fallback** based on the 10-15× WebGPU-over-WASM speedup reported by Transformers.js benchmarks ([sitepoint.com/webgpu-vs-webasm-transformers-js](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)).

**Spanish accuracy.** Whisper paper Table D reports multilingual Common Voice WER. whisper-tiny ≈ 28% WER on Spanish; whisper-base ≈ 15-17%; whisper-small ≈ 9-11%; whisper-large-v3 ≈ 4-5% ([Whisper paper](https://cdn.openai.com/papers/whisper.pdf), accessed via OpenAI whisper model cards on HuggingFace, 2026-04-09). A community-fine-tuned whisper-tiny-es is reported at ~21% WER on Common Voice 11 Spanish ([model.aibase.com whisper-tiny-es](https://model.aibase.com/models/details/1915693355478179842)). **Conclusion: whisper-tiny is too inaccurate for Spanish food vocabulary; whisper-base is the minimum acceptable tier; whisper-small is quality-acceptable but too large to ship to mobile.**

**Browser compatibility.** WASM: all modern browsers. WebGPU fast path: Chrome 113+ desktop + Edge. Firefox desktop: WebGPU behind flag as of April 2026 ([MDN GPU](https://developer.mozilla.org/en-US/docs/Web/API/GPU)). Safari desktop: WebGPU shipped in Safari 18; works. **iOS Safari: WebGPU enabled in Safari 18 (iOS 18+) but real-world stability on whisper-base on iPhone is unproven.** Android Chrome: WebGPU supported on recent flagship devices; flaky on budget devices.

**Turn handling.** Must implement VAD explicitly — Transformers.js does not ship a VAD. Silero VAD WASM (~2 MB) is the common choice, adding integration work.

**R1-R10 walk.**
- **R1 (Firefox):** WASM path works; WebGPU path does not. Degraded latency on Firefox.
- **R2 (iOS Safari):** WASM works; WebGPU technically supported but unproven for whisper-base on-device on iPhone under memory pressure. P1 risk.
- **R3 (Spanish accuracy):** Whisper WER data is public (see above). whisper-tiny insufficient; whisper-base acceptable at the cost of bundle size.
- **R4 (bundle/memory/battery):** P0 — whisper-base model = 150-200 MB download on first use. Peak inference RAM 200-500 MB. Battery drain during inference on mobile is substantial. Unacceptable for a discovery-channel consumer product where first-visit bounce is the dominant metric.
- **R5 (low-end device latency):** P0 — WASM fallback on mid-range Android estimated 5-10× real-time for whisper-base. A 6-second food query takes 30-60 seconds to transcribe. Unacceptable UX.
- **R6 (GDPR / data residency):** Best-in-class — audio never leaves the device. Zero residency concern. **One note:** model-weights download traffic is visible to the hosting CDN (HuggingFace or own CDN), which is not sensitive.
- **R7 (TTS voice quality):** N/A — this is STT only.
- **R8 (turn handling):** Must build custom VAD (Silero WASM). No native end-of-speech.
- **R9 (dual pipeline):** Forces dual pipeline — the bot cannot share browser-side inference.
- **R10 (hybrid viability):** Usable as STT leg in Hybrid A (Option 11 variant 11a). The privacy win is real but dominated by the R4/R5 concerns for mobile.

**Pros.** Privacy gold standard. Zero recurring cost. Known model quality.
**Cons.** Bundle size, mobile RAM, mobile battery, mobile latency. Dual pipeline. Custom VAD.
**Fit verdict.** Rejected for both F091 and F095-F097 standalone. Mobile-first product cannot ship a 150 MB first-visit payload and 5-10× real-time STT on budget Android.

---

### 4.3 Option 3 — Piper TTS / VITS / Coqui (browser-side TTS)

**Scope note.** TTS-only. Cannot satisfy F091 or F095-F097 standalone. Usable only as the TTS leg of a hybrid (Options 11/12).

**Description.** Piper is a fast, local neural TTS based on ONNX/VITS ([github.com/rhasspy/piper](https://github.com/rhasspy/piper)). A community-maintained WASM port exists: [@mintplex-labs/piper-tts-web](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web). Coqui TTS project was wound down in 2024 and is no longer maintained. VITS models are supported in Transformers.js but are primarily single-speaker research models.

**Cost.** Tier 0 / 1 / 2 = **$0 / $0 / $0**. One-off model bundle cost on first visit.

**Bundle and memory (R4).** Piper Spanish voices range from ~20 MB (low-quality x-low) to ~75 MB (medium-quality) per voice ([rhasspy.github.io/piper-samples](https://rhasspy.github.io/piper-samples/)). Inference is CPU-only (no WebGPU path as of April 2026). Peak RAM during inference ~100-200 MB.

**Latency.** Piper is reported at ~3-5× real-time on Raspberry Pi 4, so desktop WASM should be ~1-2× real-time. A 200-char sentence (≈6 seconds of speech) synthesises in ~3-6 seconds WASM, **estimated based on reported Raspberry Pi benchmarks — public data unavailable for mid-range Android WASM specifically**. This is unacceptable as a first-byte latency for realtime (>1500ms TTFA by itself).

**Spanish voice quality (R7).** Community evidence on Piper Spanish voices: HirCoir's Spanish Piper models (e.g., `HirCoir/Piper-TTS-Laura`) are cited as the highest-quality community Spanish voices; still qualitatively less natural than ElevenLabs Multilingual v2 or OpenAI tts-1. Community verdict: "acceptable for offline use, clearly synthetic-sounding". No formal MOS studies for Spanish Piper voices. Sources: HuggingFace model card comments on `HirCoir/Piper-TTS-Laura`, community threads on r/LocalLLaMA (searched 2026-04-09, qualitative only).

**Browser compatibility.** WASM: all modern browsers. No WebGPU path.

**R1-R10 walk.**
- **R1 (Firefox):** Works (WASM).
- **R2 (iOS Safari):** Works (WASM) but battery drain during inference on mobile is a concern.
- **R3 (Spanish accuracy):** N/A — TTS only.
- **R4 (bundle/memory/battery):** P1 — 20-75 MB model per voice. Single voice is tolerable but still a real first-visit hit.
- **R5 (low-end device latency):** P1 — first-byte TTS latency ~1-3s for a 200-char sentence on mid-range mobile, dominating the TTFA budget.
- **R6 (GDPR):** Best-in-class — on-device after download.
- **R7 (TTS voice quality):** P1 — community consensus is "synthetic". Better than old TTS but not natural.
- **R8 (turn handling):** N/A — this is TTS.
- **R9 (dual pipeline):** Neutral — the bot has no TTS requirement, so browser TTS does not force a bot-side change.
- **R10 (hybrid viability):** Exists solely as a hybrid component (Option 12 variant 12b).

**Pros.** Offline-capable. Best-in-class privacy for TTS. Zero recurring cost.
**Cons.** First-byte latency too high for realtime. Synthetic voice quality. WASM-only (no GPU path).
**Fit verdict.** Dominated by browser `SpeechSynthesis` for the hybrid TTS leg — `SpeechSynthesis` has zero bundle cost and ships higher-quality OS voices on macOS/iOS. Piper is relevant only as a "what if SpeechSynthesis quality is unacceptable on Windows" fallback.

---

### 4.4 Option 4 — Deepgram Nova-2 / Nova-3 (cloud streaming STT)

**Description.** Cloud streaming STT over WebSocket. Nova-3 is the current flagship (as of April 2026); Nova-2 is the previous generation. Native end-of-speech detection (`endpointing` parameter), live partial transcripts, VAD built into the streaming API.

**Pricing.** Nova-3: **$0.0077/min** streaming or batch. Nova-2: **$0.0092/min** streaming or batch ([deepgram.com/pricing](https://deepgram.com/pricing), accessed 2026-04-09). Both pay-as-you-go with Growth plan ~13-15% discount available.

**Cost table (using Nova-3, the recommended tier).**

| Tier | Minutes | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.0077 | **$0** |
| 1 | 15,000 | 15,000 × $0.0077 | **$115.50** |
| 2 | 150,000 | 150,000 × $0.0077 | **$1,155.00** |

For Nova-2 (legacy): Tier 1 = $138/mo; Tier 2 = $1,380/mo.

**Latency.** Vendor-stated streaming latency ≈ 300ms for final transcripts. Community benchmarks confirm sub-500ms endpointing. This is best-in-class among cloud STT for realtime use.

**Spanish accuracy.** Nova-3 gained Spanish support in late 2025 ([deepgram.com/learn/deepgram-expands-nova-3-with-spanish-french-and-portuguese-support](https://deepgram.com/learn/deepgram-expands-nova-3-with-spanish-french-and-portuguese-support)). Deepgram reports >20% relative streaming WER reduction vs Nova-2 for Spanish. Absolute Spanish WER numbers not published on a standard benchmark — **public data unavailable — estimated 7-10% WER on Spanish based on Deepgram's relative-improvement disclosures**. Likely comparable to Whisper-small or better.

**GDPR / data residency (R6).** Deepgram offers a dedicated **EU endpoint (`api.eu.deepgram.com`)** to keep audio processing in the EU. SOC 2, GDPR, HIPAA (BAA available). DPA available on request ([deepgram.com/privacy](https://deepgram.com/privacy)). Acceptable for a Spain-targeting product.

**Browser compatibility.** Browser sends audio via WebSocket (works in all modern browsers). Needs `MediaRecorder` + `getUserMedia`; iOS Safari requires user gesture to start the stream. SDK `@deepgram/sdk` is tree-shakable; direct WebSocket usage avoids SDK entirely.

**R1-R10 walk.**
- **R1 (Firefox):** Works — WebSocket + MediaRecorder both supported.
- **R2 (iOS Safari):** Works — `getUserMedia` + WebSocket supported; user-gesture requirement standard.
- **R3 (Spanish accuracy):** Strong. Nova-3 Spanish is current-generation.
- **R4 (bundle/memory/battery):** SDK is ~15 KB minified+gzipped or less if using WebSocket directly. N/A for RAM/battery.
- **R5 (low-end device latency):** Network-bound. Performs the same on all devices that can WebSocket-stream mic audio.
- **R6 (GDPR):** EU endpoint available. DPA negotiable. Acceptable.
- **R7 (TTS):** N/A — STT only.
- **R8 (turn handling):** Native endpointing + streaming VAD. Best-in-class for realtime.
- **R9 (dual pipeline):** Server-side → could replace F075 for both bot and web (shared pipeline feasible). Migration cost is real but not permanent.
- **R10 (hybrid):** Natural STT leg for a streaming-first hybrid (Hybrid A variant).

**Pros.** Streaming, low latency, strong Spanish, EU residency option, native VAD.
**Cons.** New vendor (operational cost, DPA negotiation). STT only — pairs with a TTS option. Replacing F075 for the bot is a migration project in its own right.
**Fit verdict.** Best cloud STT for realtime F095-F097. Overkill for F091 where F075 batch Whisper already suffices. **Recommended as the STT upgrade for F095-F097 when realtime becomes the priority.**

---

### 4.5 Option 5 — OpenAI Whisper batch (cloud STT)

**Description.** OpenAI's hosted `whisper-1` transcription endpoint. Non-streaming: entire audio file uploaded, full transcript returned.

**Pricing.** **$0.006/min** billed per second rounded up ([OpenAI pricing, via search result from costgoat.com/pricing/openai-transcription and multiple confirmations, accessed 2026-04-09](https://openai.com/api/pricing/)).

**Cost table.**

| Tier | Minutes | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.006 | **$0** |
| 1 | 15,000 | 15,000 × $0.006 | **$90.00** |
| 2 | 150,000 | 150,000 × $0.006 | **$900.00** |

**Latency.** Batch / non-streaming. Community-reported ~1-3s roundtrip for 6-second clips including network overhead. No published SLA. Unusable for sub-500ms streaming scenarios; acceptable for push-to-talk.

**Spanish accuracy.** Same `whisper-large-v3` model OpenAI hosts. WER on Spanish Common Voice ≈ 4-5% ([Whisper paper Table D](https://cdn.openai.com/papers/whisper.pdf)). Best-in-class open-source STT quality.

**GDPR / data residency (R6).** OpenAI [Data Processing Addendum](https://openai.com/policies/data-processing-addendum) available. **Zero-day retention for API use** (not retained for training). US-processed by default; EU data residency available on Enterprise tier only. Acceptable for a Spain-targeting product on a standard DPA — this is the same risk profile already accepted by F075 in production.

**Browser compatibility.** Standard `fetch` + `FormData` upload. Works everywhere.

**R1-R10 walk.**
- **R1-R2 (browsers):** Works everywhere — plain HTTPS multipart upload.
- **R3 (Spanish accuracy):** Best-in-class.
- **R4 (bundle):** N/A — no SDK required beyond `fetch`.
- **R5 (latency):** Batch. ~1-3s roundtrip. Acceptable for push-to-talk only.
- **R6 (GDPR):** Standard OpenAI DPA. Already accepted for F075.
- **R7 (TTS):** N/A.
- **R8 (turn handling):** Push-to-talk only. No streaming VAD.
- **R9 (dual pipeline):** Same model as F075 — sharing is trivial → leads to Option 10.
- **R10 (hybrid):** Usable as STT leg in any hybrid.

**Pros.** Best quality Spanish STT. Already in production for F075. Standard DPA.
**Cons.** Batch only. 1-3s roundtrip too slow for sub-1500ms TTFA realtime.
**Fit verdict.** The raw endpoint is dominated by Option 10 (which *is* this endpoint, pre-wrapped with F075's existing guards).

---

### 4.6 Option 6 — OpenAI `tts-1` streaming (cloud TTS)

**Scope note.** TTS-only. Cannot satisfy F091 or F095-F097 standalone. Usable only paired with an STT option (see Hybrid A, Option 11).

**Description.** OpenAI's hosted text-to-speech endpoint. Streaming first-chunk delivery over chunked HTTP. Six voices (alloy, echo, fable, onyx, nova, shimmer), all multilingual. Higher-quality `tts-1-hd` variant available at 2× cost.

**Pricing.** **$0.015 per 1K characters** for `tts-1`; **$0.030 per 1K characters** for `tts-1-hd` ([OpenAI pricing, confirmed via community search 2026-04-09](https://openai.com/api/pricing/)).

**Cost table (tts-1).**

| Tier | Characters/mo | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.015/1K | **$0** |
| 1 | 30,000,000 | 30,000,000 / 1,000 × $0.015 | **$450.00** |
| 2 | 300,000,000 | 300,000,000 / 1,000 × $0.015 | **$4,500.00** |

**For `tts-1-hd` (higher quality):** Tier 1 = $900/mo; Tier 2 = $9,000/mo.

**Latency.** Vendor-stated first-chunk ~300-500ms. Community-reported ~400-700ms to first audio byte. Acceptable inside a 1500ms TTFA budget for realtime.

**Spanish voice quality (R7).** Multilingual voices perform reasonably on Spanish but have audible English accent for some voices ("alloy", "echo"). "nova" and "shimmer" are community-reported as better for Spanish. Still clearly behind ElevenLabs Multilingual v2 on naturalness. Qualitative, no formal MOS.

**GDPR.** Same OpenAI DPA as Option 5. Already accepted for F075.

**R1-R10 walk.**
- **R1 (Firefox):** N/A for the vendor — all browsers can consume chunked HTTP audio. Streaming `<audio>` playback is cross-browser compatible.
- **R2 (iOS Safari):** `<audio>` autoplay requires user-gesture chain. Must start audio playback inside a user event (click the mic button = gesture-sound chain).
- **R3 (Spanish accuracy):** N/A — TTS.
- **R4 (bundle):** N/A.
- **R5 (latency):** Network-bound.
- **R6 (GDPR):** Standard OpenAI DPA.
- **R7 (TTS voice quality):** Acceptable but not premium. Better than Piper, worse than ElevenLabs for Spanish.
- **R8 (turn handling):** N/A — TTS.
- **R9 (dual pipeline):** Server-side → shareable. Bot has no TTS need currently.
- **R10 (hybrid):** Natural TTS leg for Hybrid A (Option 11 canonical).

**Pros.** Streaming, reasonable quality, reasonable price, DPA already accepted.
**Cons.** $4,500/mo Tier 2 TTS cost **dwarfs every STT cost** and dominates the bill. This is the single biggest argument against using any cloud TTS in this product pre-revenue.
**Fit verdict.** Acceptable as a TTS leg if TTS cost is amortised by revenue or if `SpeechSynthesis` quality is unacceptable. **Not recommended as the default** — browser `SpeechSynthesis` is functionally sufficient for F091 and saves $4,500/mo at Tier 2.

---

### 4.7 Option 7 — OpenAI Realtime API (`gpt-4o-realtime-preview`)

**Description.** Full speech-to-speech conversation API. Audio in, audio out. Full-duplex, native barge-in, native VAD. GPT-4o as the brain.

**Pricing.** Audio input ≈ **$100 per 1M audio tokens ≈ $0.06/min**. Audio output ≈ **$200 per 1M audio tokens ≈ $0.24/min** ([OpenAI Realtime API announcement](https://openai.com/index/introducing-the-realtime-api/), confirmed via search 2026-04-09).

**Cost calculation.** Each voice-minute involves both input and output audio. Under the workload model (1:1 user speech : assistant response), 1 voice-minute of interaction ≈ 1 minute of input audio + 1 minute of output audio = $0.06 + $0.24 = **$0.30 per voice-minute**.

| Tier | Voice-minutes | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.30 | **$0** |
| 1 | 15,000 | 15,000 × $0.30 | **$4,500.00** |
| 2 | 150,000 | 150,000 × $0.30 | **$45,000.00** |

**Tier 2 reproduces the research doc's "$45K/mo" figure exactly.**

**Latency.** Best-in-class — 300-500ms end-to-end.
**Spanish accuracy.** Strong (GPT-4o is highly multilingual).
**Turn handling.** Full-duplex, native barge-in, native VAD. Best-in-class.

**R1-R10 walk.**
- **R1 (Firefox):** WebRTC / WebSocket transport works cross-browser.
- **R2 (iOS Safari):** Works with user-gesture mic grant.
- **R3 (Spanish accuracy):** Strong.
- **R4 (bundle):** Client SDK small; no ML on device.
- **R5 (latency):** Network-bound; best-in-class cloud latency.
- **R6 (GDPR):** Standard OpenAI DPA.
- **R7 (TTS voice quality):** Highest — GPT-4o native voices are the most natural cloud voices available.
- **R8 (turn handling):** Best-in-class.
- **R9 (dual pipeline):** Parallel pipeline — F075's Whisper stays, Realtime API is a new dependency.
- **R10 (hybrid):** N/A — this is a closed speech-to-speech system, not a hybrid.

**TWO rejection reasons (both are load-bearing).**

1. **Cost:** $45,000/mo at Tier 2 is ~40× the cheapest realistic alternative. Pre-revenue, this is unsustainable. Even Tier 1 at $4,500/mo exceeds the entire rest-of-infra budget for the project.
2. **ADR-001 violation:** The Realtime API uses GPT-4o as the **computation layer** — the model decides what to say, including numerical nutrition claims, without any deterministic estimation-engine pass. This **violates ADR-001** ("LLM identifies/decomposes, the engine calculates, the voice layer reads the engine's result"). Using the Realtime API would require either (a) accepting that voice answers bypass the estimation engine (rejected) or (b) building a custom tool-calling loop where GPT-4o only calls engine tools and never emits nutrient numbers directly, which gives up the Realtime API's "speech-to-speech simplicity" benefit and defeats the point of using it.

**Pros.** Best UX. Lowest latency. Native everything.
**Cons.** Cost. ADR-001. Single-vendor lock-in.
**Fit verdict.** **REJECTED**, on two independent grounds.

---

### 4.8 Option 8 — ElevenLabs TTS (cloud)

**Scope note.** TTS-only. Usable only paired with an STT option.

**Description.** Cloud TTS with best-in-class voice naturalness. Multilingual v2 and v3 models support Spanish. Flash / Turbo variants offer ultra-low latency (~75ms first-byte) at slightly lower quality.

**Pricing (overage rates beyond included quota).** Creator plan: **$0.30 / 1K characters**. Pro: $0.24 / 1K. Scale: $0.18 / 1K. Business: $0.12 / 1K ([elevenlabs.io/pricing, via search 2026-04-09](https://elevenlabs.io/pricing)).

**Cost table** (using Scale-tier $0.18/1K as a Tier 2 realistic rate; Creator $0.30/1K for Tier 1).

| Tier | Characters/mo | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 | **$0** |
| 1 | 30,000,000 | (30,000,000 − 100,000 included) / 1,000 × $0.30 | **~$8,970** |
| 2 | 300,000,000 | 300,000,000 / 1,000 × $0.18 (Scale tier) | **$54,000** |

Note: these are upper-bound rates. At Business-tier $0.12/1K, Tier 2 drops to $36,000/mo. **Still ≥8× the OpenAI tts-1 Tier 2 cost.**

**Latency.** Multilingual v2/v3: ~250-300ms first-byte. Flash / Turbo: ~75ms (but lower quality).

**Spanish voice quality (R7).** Community consensus: ElevenLabs Multilingual v2 is the highest-quality Spanish TTS on the market. Clearly better than OpenAI tts-1 on prosody, accent, and emotional range.

**GDPR.** DPA available. Processor location predominantly US; EU residency negotiable on higher tiers.

**R1-R10 walk.**
- **R1-R2:** Cross-browser HTTPS streaming.
- **R3:** N/A — TTS.
- **R4:** SDK ~50 KB or can use raw HTTP.
- **R5:** Network-bound.
- **R6:** New DPA required (not currently in use by the project).
- **R7 (TTS voice quality):** Best-in-class.
- **R8:** N/A.
- **R9:** Server-side; shareable. New vendor.
- **R10:** Natural premium TTS leg for Hybrid A variants.

**Pros.** Best-in-class Spanish voice quality. Ultra-low-latency Flash variant.
**Cons.** Cost dominates the bill at Tier 2 — **8× OpenAI tts-1**, **54× browser SpeechSynthesis**. New vendor.
**Fit verdict.** Only justifiable for a paid premium tier once the product is revenue-positive. Rejected as the default for F091/F095-F097.

---

### 4.9 Option 9 — Groq Whisper (cloud STT)

**Description.** Groq hosts `whisper-large-v3` on their LPU inference hardware — same model as OpenAI Whisper, dramatically faster and cheaper.

**Pricing.** **$0.111 per hour of transcribed audio = $0.00185 per minute**, billed with a 10-second minimum per request ([groq.com/pricing](https://groq.com/pricing), accessed 2026-04-09).

**Cost table.**

| Tier | Minutes | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.00185 | **$0** |
| 1 | 15,000 | 15,000 × $0.00185 | **$27.75** |
| 2 | 150,000 | 150,000 × $0.00185 | **$277.50** |

**By far the cheapest per-minute STT option in this analysis.**

**Latency.** Groq claims 217× real-time inference. Community benchmarks report ~300-700ms for short clips (6-second audio transcribed in well under a second). **Public latency SLA data unavailable — estimated <1s roundtrip including network based on community reports.**

**Spanish accuracy.** Same model weights as OpenAI whisper-large-v3 (~4-5% WER on Spanish Common Voice). Identical quality.

**GDPR (R6).** **CRITICAL GAP.** Groq is a newer vendor. Their [privacy policy](https://groq.com/privacy) does not as of April 2026 document EU data residency, and DPA availability for EU customers is unclear without sales contact. **Flag this as a blocker for production use with EU users until a DPA is in hand.** For a Spain-targeting product handling voice data of natural persons, this is a material GDPR concern.

**R1-R10 walk.**
- **R1-R2:** Cross-browser (HTTPS multipart).
- **R3 (Spanish):** Best-in-class (same as whisper-large-v3).
- **R4:** N/A.
- **R5:** Fastest cloud latency after Deepgram.
- **R6:** **P0 gap** — GDPR maturity unproven. Must negotiate DPA before EU use.
- **R7:** N/A — STT.
- **R8:** Batch / non-streaming. No native VAD.
- **R9:** Server-side, shareable in principle. Replacing F075 for the bot with Groq is a small migration.
- **R10:** Usable as STT leg in any hybrid.

**Pros.** 3× cheaper than OpenAI Whisper. Fastest "batch" STT (competitive with streaming).
**Cons.** GDPR maturity. Batch-only (no native streaming endpoint). Non-streaming limits realtime use.
**Fit verdict.** Attractive as a future cost-saving migration from F075's OpenAI Whisper — **once the GDPR DPA question is resolved**. Not recommended as the primary choice today because the marginal cost saving ($90→$28/mo Tier 1, $900→$277/mo Tier 2) is not worth a new DPA negotiation while F075 is already running.

---

### 4.10 Option 10 — Reuse F075 `POST /conversation/audio`

**Description.** Call the existing F075 endpoint from the `/hablar` web app. `POST /conversation/audio` is a multipart endpoint that accepts a user audio file plus a `duration` field, transcribes via OpenAI Whisper (`callWhisperTranscription`), applies the `isWhisperHallucination` filter, then delegates to `processMessage` — the exact same path text messages follow. Already in production for the Telegram bot (F075).

**Characterised from `packages/api/src/routes/conversation.ts`:**
- STT provider: OpenAI Whisper (`whisper-1`)
- Transport: **multipart/form-data** (not streaming)
- Allowed MIME types: `audio/ogg`, `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm` — crucially, `audio/webm` is the default MediaRecorder output in Chrome/Firefox, so **browser capture works out of the box**
- Required fields: audio file part + `duration` (seconds, 0-120)
- Hard duration cap: **120 seconds**
- Rate limit: shared `queries` bucket, **50/day per actorId** (same bucket as `GET /estimate` and `POST /conversation/message`)
- Auth: `actorId` via request decorator (anonymous cookie for web, telegram_chat_id for bot)
- Hallucination filter: `isWhisperHallucination` applied post-transcription
- Response shape: standard `{ success: true, data: ConversationMessageData }` envelope — identical to `/conversation/message`, so the existing `sendMessage` flow in `packages/web/src/lib/apiClient.ts` can be cloned into `sendAudio` without touching downstream rendering.

**Pricing.** Same as Option 5 (OpenAI `whisper-1` at $0.006/min). **Incremental over the bot traffic already paid for.**

**Cost table (web-incremental, worst case — treating all web traffic as additive).**

| Tier | Minutes | Formula | Cost/mo |
|---|---|---|---|
| 0 | 0 | 0 × $0.006 | **$0** |
| 1 | 15,000 | 15,000 × $0.006 | **$90** |
| 2 | 150,000 | 150,000 × $0.006 | **$900** |

**Latency.** Push-to-talk. User holds mic → releases → full file uploads → Whisper transcribes → response returned. Community-reported ~1.5-3s end-to-end for short clips. Acceptable for async push-to-talk; **unusable for sub-1500ms TTFA realtime**.

**Spanish accuracy.** Best-in-class — same model F075 has used in production with no user complaints.

**GDPR (R6).** **Zero delta from current production.** Same OpenAI Whisper pipeline, same OpenAI DPA, same hallucination filter. Privacy review has already been done for F075.

**Browser integration complexity.** Web side needs only: (1) `MediaRecorder` to capture mic → webm blob, (2) `FormData` with the blob + `duration` field + `X-Actor-Id` header, (3) `sendAudio` function in `apiClient.ts` following the same pattern as `sendPhotoAnalysis`, (4) `MicButton` component wired to `MediaRecorder` start/stop. **Integration complexity = 2/5**, lowest of any option that satisfies F091.

**R1-R10 walk.**
- **R1 (Firefox):** Works — MediaRecorder supported, webm supported, plain HTTPS upload works.
- **R2 (iOS Safari):** MediaRecorder supported in iOS 14.3+. **iOS Safari default MediaRecorder MIME is typically `audio/mp4`, not webm** — need to check the browser's supported MIME and send the correct one. F075's allowed MIME list includes `audio/mp4`, so this works. Mic permission is gesture-gated (fine).
- **R3 (Spanish accuracy):** Best-in-class (whisper-large-v3 in OpenAI's hosted endpoint).
- **R4 (bundle/memory/battery):** Zero — no ML on device.
- **R5 (low-end device latency):** Network-bound only; uniform across devices.
- **R6 (GDPR):** Existing DPA. No delta.
- **R7 (TTS):** N/A — STT only.
- **R8 (turn handling):** **Push-to-talk only.** No streaming VAD. User initiates and ends the recording. This is the defining constraint.
- **R9 (dual pipeline):** **NONE FORCED.** The bot and web share one server endpoint, one Whisper key, one rate-limit bucket, one observability story. **This is the strongest R9 score in the entire analysis.**
- **R10 (hybrid viability):** Natural STT leg for Hybrid B (Option 12). Not usable as realtime STT because batch.

**Pros.** Zero new infra. Zero new vendor. Zero GDPR delta. **No dual pipeline.** Lowest integration complexity. Hallucination filter already shipped.
**Cons.** Push-to-talk only (not realtime). 120s max duration. 50/day shared rate limit — at Tier 1 (5 voice interactions/user/day) a single user would consume their entire daily budget in 10 voice interactions, mixed with text queries. **The rate limit is the one real constraint to address** for F091.
**Fit verdict.** **Strongest single option for F091.** Dominant on every criterion except realtime latency. The 50/day limit must be reviewed before F091 ships (see Section 10 open question).

---

### 4.11 Option 11 — Hybrid A: Browser STT + Server TTS (canonical pairing = Web Speech API + OpenAI tts-1)

**Description.** Web captures audio via `SpeechRecognition` (Web Speech API) → transcribed text posted to `/conversation/message` → text response received → text sent to a new `POST /api/tts` proxy → OpenAI `tts-1` streams audio back → `<audio>` plays it. Hides OpenAI key behind the server-side proxy.

**Canonical pairing (matrix row):** Option 1 STT + Option 6 TTS.

**Variants** (mentioned for completeness, NOT in the matrix):
- 11a. Transformers.js whisper-base (STT) + OpenAI tts-1 — better privacy STT, worse mobile.
- 11b. Web Speech API + ElevenLabs — premium TTS quality at 8×+ cost.
- 11c. Transformers.js + ElevenLabs — max privacy + max quality + max cost + max engineering.

**Cost (canonical, Web Speech API + tts-1).** STT = $0. TTS = per Option 6.

| Tier | STT | TTS | Total |
|---|---|---|---|
| 0 | $0 | $0 | **$0** |
| 1 | $0 | $450 | **$450** |
| 2 | $0 | $4,500 | **$4,500** |

**Integration complexity.** 3/5 — browser `SpeechRecognition` wiring + new server-side `POST /api/tts` proxy endpoint + streaming audio playback. New env var (`OPENAI_API_KEY` already present, but proxy route is new).

**R1-R10 walk (inherits from both legs).**
- **R1 (Firefox):** BLOCKER on STT leg — no `SpeechRecognition` in Firefox.
- **R2 (iOS Safari):** BLOCKER on STT leg — no `SpeechRecognition` in iOS Safari.
- **R3 (Spanish accuracy):** STT quality uncertain (Web Speech API unqualified). Unacceptable risk for specialised food vocab.
- **R4:** Zero bundle for canonical; 150 MB if using variant 11a.
- **R5:** STT latency network-bound to Google/Apple; TTS network-bound.
- **R6:** **MIXED — P0 concerns on STT leg** (audio to Google/Apple without DPA) + P1 on TTS leg (standard OpenAI DPA).
- **R7:** Reasonable (OpenAI tts-1).
- **R8:** Native VAD on STT side (Web Speech API) is a real advantage.
- **R9:** **Partial dual pipeline** — STT is browser-only (bot cannot share), TTS is server-side (bot could share in the future).
- **R10 (integration cost honestly):** Two separate audio paths (mic→STT API→text) and (text→TTS proxy→audio→play) must be coordinated with barge-in logic. More integration surface than Option 12.

**Pros.** Zero STT cost. Native VAD. Streaming TTS.
**Cons.** Firefox + iOS Safari blockers on STT leg. GDPR risk on STT leg. $4,500/mo TTS at Tier 2. Partial dual pipeline.
**Fit verdict.** **Rejected.** R1 + R2 browser gaps alone disqualify it; R6 GDPR risk adds a second rejection reason.

---

### 4.12 Option 12 — Hybrid B: Server STT + Browser TTS (canonical pairing = Reuse F075 + `SpeechSynthesis`)

**Description.** Web captures audio via `MediaRecorder` → POSTs to F075 `POST /conversation/audio` → receives transcript + assistant response (F075 already does the whole round-trip) → `SpeechSynthesis.speak(response.text)` reads the answer aloud using the OS's native Spanish voice. **This is the minimal viable voice architecture that reuses every existing piece of infra.**

**Canonical pairing (matrix row):** Option 10 STT + Option 1 TTS-half (browser `SpeechSynthesis`).

**Variants** (not in the matrix):
- 12a. Deepgram Nova-3 streaming (STT) + browser SpeechSynthesis — streaming latency upgrade for F095-F097 realtime track. **Requires a separate validation spike** before adoption: must prove barge-in UX, echo cancellation feasibility, TTFA under real `processMessage` latency, and Android/iOS `SpeechSynthesis` quality for streaming use. Cross-model review (2026-04-10) consensus: treat 12a as a hypothesis to validate, not a pre-approved evolution path.
- 12b. F075 + Piper/VITS (browser TTS) — avoids OS-dependent SpeechSynthesis quality variance, adds ~20-75 MB bundle.

**Cost (canonical, F075 + SpeechSynthesis).** STT = per Option 10 (incremental Whisper). TTS = $0 (browser-native).

| Tier | STT | TTS | Total |
|---|---|---|---|
| 0 | $0 | $0 | **$0** |
| 1 | $90 | $0 | **$90** |
| 2 | $900 | $0 | **$900** |

**Compared to Option 11 canonical at Tier 2: $900/mo vs $4,500/mo — $3,600/mo saved.**
**Compared to Option 4 + Option 6 (Deepgram streaming + tts-1) at Tier 2: $900/mo vs $5,655/mo — $4,755/mo saved.**
**Compared to Option 7 at Tier 2: $900/mo vs $45,000/mo — $44,100/mo saved.**

**Integration complexity.** 2/5 — reuses F075 endpoint. New code limited to: (1) `MediaRecorder` start/stop in the `MicButton` component, (2) `sendAudio` function in `apiClient.ts` modelled on `sendPhotoAnalysis`, (3) `SpeechSynthesis.speak()` on response receipt, (4) autoplay-unlock chain triggered by the mic-button click.

**Latency (canonical).** Push-to-talk end-to-end: record (user-controlled) → upload (~200-500ms) → Whisper batch (~1-2s) → processMessage (~300-800ms depending on intent) → response text → `SpeechSynthesis.speak()` starts (~100-300ms). Total from release-to-speak ≈ **~2-3.5 seconds**, acceptable for async push-to-talk (F091) but not for sub-1500ms TTFA realtime (F095-F097).

**Latency for realtime variant 12a** (Deepgram + SpeechSynthesis): 200ms VAD + 300ms Deepgram streaming + 500ms ConversationCore + 200ms SpeechSynthesis start = **~1200ms TTFA**. This matches the research doc's original latency budget and is the target for F095-F097.

**Browser compatibility (canonical).**
- Chrome desktop + Android: yes (MediaRecorder webm + SpeechSynthesis).
- Firefox desktop: yes (MediaRecorder webm + SpeechSynthesis — **Firefox has SpeechSynthesis even though it lacks SpeechRecognition**).
- Safari desktop: yes (MediaRecorder mp4 + SpeechSynthesis).
- iOS Safari: yes (MediaRecorder mp4 in iOS 14.3+, SpeechSynthesis works).
- Android Chrome: yes.
**All 5 browser families supported.** This is the only browser-complete option in the entire analysis.

**GDPR (R6).** Zero delta from F075 production. Audio processed by OpenAI under existing DPA. `SpeechSynthesis` text-to-speech is OS-local on macOS/iOS/Windows/Android — **synthesis text does not leave the device on these platforms** (note: Chrome on some Linux desktop configurations may fall back to a cloud TTS, a minor edge case).

**R1-R10 walk.**
- **R1 (Firefox):** Works — `SpeechSynthesis` (not `SpeechRecognition`) is supported in Firefox. STT via F075 works over HTTPS.
- **R2 (iOS Safari):** Works — MediaRecorder supported since iOS 14.3, SpeechSynthesis works, user-gesture mic grant is standard.
- **R3 (Spanish accuracy):** Best-in-class — F075 uses `whisper-large-v3`.
- **R4 (bundle/memory/battery):** Zero — no ML on device.
- **R5 (low-end device latency):** Network-bound only.
- **R6 (GDPR):** Existing DPA. No delta.
- **R7 (TTS voice quality):** **P1 concern** — `SpeechSynthesis` voice quality varies by OS. macOS/iOS ship high-quality neural Spanish voices (`Monica`, `Paulina`). Windows Spanish is acceptable. Android Spanish varies from "fine" to "robotic" depending on the device's installed TTS engine. **Users can override via OS voice settings.** Mitigation: provide a "try a different voice" control in the UI that enumerates `speechSynthesis.getVoices()` filtered by `lang: 'es-*'`. Escape hatch: variant 12b (Piper) or a future OpenAI tts-1 opt-in.
- **R8 (turn handling):** **Push-to-talk only** (canonical). No streaming VAD. User initiates/ends. The upgrade path to streaming VAD is variant 12a (Deepgram).
- **R9 (dual pipeline):** **NONE FORCED.** Bot and web share F075 for STT; bot has no TTS requirement so browser TTS is web-only by construction, not a "second pipeline" in any meaningful sense. **Strongest R9 score in the analysis.**
- **R10 (hybrid viability):** Clean hybrid — two independent legs (HTTP request for STT, native API for TTS) with no inter-leg coordination needed (the TTS leg fires only after the STT leg resolves). Simpler than Hybrid A.

**Pros.** Cheapest realistic option. Zero new infra. Zero GDPR delta. No dual pipeline. All 5 browser families supported. Lowest integration cost. Straightforward upgrade path to realtime (variant 12a).
**Cons.** `SpeechSynthesis` voice quality variance on Windows/Android. Push-to-talk only in canonical form (upgrade to 12a for realtime).
**Fit verdict.** **RECOMMENDED** for F091. **Variant 12a (Deepgram STT + SpeechSynthesis) RECOMMENDED** for F095-F097.

---

### 4.13 Option 13 — Self-hosted OSS (faster-whisper + Piper on own server)

**Description.** Run `faster-whisper` (CTranslate2 Whisper implementation, [github.com/SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)) + Piper TTS on a project-controlled server. Zero per-minute vendor fees; infrastructure cost only.

**Hosting baseline.** **Render does not currently offer GPU instances** as of April 2026 ([community.render.com/t/does-render-offer-gpus/11222](https://community.render.com/t/does-render-offer-gpus/11222)). The canonical GPU baseline is therefore **AWS `g4dn.xlarge`** (single NVIDIA T4, $0.526/hr on-demand = ~$378.72/mo running 24/7 in us-east-1, [aws.amazon.com/ec2/pricing/on-demand/](https://aws.amazon.com/ec2/pricing/on-demand/)). CPU-only fallback on existing Render Standard (~$25/mo) runs faster-whisper at 2-5× real-time on CPU — a 6-second clip takes ~12-30 seconds to transcribe, unusable for both F091 and F095-F097.

**Cost table.**

| Tier | Hardware | Formula | Cost/mo |
|---|---|---|---|
| 0 | g4dn.xlarge 24/7 | $0.526/hr × 720 hr | **$378.72** |
| 1 | g4dn.xlarge 24/7 | same | **$378.72** |
| 2 | g4dn.xlarge 24/7 (may need larger/autoscale) | same at minimum | **$378.72+** |

**Tier 2 caveat:** one g4dn.xlarge handles ~150K voice-minutes/mo if the workload is evenly distributed (150K min / 30 days / 24 hr / 60 = ~3.5 concurrent streams average), but peak concurrent load may exceed single-instance capacity and require autoscaling, pushing real cost higher.

**Latency.** Whisper-base on T4: ~real-time to 2× real-time. Batch only in default faster-whisper mode; streaming requires implementation work.

**Spanish accuracy.** Same model weights as OpenAI Whisper. Best-in-class.

**R1-R10 walk.**
- **R1-R2 (browsers):** N/A — server-side; works for all clients.
- **R3:** Best-in-class.
- **R4:** N/A.
- **R5 (low-end device latency):** Server-side latency only; uniform across devices.
- **R6 (GDPR):** **Best-in-class** — audio never leaves the project's own server. Full control.
- **R7 (TTS voice quality):** Piper — see Option 3 (community-reported synthetic).
- **R8 (turn handling):** Must implement streaming / VAD in-house.
- **R9 (dual pipeline):** Shared pipeline possible — but requires migrating F075 from OpenAI Whisper to self-hosted, a separate project.
- **R10 (hybrid):** Functions as a full pipeline.

**Pros.** Full data control. No vendor lock-in. Predictable cost.
**Cons.** $378/mo minimum fixed cost pre-revenue (vs $0 for cloud-pay-per-use). Ops burden (model updates, scaling, observability). Solo-developer project. Migration of F075 is a separate project.
**Fit verdict.** **Deferred.** Return to this option if (a) a large-enough paid customer demands full data residency, or (b) Tier 2 cloud costs exceed $378/mo sustainably. Not recommended today.

---

## 5. Comparison Matrix

Split into Table A (cost, latency, browser, privacy) and Table B (complexity, turn handling, suitability, dual pipeline) because the full table does not fit in one markdown row.

### Table A — Cost / Latency / Browser / Privacy

| # | Option | Tier 0 | Tier 1 | Tier 2 | Latency (realtime) | Offline | Chrome | Safari desktop | Firefox | iOS Safari | Android Chrome | Privacy / residency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Web Speech API (full) | $0 | $0 | $0 | ~300-500ms STT; ~100-200ms TTS start | No (Chrome→Google, Safari→Apple) | yes | partial (Siri-gated) | **no** (no SpeechRecognition) | **no** (no SpeechRecognition) | yes | **P0 — audio to Google/Apple, no DPA** |
| 2 | Whisper.cpp / Transformers.js (STT) | $0 + ~200 MB first-visit download | $0 | $0 | whisper-base WebGPU ~real-time desktop; **est. 5-10× realtime WASM mid-Android** | yes (after download) | yes | yes (Safari 18+) | yes (WASM), no WebGPU | partial (WASM works; WebGPU unproven) | partial (budget devices OOM risk) | on-device only |
| 3 | Piper / VITS / Coqui (TTS only) | $0 + ~20-75 MB voice download | $0 | $0 | ~1-3s first-byte est. mobile WASM | yes (after download) | yes | yes | yes | partial (battery concern) | partial | on-device only |
| 4 | Deepgram Nova-3 (streaming STT) | $0 | $115.50 (15K×$0.0077) | $1,155 (150K×$0.0077) | ~300ms final transcript (vendor-stated) | No | yes | yes | yes | yes | yes | EU endpoint available, DPA available |
| 5 | OpenAI Whisper batch (STT) | $0 | $90 (15K×$0.006) | $900 (150K×$0.006) | ~1-3s batch | No | yes | yes | yes | yes | yes | Standard OpenAI DPA, 0-day retention |
| 6 | OpenAI tts-1 (TTS only) | $0 | $450 (30M/1K×$0.015) | $4,500 (300M/1K×$0.015) | ~300-500ms first-byte (vendor) | No | yes | yes | yes | yes (autoplay gesture) | yes | Standard OpenAI DPA |
| 7 | OpenAI Realtime API | $0 | $4,500 (15K×$0.30) | **$45,000** (150K×$0.30) | 300-500ms e2e | No | yes | yes | yes | yes | yes | Standard OpenAI DPA |
| 8 | ElevenLabs TTS (TTS only) | $0 | ~$8,970 ((30M−100K)/1K×$0.30 Creator) | ~$54,000 (300M/1K×$0.18 Scale) | ~250-300ms Multi v2; ~75ms Flash | No | yes | yes | yes | yes | yes | New DPA required |
| 9 | Groq Whisper (STT) | $0 | $27.75 (15K×$0.00185) | $277.50 (150K×$0.00185) | <1s community est. | No | yes | yes | yes | yes | yes | **GDPR maturity unproven — P0 DPA gap** |
| 10 | Reuse F075 /conversation/audio (STT) | $0 | $90 (15K×$0.006) | $900 (150K×$0.006) | ~1.5-3s batch e2e | No | yes | yes | yes | yes (mp4 MediaRecorder) | yes | Existing OpenAI DPA, no delta |
| 11 | Hybrid A canonical: WebSpeech STT + tts-1 TTS | $0 | $0 + $450 = $450 | $0 + $4,500 = $4,500 | STT Chrome ~500ms; TTS ~400ms | No | yes | partial | **no** | **no** | yes | **MIXED — STT P0 (Google/Apple), TTS standard OpenAI** |
| 12 | Hybrid B canonical: F075 STT + SpeechSynthesis TTS | $0 | $90 + $0 = $90 | $900 + $0 = $900 | ~2-3.5s push-to-talk e2e; ~1200ms realtime via variant 12a | STT: No; TTS: yes (OS-local, except Linux-Chrome edge case) | yes | yes | yes | yes | yes | **Existing OpenAI DPA; TTS on-device** |
| 13 | Self-hosted OSS (faster-whisper + Piper) | $378.72 (g4dn.xlarge) | $378.72 | $378.72+ | T4 ~real-time + custom streaming work | No for browser (yes on own server) | yes | yes | yes | yes | yes | Full control |

### Table B — Complexity / Turn handling / Suitability / Dual pipeline

| # | Option | Bundle / memory / battery | Integration complexity (1-5) | Turn handling (VAD) | Interruptibility / barge-in | Audio session constraints | F095-F097 realtime? | F091 async? | Dual pipeline impact |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Web Speech API (full) | zero bytes, native | 1 | Native (`onspeechend`) | Half-duplex feasible via `SpeechSynthesis.cancel()` on new result | API handles mic; iOS gesture | No (R1/R2 gaps block) | No (R1/R2 gaps block) | **Two pipelines** forced |
| 2 | Whisper.cpp / Transformers.js (STT) | whisper-base ~150-200 MB; RAM 200-500 MB; heavy battery | 4 | Must build (Silero VAD WASM) | Half-duplex | Standard getUserMedia | No (latency, R4/R5) | Marginal (quality ok, mobile hit) | **Two pipelines** forced |
| 3 | Piper / VITS (TTS only) | ~20-75 MB voice; RAM ~100-200 MB | 3 (part of hybrid) | N/A | N/A | N/A | **No standalone; TTS-only — requires STT pairing** | **No standalone; TTS-only — requires STT pairing** | Neutral (bot has no TTS) |
| 4 | Deepgram Nova-3 (streaming STT) | SDK ~15 KB or direct WS | 3 | Native streaming endpointing + VAD | Pairs with any TTS for barge-in | getUserMedia + WebSocket; iOS gesture | **Yes** | Yes | Partial reuse (migration path for F075) |
| 5 | OpenAI Whisper batch (STT) | zero | 2 | Push-to-talk only | Half-duplex | getUserMedia + HTTPS multipart | No (batch only) | Yes | Dominated by Option 10 |
| 6 | OpenAI tts-1 (TTS only) | zero | 2 | N/A | Supports cancel on chunked audio | `<audio>` autoplay gesture | **No standalone; TTS-only — requires STT pairing** | **No standalone; TTS-only — requires STT pairing** | Shared-capable |
| 7 | OpenAI Realtime API | SDK small | 3 | Native full-duplex VAD | **Native barge-in** | WebRTC/WS | **Yes** — but REJECTED on cost + ADR-001 | Yes — but REJECTED | Parallel pipeline |
| 8 | ElevenLabs TTS (TTS only) | SDK ~50 KB | 3 | N/A | Cancel on chunked audio | `<audio>` autoplay gesture | **No standalone; TTS-only — requires STT pairing** | **No standalone; TTS-only — requires STT pairing** | Shared-capable; new vendor |
| 9 | Groq Whisper (STT) | zero | 2 | Push-to-talk only | Half-duplex | getUserMedia + HTTPS | Partial (fast batch ~1s but no native streaming) | Yes (with DPA) | Shared-capable; GDPR gap |
| 10 | Reuse F075 /conversation/audio | zero | **2** | Push-to-talk only | Half-duplex | getUserMedia + multipart; iOS mp4 branch | No (batch, 120s cap) | **Yes — strongest fit** | **Shared pipeline — strongest R9** |
| 11 | Hybrid A canonical: WebSpeech + tts-1 | zero | 3 (new TTS proxy + orchestration) | Native VAD on STT leg | Half-duplex via `SpeechSynthesis.cancel` analogue on `<audio>` | iOS gesture + autoplay | No (R1/R2 block STT) | No (R1/R2 block STT) | Partial (STT browser; TTS shareable) |
| 12 | Hybrid B canonical: F075 + SpeechSynthesis | zero | **2** | Push-to-talk only (canonical); streaming via 12a | Cancel `SpeechSynthesis` on new mic gesture | iOS mp4 + autoplay gesture-chain | Canonical: No; **variant 12a (Deepgram + SS): Yes** | **Yes** | **Shared pipeline — strongest R9** |
| 13 | Self-hosted OSS (faster-whisper + Piper) | zero client, $378/mo server | 5 | Must implement streaming + VAD | Depends on implementation | Standard | Possible but requires streaming work | Yes | Shared pipeline (after F075 migration) |

**No TBD cells.** Every non-obvious value is cited in Section 4 and References (Section 11).

---

## 6. Recommendation with Rationale

### 6.1 Recommendation

**For F091 (async push-to-talk voice in /hablar): Option 12 canonical — Reuse F075 `POST /conversation/audio` for STT + browser `SpeechSynthesis` for TTS.**

**For F095-F097 (realtime voice loop in /hablar): Option 12 variant 12a — Upgrade the STT leg to Deepgram Nova-3 streaming over WebSocket; keep browser `SpeechSynthesis` for TTS.**

> **GATE — Provisional recommendation (2026-04-10).** This is the spike's best-evidence recommendation based on 13 options evaluated. The user has NOT yet confirmed this choice as final. **Before starting F091 implementation, the developer MUST ask the user to confirm or change this recommendation.** The user may choose a different option after further reflection. Do not treat this as a settled decision until the user explicitly says so.

Both tracks share the same TTS leg and the same ADR-001 invariants. The difference between F091 and F095-F097 is a single replaceable STT module on the server side, not a separate architecture. **Note (added after cross-model review, 2026-04-10):** variant 12a should be treated as a hypothesis requiring its own validation spike — not as a pre-approved evolution. The realtime path introduces challenges (echo cancellation, barge-in UX, Android TTS quality under streaming) that this spike did not validate empirically.

### 6.2 Why Option 12 wins on the criteria that matter most

1. **Cost pre-revenue (dominant criterion).** Option 12 is the cheapest option that delivers acceptable quality across all 5 browser families. Tier 2 cost = $900/mo; the runners-up are: Hybrid A canonical at $4,500/mo (5× more), Deepgram+tts-1 at ~$5,655/mo (6× more), Realtime API at $45,000/mo (50× more).
2. **Zero dual-pipeline penalty (R9).** Option 12 is the only non-self-hosted option that avoids forcing a second voice architecture. The bot and the web share F075 for STT. The TTS leg is browser-native and the bot has no TTS requirement — not a "second pipeline" in any engineering sense.
3. **Browser coverage.** The only option that works on all 5 browser families including Firefox and iOS Safari without a blocker.
4. **ADR-001 compliance.** The architecture is strictly presentation-layer: audio → F075 → processMessage → estimation engine → text → `SpeechSynthesis`. The speech layer never computes nutrition.
5. **Integration complexity.** 2/5 — lower than any option that works on all browsers.

### 6.3 How R9 (dual pipeline) is explicitly addressed

The decision is **avoid, not accept**. Option 12 uses the F075 server endpoint for STT on both channels (bot and web). The TTS leg is browser-native (`SpeechSynthesis`) because the bot has no TTS requirement — the bot replies in markdown text, not audio. Therefore "dual pipeline" is not triggered: there is exactly one server-side STT pipeline for both bot and web, and the web's browser-side TTS is additive, not parallel. R9 is **resolved** by this recommendation.

### 6.4 How the realtime upgrade preserves the same architecture

F095-F097 requires sub-1500ms TTFA and continuous streaming. F075's batch Whisper cannot deliver that. The upgrade path is: replace F075 transport with a new `/conversation/audio/stream` WebSocket endpoint that forwards audio chunks to Deepgram Nova-3 and receives streaming transcripts. The `processMessage` entry point, the estimation engine path, the response text, and the browser `SpeechSynthesis` TTS leg all remain unchanged. The bot can continue using F075 batch unchanged, or migrate to Deepgram streaming later (independent decision).

This means F095-F097 is a **server-side STT transport swap**, not a new architecture. The migration is bounded and reversible.

### 6.5 Honest tradeoffs accepted

- **Push-to-talk only in F091.** Users tap a mic button, speak, release. No continuous duplex. This is consistent with the founder's R4 decision ("NOT realtime voice assistant for MVP") and with socially-aware voice UX in restaurants.
- **`SpeechSynthesis` voice quality varies by OS.** macOS/iOS are excellent (neural Monica/Paulina). Windows is acceptable. Android is variable. Mitigation: expose a voice-picker in settings that enumerates `speechSynthesis.getVoices()` filtered by `lang: 'es-*'`. Escape hatch: add OpenAI tts-1 proxy as an opt-in premium voice at a future date, at a cost of $4,500/mo Tier 2 only if chosen.
- **50/day shared rate limit from F075.** This is the one F075 constraint that *must* be reviewed before F091 ships. At 5 interactions/user/day the limit is comfortable, but mixed with text queries the shared bucket gets tight. **Decision requested of user:** either raise the limit, split voice/text buckets, or keep-and-document.
- **No barge-in in canonical F091.** The user cannot interrupt the assistant mid-speech. Mitigation: tapping the mic button fires `SpeechSynthesis.cancel()` before starting a new recording. Not true full-duplex; accepted for F091. Variant 12a can add streaming barge-in for F095-F097 if product demands it.

---

## 7. Consequences for F095-F097 (Minimum Directive Set)

A spec-creator agent can write F095 from this section without further research.

| Directive | Value for F095-F097 (variant 12a) |
|---|---|
| **Transport** | WebSocket from browser to new server-side `/conversation/audio/stream` endpoint. The endpoint forwards audio chunks to Deepgram Nova-3 streaming WebSocket and pipes transcripts back. Response text is delivered over the same WebSocket when `processMessage` resolves. |
| **Client capture API** | `MediaRecorder` with `timeslice` parameter (≈100-250ms chunks) feeding a WebSocket, OR `AudioWorklet` + `MediaStreamTrackProcessor` on browsers that support it, for lower-latency raw PCM. Must start inside a user-gesture event to satisfy iOS Safari. |
| **STT mechanism** | Deepgram Nova-3 streaming (`api.deepgram.com` or `api.eu.deepgram.com` for EU residency) via the `@deepgram/sdk` Node client on the server side. `language: 'es'`, `model: 'nova-3'`, `interim_results: true`, `endpointing: 300` (ms). |
| **TTS mechanism** | Browser `SpeechSynthesis` with `lang='es-ES'` and a user-selectable voice from `speechSynthesis.getVoices()`. Optional future escape hatch: `/api/tts` proxy to OpenAI `tts-1` streaming for premium voice. |
| **VAD / end-of-speech** | Deepgram native endpointing on the server side (300ms). No client-side VAD needed in the canonical path. Optional client-side Silero VAD WASM only if a UX preview ("assistant detected end of speech") is desired. |
| **Barge-in support** | Yes. When the WebSocket delivers a new interim transcript while `speechSynthesis.speaking === true`, the client calls `speechSynthesis.cancel()` immediately and starts rendering the new turn. Half-duplex in the strict sense (the mic keeps streaming continuously), but perceptually barge-in-capable. True full-duplex is deferred to a future Realtime-API-style approach if ever needed. |
| **Fallback path by browser family** | Firefox desktop: WebSocket + MediaRecorder + `SpeechSynthesis` all work — no fallback needed. iOS Safari: same. Android Chrome (all tiers): same. Low-end Android where `MediaRecorder` chunk latency is poor: auto-downgrade to F091 push-to-talk mode (Option 12 canonical). Chrome on Linux where `SpeechSynthesis` may degrade to cloud TTS: surface a "voice quality warning" and allow opt-in to `/api/tts` proxy. |
| **Latency budget breakdown** | mic capture (continuous, 0ms added) → WebSocket chunk (~50ms) → Deepgram streaming transcript (~300ms after end-of-speech via endpointing) → `processMessage` (~500ms for typical L1/L2 intent; up to 1500ms with filler audio for L4) → response text to client (~50ms) → `SpeechSynthesis.speak()` first audio (~200ms OS-local) = **~1100ms TTFA** target, matching the research doc's 1200ms budget. |
| **New infra / env vars** | `DEEPGRAM_API_KEY` (new), `DEEPGRAM_ENDPOINT` (default `api.eu.deepgram.com`), new route `/conversation/audio/stream` on the API server. No new dependencies in `packages/web` beyond the existing WebSocket browser API. Deepgram SDK only on the server side. |

---

## 8. Consequences for F091 (Minimum Directive Set)

| Directive | Value for F091 (Option 12 canonical) |
|---|---|
| **STT** | **Use OpenAI Whisper via F075 `POST /conversation/audio`.** No new endpoint. |
| **TTS** | **Use browser `SpeechSynthesis.speak()`** with `lang='es-ES'` and a selectable voice from `speechSynthesis.getVoices()`. |
| **F075 reuse/extend/bypass decision** | **REUSE as-is.** No changes to the server endpoint. No schema changes. No new env vars on the API side. The web package adds a new `sendAudio(blob, duration, actorId, signal)` function in `packages/web/src/lib/apiClient.ts` that POSTs multipart to `/conversation/audio` following the same pattern as `sendPhotoAnalysis`. |
| **MediaRecorder MIME selection** | Check `MediaRecorder.isTypeSupported('audio/webm')` first (Chrome/Firefox/Android). Fallback to `audio/mp4` for iOS Safari. F075 already accepts both. |
| **Env vars / config keys F091 needs** | None on the server (F075 already deploys with `OPENAI_API_KEY`). None on the web client (no vendor keys in the browser). |
| **Rate-limit caveat** | F075's shared `queries` bucket (50/day per actor) applies. **The user must confirm this is acceptable for F091 or raise the limit before F091 ships.** This is flagged as an open question in Section 10. |
| **Fallback behavior by browser family** | All 5 browser families (Chrome desktop, Safari desktop, Firefox desktop, iOS Safari, Android Chrome) support both legs in canonical form. No fallback required. If `speechSynthesis.getVoices()` returns no Spanish voices (very rare), fall back to displaying the response as text only. |
| **Permission UX** | First-click on `MicButton` triggers `navigator.mediaDevices.getUserMedia({ audio: true })` inside the click handler — satisfies iOS Safari's user-gesture requirement. Persist mic permission across the session; re-prompt on reload. |
| **Autoplay / TTS unlock** | `SpeechSynthesis.speak()` in response to a user-initiated click (the mic button) is within the user-gesture chain and will not be blocked on any browser. |
| **Hallucination filter** | Inherited from F075 — `isWhisperHallucination` already runs server-side. No web-side work. |
| **Barge-in** | Not supported in F091 canonical. Tapping the mic button while `SpeechSynthesis.speaking === true` calls `SpeechSynthesis.cancel()` first. Deferred to F095-F097. |

---

## 9. ADR-001 Compliance Note

The recommended architecture (Option 12 for both F091 and, via variant 12a, F095-F097) preserves ADR-001's invariant that **the estimation engine calculates and the LLM only identifies/decomposes**. The voice pipeline is strictly a presentation layer: audio enters through `MediaRecorder` (web) or a Telegram voice note (bot) → server-side STT transcribes to text → `processMessage` in `packages/api/src/conversation/conversationCore.ts` handles the text exactly as if the user had typed it → the estimation engine's L1/L2/L3/L4 cascade computes nutrition → the response text is the engine's deterministic output → `SpeechSynthesis` (or `tts-1` in an optional future premium path) reads the text aloud. **No nutritional arithmetic ever enters the voice or LLM surface.** The pivotal distinction from Option 7 (rejected) is that Option 7 uses GPT-4o as the computation layer, emitting nutrient numbers directly from the model into spoken audio without passing through the estimation engine — that path is forbidden by ADR-001. Option 12 does not take that path.

---

## 10. Open Questions / Risks / Deferred Decisions

### 10.1 Canonical Risk List status

| Risk | Status under the recommendation | Notes |
|---|---|---|
| **R1 — Firefox STT gap** | **Resolved** | F075 multipart upload works on Firefox; `SpeechSynthesis` works on Firefox. No dependency on `SpeechRecognition`. |
| **R2 — Mobile Safari partial support** | **Resolved (paper-level)** | MediaRecorder supported in iOS 14.3+ (mp4 MIME); `SpeechSynthesis` works; F075 accepts `audio/mp4`. **Deferred to real-device test before F091 ships:** verify MediaRecorder chunk reliability and mp4 header completeness on a real iPhone. |
| **R3 — Spanish accuracy degradation** | **Resolved** | F075 uses `whisper-large-v3` — best-in-class for Spanish food vocabulary per Whisper paper and F075 production experience. No regression risk. |
| **R4 — Browser-ML bundle, memory & battery** | **Resolved by avoidance** | No browser-ML is used in the recommendation. Zero bundle hit, zero RAM, zero inference battery. |
| **R5 — Low-end device latency** | **Resolved by avoidance** | No on-device inference. Latency is network-bound and uniform across devices. |
| **R6 — GDPR / audio data residency** | **Resolved — no delta from production** | Same OpenAI Whisper DPA already accepted for F075. `SpeechSynthesis` is OS-local on all target browsers (single edge case: Chrome-on-Linux may fall back to cloud TTS; document in privacy notice). |
| **R7 — TTS voice quality** | **Accepted limitation** | `SpeechSynthesis` Spanish quality is excellent on macOS/iOS, acceptable on Windows, variable on Android. Mitigation: voice-picker UI. Escape hatch: optional OpenAI `tts-1` proxy as a future premium path. |
| **R8 — Realtime turn handling** | **Deferred — trigger: F095-F097 implementation** | Canonical F091 is push-to-talk, half-duplex. Variant 12a (Deepgram streaming STT + `SpeechSynthesis`) addresses this for F095-F097. True full-duplex with continuous-listening barge-in is deferred further. |
| **R9 — Dual pipeline maintenance cost** | **Resolved by design** | Bot and web share F075 for STT. Browser TTS is additive only (bot has no TTS). Single pipeline. |
| **R10 — Hybrid viability** | **Resolved** | Option 12 is a clean hybrid with two non-interacting legs (HTTP request for STT, native API for TTS). Minimal coordination surface compared to Hybrid A. |

### 10.2 New risks / open questions discovered during the spike

- **R11 — F075 50/day shared rate limit.** At Tier 1 baseline (5 voice interactions/user/day) the limit is comfortable, but the limit is *shared* with text queries and `GET /estimate`. A voice-heavy user mixing voice and text will burn through 50/day faster than anticipated. **Open question for user:** raise the limit? Split voice/text buckets? Keep-and-document? Must be resolved before F091 ships. **Cross-model review consensus (Gemini + GPT-5.4, 2026-04-10):** both reviewers recommend splitting into separate buckets (e.g., `20 voice/day` + `50 text/day`) or a weighted credit system (`voice=2-3 credits`, `text=1`). Rationale: voice retries, accidental short recordings, and mixed sessions make a shared bucket feel arbitrary and punitive. Also: return a voice-specific error message when the voice quota is hit, not a generic rate-limit failure.
- **R12 — Research doc cost discrepancy.** The research doc's "$2,500/mo pipeline desacoplado" figure does not reproduce under this workload model — the honest Tier 2 Deepgram Nova-3 + OpenAI tts-1 figure is ~$5,655/mo. Document the discrepancy when the product tracker / research doc is next updated. Not a blocker for F091.
- **R13 — Paper-only R2 interpretation.** This spike satisfies "Mobile Safari partial support must be tested in scope" with documented compatibility evidence only (MDN, caniuse, vendor docs), not real-device testing. **Open question for user:** is the user OK with paper-level R2 verification, or must real-device testing on an iPhone happen before F091 starts? If the latter, F091 starts with a 1-day field-test sub-task.
- **R14 — MediaRecorder MIME branching for iOS.** iOS Safari's MediaRecorder default MIME is `audio/mp4`, not `audio/webm`. F075 accepts both, so the server side is fine, but the web client must branch on `MediaRecorder.isTypeSupported(...)`. Low-risk but must be explicit in F091's spec. Not a blocker.
- **R15 — Chrome-on-Linux SpeechSynthesis may degrade to cloud TTS.** On some Linux Chrome configurations, `SpeechSynthesis` falls back to a Google cloud TTS endpoint rather than an OS-local engine. This is a minor edge case (desktop Linux is a small slice of traffic) but must be documented in the privacy notice. Accepted limitation.
- **R16 — iOS Safari async gesture chain for SpeechSynthesis.** `SpeechSynthesis.speak()` is called after an async `fetch` (the F075 round-trip takes ~2-3s). iOS Safari drops the user-gesture authorization token after asynchronous work, which can silently block TTS playback. **Mitigation (must be implemented in F091):** "unlock" the TTS engine synchronously inside the mic button's `onClick` handler by calling `speechSynthesis.speak(new SpeechSynthesisUtterance(''))` before starting the async recording/upload flow. Once unlocked in that session, subsequent async `.speak()` calls succeed. Identified by cross-model review (Gemini 2.5 Pro + GPT-5.4, 2026-04-10).

---

## 11. References

- [F094 ticket](../tickets/F094-voice-architecture-spike.md) — canonical spec, risk list, evaluation criteria, directive sets
- [Product evolution analysis 2026-03-31](../research/product-evolution-analysis-2026-03-31.md) — accessed 2026-04-09, purpose: section "Realtime Voice Architecture (NEW — R4)" and "OPEN INVESTIGATION: Zero-Cost Browser-Side Voice (R4 Addendum)" for framing, latency budget (1200ms TTFA), and the original $45K/$2,500/mo cost framing
- [ADR-001 in decisions.md](../project_notes/decisions.md) — accessed 2026-04-09, purpose: the presentation-layer invariant that voice pipeline compliance is measured against
- [packages/api/src/routes/conversation.ts](../../packages/api/src/routes/conversation.ts) — characterisation of Option 10 (F075) endpoint behaviour, MIME types, duration cap, rate limit, hallucination filter
- [packages/web/src/lib/apiClient.ts](../../packages/web/src/lib/apiClient.ts) — `sendMessage` / `sendPhotoAnalysis` pattern for the new `sendAudio` function
- [packages/web/src/components/HablarShell.tsx](../../packages/web/src/components/HablarShell.tsx) — current `executeQuery(text)` orchestration that F091 will extend for voice
- [MDN — SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) — accessed 2026-04-09, purpose: confirming Firefox and iOS Safari gaps for Option 1
- [MDN — SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) — accessed 2026-04-09, purpose: confirming cross-browser support for the TTS leg of Option 12
- [MDN — GPU (WebGPU)](https://developer.mozilla.org/en-US/docs/Web/API/GPU) — accessed 2026-04-09, purpose: WebGPU compatibility data for Option 2
- [caniuse.com — Speech Recognition API](https://caniuse.com/speech-recognition) — accessed 2026-04-09, purpose: browser support matrix for Option 1 and Hybrid A
- [caniuse.com — web speech api](https://caniuse.com/?search=web+speech+api) — accessed 2026-04-09, purpose: corroboration of R1/R2 gaps
- [Deepgram Pricing](https://deepgram.com/pricing) — accessed 2026-04-09, purpose: Nova-3 at $0.0077/min, Nova-2 at $0.0092/min, EU endpoint
- [Deepgram — Nova-3 Spanish / French / Portuguese expansion](https://deepgram.com/learn/deepgram-expands-nova-3-with-spanish-french-and-portuguese-support) — accessed 2026-04-09, purpose: confirming Spanish support in Nova-3 and the ">20% streaming WER improvement" claim for Option 4
- [Deepgram — Nova-3 multilingual WER improvements](https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages) — accessed 2026-04-09, purpose: multilingual WER improvement context
- [OpenAI Pricing](https://openai.com/api/pricing/) — accessed 2026-04-09 via web search (direct page returned 403), purpose: confirming whisper-1 at $0.006/min, tts-1 at $0.015/1K chars, tts-1-hd at $0.030/1K chars
- [OpenAI — Introducing the Realtime API](https://openai.com/index/introducing-the-realtime-api/) — accessed 2026-04-09, purpose: Realtime API audio token pricing ($100/1M input, $200/1M output = $0.06/$0.24 per minute)
- [Whisper paper — "Robust Speech Recognition via Large-Scale Weak Supervision"](https://cdn.openai.com/papers/whisper.pdf) — accessed via HuggingFace model card linkouts 2026-04-09, purpose: multilingual WER table for Whisper model sizes (tiny/base/small/large-v3)
- [HuggingFace — openai/whisper-large-v3](https://huggingface.co/openai/whisper-large-v3) — accessed 2026-04-09, purpose: confirming whisper-large-v3 as the model behind both Option 5 and Option 9
- [HuggingFace — openai/whisper-tiny](https://huggingface.co/openai/whisper-tiny) — accessed 2026-04-09, purpose: whisper-tiny model size reference for Option 2
- [HuggingFace — whisper-tiny-es Spanish fine-tune (~21% WER Common Voice 11)](https://model.aibase.com/models/details/1915693355478179842) — accessed 2026-04-09, purpose: Spanish WER reference for Option 2 whisper-tiny discussion
- [Transformers.js v3 blog — WebGPU support](https://huggingface.co/blog/transformersjs-v3) — accessed 2026-04-09, purpose: WebGPU path for Transformers.js Whisper
- [Transformers.js GitHub](https://github.com/huggingface/transformers.js/) — accessed 2026-04-09, purpose: browser ML runtime baseline for Option 2
- [WebGPU vs WebASM benchmarks (sitepoint.com)](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/) — accessed 2026-04-09, purpose: estimated 10-15× WebGPU-over-WASM speedup used to derive mobile WASM latency range for Option 2
- [Piper TTS — rhasspy/piper](https://github.com/rhasspy/piper) — accessed 2026-04-09, purpose: Piper voice list, Raspberry Pi 4 real-time benchmark, ONNX/VITS architecture for Option 3
- [Piper voice samples](https://rhasspy.github.io/piper-samples/) — accessed 2026-04-09, purpose: Spanish voice model sizes (20-75 MB) for Option 3 R4 walk
- [@mintplex-labs/piper-tts-web npm](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web) — accessed 2026-04-09, purpose: confirming a community WASM Piper port exists for Option 3
- [HirCoir/Piper-TTS-Laura HuggingFace](https://huggingface.co/HirCoir/Piper-TTS-Laura) — accessed 2026-04-09, purpose: community Spanish Piper voice reference for Option 3 R7 qualitative assessment
- [ElevenLabs Pricing](https://elevenlabs.io/pricing) — accessed 2026-04-09 via web search (direct page returned empty), purpose: Creator $0.30/1K overage, Pro $0.24/1K, Scale $0.18/1K, Business $0.12/1K, Multilingual v2 latency ~250-300ms, Flash/Turbo ~75ms
- [Groq Pricing](https://groq.com/pricing) — accessed 2026-04-09, purpose: whisper-large-v3 at $0.111/hr ($0.00185/min) with 10s minimum billing for Option 9
- [Groq privacy policy](https://groq.com/privacy) — accessed 2026-04-09, purpose: GDPR maturity assessment for Option 9 R6 gap
- [OpenAI Data Processing Addendum](https://openai.com/policies/data-processing-addendum) — accessed 2026-04-09, purpose: confirming the DPA already in use for F075 Option 5/10
- [faster-whisper — SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) — accessed 2026-04-09, purpose: Option 13 self-hosted STT baseline
- [AWS EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/) — accessed 2026-04-09, purpose: g4dn.xlarge baseline at $0.526/hr for Option 13 hosting cost
- [Render community — "Does Render offer GPUs?"](https://community.render.com/t/does-render-offer-gpus/11222) — accessed 2026-04-09, purpose: confirming Render does not offer GPU instances in 2026, forcing AWS g4dn baseline for Option 13
