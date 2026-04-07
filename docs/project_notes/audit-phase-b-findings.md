# Phase B Audit — Findings Log

> Collected during post-Phase B audit (2026-04-07).
> To be resolved systematically via SDD workflow before Phase C.

## Code Bugs

| ID | Severity | Finding | Source | Status |
|----|----------|---------|--------|--------|
| C1 | HIGH | `/reverse-search` 404 CHAIN_NOT_FOUND returns `{success, code, message}` instead of `{success, error: {code, message}}` — inconsistent with API error envelope | Punto 2 + Codex | pending |
| C3 | HIGH | `/reverse-search` 400 validation error returns raw Zod `{formErrors, fieldErrors}` without `{success, error: {code: "VALIDATION_ERROR"}}` wrapper | Punto 2 + Codex | pending |
| C2 | MEDIUM | Conversation context set via `POST /conversation/message` ("estoy en X") does not persist for subsequent requests with same X-Actor-Id — `activeContext: null` on next request. Pre-existing (F069/F070 actor system design). Works when chain is passed in request body. | Punto 2 | pending |

## Documentation Fixes (Applied)

| ID | Manual | Finding | Source | Status |
|----|--------|---------|--------|--------|
| D1 | API | `UncertaintyRange.marginPercent` → actual field is `percentage` | Punto 2 | fixed |
| D2 | API | `HealthHackerTip.category` — field doesn't exist | Punto 2 | fixed |
| D3 | API | `DetectedAllergen.category` + `confidence` → actual fields are `allergen` + `keyword` | Punto 2 | fixed |
| D4 | API | `PortionSizing` missing `description` field | Punto 2 | fixed |
| D5 | API | Conversation examples missing `activeContext` (required nullable) | Gemini + Codex | fixed |
| D6 | API | `referenceBasis` missing `per_package` | Codex | fixed |
| D7 | API | `EstimateSource` missing OFF attribution fields | Gemini + Codex | fixed |
| D8 | API | `yieldAdjustment` structure undocumented (7 fields) | Gemini | fixed |
| D9 | API | Health check note wrong (Kysely IS checked) | Codex | fixed |
| D10 | API | `Retry-After` values imprecise | Codex | fixed |
| D11 | API | `availability` enum missing `regional` | Codex | fixed |
| D12 | Bot | Reverse search output format wrong (header, emojis, footer) | Gemini + Codex | fixed |
| D13 | Bot | `/comparar` counts as 2 queries (not 1) in daily bucket | Codex | fixed |
| D14 | Bot | Portion sizing terms wrong (`cuenco` → `caña`, `ración para compartir`) | Codex | fixed |
| D15 | Bot | `/menu` error messages not documented | Gemini | fixed |
| D16 | Bot | `/receta` usage message is multiline | Gemini | fixed |
| D17 | Bot | Voice section missing reverse_search | Codex | fixed |

## Pending from Punto 4 (Real API Testing)

_To be filled during exhaustive API testing._
