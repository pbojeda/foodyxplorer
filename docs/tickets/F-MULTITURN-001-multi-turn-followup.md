# F-MULTITURN-001: Multi-Turn Conversational Follow-Up Resolution

**Feature:** F-MULTITURN-001 | **Type:** Backend-Feature (NLP/Conversation) | **Priority:** High
**Status:** Planning | **Branch:** feature/F-MULTITURN-001-multi-turn-followup
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-05-06 | **Dependencies:** F037 (chainContext, done), F070 (ConversationCore, done), F085 (portion sizing, done)

---

## Spec

### Spec Review Round 1 — Findings Addressed

Cross-model review (Codex + Gemini) issued a REVISE verdict. The following table records each finding and its resolution. This section serves as a review trail and must not be removed.

| # | Reviewer | Finding | Resolution |
|---|----------|---------|------------|
| R1 | Codex CRITICAL | FALSE POSITIVE: claimed `reverse_search` was missing from `ConversationIntentSchema` enum. | Rejected. `reverse_search` is present in the enum (8 values listed). No spec change needed. |
| R2 | Codex IMPORTANT | Web `ResultsArea.tsx` and bot `naturalLanguage.ts`/`voice.ts` switches are exhaustive on `intent` — new intents break rendering/handling without adapter updates. | Scope expanded: adapter updates are now IN scope. New "Adapter Surface Changes" section added. "Out of Scope" updated. ACs added (AC-20 – AC-23). |
| R3 | Codex IMPORTANT | `applyRefinement()` returns only `string` — cannot carry portion-only modifications (e.g., "menos cantidad") which the pipeline handles via `portionMultiplier`, not query string. | Contract changed to `{ mergedQuery: string; portionMultiplierOverride?: number }`. Pseudocode Step 1.5 and AC-07 updated. |
| R4 | Codex IMPORTANT | `query_logs` policy for `follow_up_attribute` / `follow_up_refinement` undefined — new intents would be silently untracked. | New "Query Logging" subsection added. AC-19 added. |
| R5 | Codex IMPORTANT | Turn-state write rules contradictory across three spec locations. | Reconciled to single unified policy (P1/P2 + explicit negative cases). Storage rule, EC-8, Step 1.5 pseudocode, AC-11, AC-12 updated. |
| R6 | Gemini IMPORTANT | `followUpAttribute.nutrientKey` enum duplicates `EstimateNutrientsSchema` — DRY violation. | Spec updated to derive enum from `EstimateNutrientsSchema.shape` at runtime. AC-24 added. |
| R7 | Gemini SUGGESTION | `turnStateManager.ts` uses magic number 1800 in Redis call. | Named constant `TURN_STATE_TTL_SECONDS = 1800` required. Note added to Data Model Changes. |

### Spec Review Round 2 — Findings Addressed

R2 verdicts: **Gemini APPROVED** (1 IMPORTANT minor), **Codex REVISE** (2 IMPORTANT + 2 SUGGESTION). All addressed below.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| R2-1 | Codex + Gemini | IMPORTANT | `portionMultiplierOverride` listed in `api-spec.yaml` change instructions but absent from Zod schema → contract drift. | Removed from public response contract. The override is server-internal (input to estimation cascade only). The final multiplier is already exposed inside `estimation.portionMultiplier`. api-spec.yaml change list item #3 updated. |
| R2-2 | Codex | IMPORTANT | `followUpFromQuery` query-log field left as conditional ("if queryLogger.ts can be extended"). The `query_logs` Prisma model is rigid; conditional creates implementer ambiguity. | Decision recorded: `followUpFromQuery` is OUT OF SCOPE for F-MULTITURN-001 (no Prisma migration in this ticket). Trace captured only in structured logger event. Future ticket may add column. AC-19 + Query Logging section updated. |
| R2-3 | Codex | SUGGESTION | Observability contract inconsistent: AC-17 says "every classification" emits the structured event AND additionally emits the miss event — could be read as 2 events per miss. | AC-17 rewritten: HIT and MISS are **mutually exclusive** — exactly ONE event per classification (info on hit, debug on miss). |
| R2-4 | Codex | SUGGESTION | Query Logging section uses `levelHit` but `EstimateData` exposes `level1Hit..level4Hit` flags (route derives `l1|l2|l3|l4|null`). | Query Logging table renamed column to `levelLabel (derived)`. Explanation note added at top of section. |

### Spec Review Round 3 — Findings Addressed

R3 verdicts: **Gemini APPROVED** (text-only verification — no files read), **Codex REVISE** (3 IMPORTANT + 1 SUGGESTION, all empirical). All addressed.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| R3-1 | Codex | IMPORTANT | Turn-state nullability contract still contradictory: schema had `estimation: EstimateDataSchema.nullable()` but P2 said refinement misses still write state, and Step 1.5 dereferenced `prevTurn.estimation.result` after only checking `prevTurn.estimation != null`. EC-2 + EC-8 repeated the wrong assumption. | Schema simplified to `estimation: EstimateDataSchema` (always non-null wrapper). Single nullable field is `estimation.result` (already nullable in `EstimateDataSchema:284`). Step 1.5 condition updated to `prevTurn.estimation.result != null`. EC-2 + EC-8 rewritten to match. |
| R3-2 | Codex | IMPORTANT | Query Logging said `prevTurn.estimation.result.level{1,2,3,4}Hit` — but level flags live on `EstimateData` (lines 279-282 of `estimate.ts`), NOT on `EstimateResult`. | Path corrected to `prevTurn.estimation.level{1,2,3,4}Hit` in Query Logging table AND AC-19. Annotation added pointing to `estimate.ts:279-284`. |
| R3-3 | Codex | IMPORTANT | Spec scoped contract changes only to `POST /conversation/message`, but voice adapter work is in scope and `POST /conversation/audio` returns the same `ConversationMessageData` shape — affected too. | Affected endpoints note added under Description: both endpoints share the response schema; both must be updated in api-spec.yaml and both bot voice handlers (already in scope). |
| R3-4 | Codex | SUGGESTION | EC-10 said "16-field nutrient map" but spec elsewhere uses 15 nutrient keys (excluding `referenceBasis`). Wording drift. | EC-10 rewritten: "15 keys from `EstimateNutrientsSchema.shape`, excluding `referenceBasis`". |

**Note on Gemini R3 review quality:** Gemini's R3 was text-only (no files read). This is weaker validation than Codex's empirical R3. The R3 fixes were driven entirely by Codex findings against actual codebase paths — the schema correction (R3-1), level flag path (R3-2), and `/conversation/audio` scope (R3-3) all required reading the source files. Gemini's APPROVED reflects "no contradictions visible in spec text alone", which is consistent with the spec being internally clean even before R3 fixes.

### Spec Review Round 4 — Findings Addressed (BOTH APPROVED)

R4 verdicts: **Gemini APPROVED**, **Codex APPROVED (0 CRITICAL, 1 IMPORTANT — addressed inline)**. Spec is approved for planning.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| R4-1 | Codex | IMPORTANT | OpenAPI update instructions misnamed the component as `ConversationMessageData` — the actual YAML component is `ConversationMessageResponse` (`api-spec.yaml:6027`); the Zod schema is `ConversationMessageDataSchema` (different name). Plus residual wording in spec said "all changes are within the existing POST /conversation/message response shape" which conflicted with R3-3 fix (audio endpoint shares same shape). | API Changes section item #5 rewritten to use the correct OpenAPI component name and explicitly note that BOTH `/conversation/message` and `/conversation/audio` inherit additions via the shared component reference. AC-16 updated to match. Residual single-endpoint wording removed. |

**Step 0 SPEC verdict:** APPROVED by both Codex and Gemini after 4 review rounds. Total findings addressed: 16 across 4 rounds (1 false-positive rejected, 11 IMPORTANT, 4 SUGGESTION). Spec is ready for Step 1 (Setup) and Step 2 (Plan).

---

### Description

Today every message sent to `POST /conversation/message` is treated as a **standalone query**. The pipeline (`conversationCore.ts`) loads Redis chain context (conv:ctx) to know WHICH restaurant, but has no memory of WHAT the user just asked or received. As a result:

- "paella valenciana" → NutritionCard → "y los carbs?" → the system guesses what "eso" refers to.
- "hazlo de pollo en vez de cerdo" → the system does not know what "lo" was, returns a miss or wrong result.

This feature makes the conversational assistant handle **two follow-up patterns**:

1. **Attribute follow-up** — user asks for a specific nutrient from the PREVIOUS estimation result, without repeating the dish name ("y la proteína?", "cuánta fibra tiene?", "y la sal?"). The system must recognise this as a follow-up and return the requested nutrient from the already-computed `EstimateData`, avoiding a second estimation call.
2. **Refinement** — user modifies the previous query parameters and re-estimates ("hazlo de pollo en vez de cerdo", "menos cantidad", "sin azúcar", "una ración pequeña"). The system must reconstruct the full dish query by merging the modification onto the previous `lastTurn.query` and resubmitting to the estimation cascade.

**Pattern (3) Negation/correction** ("no, eso no" / "pequeña, no grande") is **deferred to F-MULTITURN-002**. Negation requires a distinct intent classifier (separate NLU branch) and its risk profile is higher — a false-positive negation detection that cancels a valid query breaks the assistant completely. Deferring keeps the blast radius of this ticket to two additive pipeline steps that can only produce a no-op fallback to standalone if the classifier misses.

**Why these two patterns share a ticket:** Both require loading `conv:turn:{actorId}` from Redis at the top of `processMessage()`, before any existing intent step fires. The same storage read is the critical path for both; merging them avoids a second Redis key design round-trip.

**Consumer surfaces:** `/hablar` web assistant (via `POST /conversation/message`) and the Telegram bot (same endpoint — the bot's NL handler already delegates to this endpoint).

**Affected endpoints (R3 fix — Codex IMPORTANT R3-3):** the new `ConversationMessageData` response shape with `follow_up_attribute` / `follow_up_refinement` intents and the `followUpAttribute` / `followUpRefinement` / `followUpMeta` fields applies to BOTH:
- `POST /conversation/message` — text input (web `/hablar` text mode + bot text)
- `POST /conversation/audio` — audio input (Whisper STT + ConversationCore; web `/hablar` voice mode + bot voice messages)

Both routes share the same `ConversationMessageData` response schema. The api-spec.yaml updates (item #5 in API Changes) must reference both endpoints, and adapter updates (Adapter Surface Changes section) cover both text and voice handler paths in the bot.

---

### Scoping Decision

| Pattern | This ticket (F-MULTITURN-001) | Deferred |
|---------|-------------------------------|----------|
| Attribute follow-up ("y los carbs?") | YES | — |
| Refinement ("hazlo de pollo") | YES | — |
| Negation/correction ("no, eso no") | NO | F-MULTITURN-002 |

Trade-off: broader scope = larger PR + more cross-model review rounds. The two included patterns share the same Redis read + classifier step; splitting them would duplicate that design. Negation is excluded because (a) it requires a separate intent path, (b) false positives are silently destructive (cancels a valid query), (c) it contributes negligible user-facing utility compared to (1) and (2).

**Reviewer challenge point:** If the team prefers a minimal-risk MVP, attribute follow-up alone could ship as F-MULTITURN-001 and refinement deferred to F-MULTITURN-002. The spec supports that split with no changes — refinement is isolated to the `follow_up_refinement` classifier branch and the `detectRefinementFollowUp()` function described below.

---

### Data Model Changes

**No new database tables or migrations required.**

#### New Redis key: `conv:turn:{actorId}`

A second Redis key is introduced alongside the existing `conv:ctx:{actorId}`:

| Key | Content | TTL |
|-----|---------|-----|
| `conv:ctx:{actorId}` | `{ chainSlug, chainName }` | 7200 s (2 h) — existing |
| `conv:turn:{actorId}` | `ConversationTurnState` — see below | 1800 s (30 min) — new |

The shorter TTL for turn state (30 min vs 2 h for chain context) is deliberate: follow-up relevance decays much faster than chain context. A user who returns after 30 minutes is almost certainly starting a new topic.

**`ConversationTurnState` shape (new Zod schema in `packages/shared/src/schemas/conversation.ts`):**

```typescript
// New addition to conversation.ts
export const ConversationTurnStateSchema = z.object({
  // The clean food query that was estimated (post-extraction, pre-multiplier text)
  query: z.string().min(1).max(255),
  // chainSlug that was effective for the estimation (null if generic)
  chainSlug: z.string().nullable(),
  // The full EstimateData result from the previous turn (null if estimation was a miss)
  // ALWAYS the full EstimateData wrapper. The nullability of "no successful match"
  // is carried by `estimation.result` (which is itself nullable in EstimateDataSchema:284).
  // This avoids a double-null state. (R3 fix — Codex IMPORTANT R3-1.)
  estimation: EstimateDataSchema,
  // portionMultiplier used in the previous turn
  portionMultiplier: z.number().min(0.1).max(5.0),
  // Unix timestamp (ms) when this turn was stored, for observability
  storedAt: z.number().int().positive(),
});

export type ConversationTurnState = z.infer<typeof ConversationTurnStateSchema>;
```

**Storage rule (authoritative — supersedes all other spec mentions):** `conv:turn:{actorId}` is written under these conditions:

- **(P1)** `intent === 'estimation'` AND `estimation.result !== null` — successful standalone estimation.
- **(P2)** `intent === 'follow_up_refinement'` — regardless of whether `estimation.result` is null or non-null. Rationale: after a refinement, the user's mental model has shifted to the refined dish; the next attribute follow-up must resolve against it (or fall back to "no result" gracefully). Writing null state on a miss is intentional.

**Turn state is NOT written for:** `menu_estimation`, `comparison`, `context_set`, `reverse_search`, `text_too_long`, `follow_up_attribute`.

**Storage location:** new module `packages/api/src/conversation/turnStateManager.ts` with the same fail-open pattern as `contextManager.ts`.

```typescript
// turnStateManager.ts — interface (not implementation)
export const TURN_STATE_TTL_SECONDS = 1800; // Named constant — no magic numbers in Redis calls. Match pattern of CONTEXT_TTL_SECONDS in contextManager.ts.
export async function getTurnState(actorId: string, redis: Redis): Promise<ConversationTurnState | null>
export async function setTurnState(actorId: string, state: ConversationTurnState, redis: Redis): Promise<void>
```

**Existing `ConversationContext` schema is unchanged.** No modifications to `conv:ctx:{actorId}` or `contextManager.ts`.

---

### API Changes

#### `POST /conversation/message` — request body (unchanged)

No changes to `ConversationMessageBodySchema`. The feature is entirely server-side.

#### `POST /conversation/message` — response: new intent discriminants

Two new values are added to `ConversationIntentSchema` in `packages/shared/src/schemas/conversation.ts`:

| New intent | When returned |
|------------|---------------|
| `follow_up_attribute` | Input was classified as an attribute follow-up; requested nutrient extracted from previous `EstimateData` |
| `follow_up_refinement` | Input was classified as a refinement; previous query was modified and re-estimated |

Both new intents are additive — all existing intents are unchanged.

**Updated `ConversationIntentSchema`:**

```typescript
export const ConversationIntentSchema = z.enum([
  'context_set',
  'comparison',
  'menu_estimation',
  'estimation',
  'reverse_search',
  'text_too_long',
  'follow_up_attribute',   // NEW — F-MULTITURN-001
  'follow_up_refinement',  // NEW — F-MULTITURN-001
]);
```

#### `POST /conversation/message` — response: new optional fields on `ConversationMessageDataSchema`

```typescript
// Addition to ConversationMessageDataSchema

// Present when intent = 'follow_up_attribute'
//
// SINGLE SOURCE OF TRUTH for nutrientKey: derive from EstimateNutrientsSchema.shape.
// Do NOT hardcode the enum — EstimateNutrientsSchema in packages/shared/src/schemas/estimate.ts
// is the canonical list. The implementation must derive the enum as follows:
//
//   import { EstimateNutrientsSchema } from './estimate';
//   // Exclude 'referenceBasis' (metadata field, not a nutrient key)
//   const NUTRIENT_KEYS = Object.keys(EstimateNutrientsSchema.shape).filter(
//     k => k !== 'referenceBasis'
//   ) as [string, ...string[]];
//   const NutrientKeySchema = z.enum(NUTRIENT_KEYS as [string, ...string[]]);
//
// The exact Zod incantation is for the planner to refine; the spec requirement is
// "derive from EstimateNutrientsSchema, do not duplicate" (R6 DRY fix).
followUpAttribute: z.object({
  // The nutrient that was requested — derived from EstimateNutrientsSchema.shape keys
  // (excluding 'referenceBasis'). Currently: calories, proteins, carbohydrates, sugars,
  // fats, saturatedFats, fiber, salt, sodium, transFats, cholesterol, potassium,
  // monounsaturatedFats, polyunsaturatedFats, alcohol.
  nutrientKey: NutrientKeySchema, // derived — see comment above
  // Friendly display name for the nutrient in Spanish
  nutrientLabel: z.string(),
  // The numeric value from the prior EstimateData (from estimation.result.nutrients)
  value: z.number().nonnegative(),
  // Unit: 'kcal' | 'g' | 'mg'
  unit: z.enum(['kcal', 'g', 'mg']),
  // The dish name this was pulled from (from estimation.result.nameEs ?? estimation.result.name)
  dishName: z.string(),
  // The full prior EstimateData for rendering the full NutritionCard if the client wants
  priorEstimation: EstimateDataSchema,
}).optional(),

// Present when intent = 'follow_up_refinement'
followUpRefinement: z.object({
  // The original query from the previous turn
  originalQuery: z.string(),
  // The merged query submitted to the estimation cascade
  mergedQuery: z.string(),
  // The full EstimateData from the re-estimation
  estimation: EstimateDataSchema,
}).optional(),

// Present on any follow_up_* intent — metadata for observability
followUpMeta: z.object({
  // Which classifier fired: 'attribute' | 'refinement'
  classifierType: z.enum(['attribute', 'refinement']),
  // Confidence score from the classifier (0.0–1.0)
  confidence: z.number().min(0).max(1),
  // Whether turn state was loaded from Redis (false if cache miss caused fallback)
  turnStateHit: z.boolean(),
}).optional(),
```

#### `api-spec.yaml` — changes (to be applied in Step 3)

The following additions will be made to the API spec YAML at Step 3 implementation:

1. Add `follow_up_attribute` and `follow_up_refinement` to the `ConversationIntent` enum.
2. Add `FollowUpAttributeData` component schema with the fields above. The `nutrientKey` field in the YAML enum must list all 15 nutrient keys from `EstimateNutrientsSchema` (excluding `referenceBasis`). Keep the YAML enum in sync with the shared schema — the planner must note this as a maintenance point.
3. Add `FollowUpRefinementData` component schema. Match the Zod schema exactly: fields are `originalQuery`, `mergedQuery`, `estimation`. **`portionMultiplierOverride` is INTERNAL** to the server-side merge step (input to the estimation cascade) and MUST NOT appear in the public response contract — the final multiplier is already exposed inside `estimation.portionMultiplier`. (R2 fix — Codex/Gemini IMPORTANT.)
4. Add `FollowUpMeta` component schema.
5. Reference these in the existing OpenAPI component `ConversationMessageResponse` (the actual YAML component name at `docs/specs/api-spec.yaml:6027` — distinct from the Zod schema name `ConversationMessageDataSchema`) as optional fields. Both `POST /conversation/message` (text) and `POST /conversation/audio` (voice; same envelope per `routes/conversation.ts:277`) reference this component, so both endpoints inherit the new optional fields without duplicating the schema. (R4 fix — Codex IMPORTANT.)

**No new endpoints.** This feature adds zero HTTP endpoints. The response-shape additions apply to BOTH existing endpoints (`POST /conversation/message` and `POST /conversation/audio`) via the shared `ConversationMessageResponse` OpenAPI component.

**Error codes:** No new error codes. Follow-up classification failures produce graceful fallback to standalone intent (`estimation`), not HTTP errors.

---

### Conversation Pipeline Changes

#### New pipeline step — Step 1.5: Follow-Up Classification

A new step is inserted into `conversationCore.ts::processMessage()` between the existing Step 1 (length guard) and Step 2 (context-set detection). This position is chosen because:
- It fires AFTER the trivial length rejection (no point classifying a 5000-char wall of text).
- It fires BEFORE context-set detection so "estoy en mcdonalds" is never misclassified as a follow-up.

**Step 1.5 logic — pseudocode (NOT implementation):**

```
Step 1.5 — Follow-up classification (new)

1. Load conv:turn:{actorId} from Redis → prevTurn (fail-open: null on miss or error)
2. If prevTurn is null → skip follow-up paths, continue to Step 2 (standalone)
3. Run detectAttributeFollowUp(trimmed) → { nutrientKey, confidence } | null
   - If result.confidence >= ATTRIBUTE_CONFIDENCE_THRESHOLD (0.75) AND prevTurn.estimation.result != null:
     a. Extract nutrient value from prevTurn.estimation.result.nutrients[nutrientKey]
     b. Compute unit + label from NUTRIENT_META map
     c. Return intent: 'follow_up_attribute'
     d. DO NOT write conv:turn:{actorId} (turn state unchanged — see Storage rule P1/P2)
4. Run detectRefinementFollowUp(trimmed) → { modificationText, confidence } | null
   - If result.confidence >= REFINEMENT_CONFIDENCE_THRESHOLD (0.70):
     a. Merge: { mergedQuery, portionMultiplierOverride } = applyRefinement(prevTurn.query, modificationText)
        - applyRefinement() returns { mergedQuery: string; portionMultiplierOverride?: number }
        - If portionMultiplierOverride is present, pass it to the estimation cascade instead
          of re-running extractPortionModifier on the merged query
     b. Run full estimation cascade on mergedQuery (+ portionMultiplierOverride if present)
     c. Write new turn state to conv:turn:{actorId} with result of re-estimation
        (Storage rule P2: always write for follow_up_refinement, even if result is null)
     d. Return intent: 'follow_up_refinement'
5. If neither classifier fires → continue to Step 2 (standalone, no follow-up)
```

**`detectAttributeFollowUp(text: string)` — specification:**

- Input: raw user message (already trimmed, already passed length guard).
- Output: `{ nutrientKey: NutrientKey; confidence: number } | null`
- Must detect Spanish attribute follow-up patterns with high precision. Minimum pattern set:
  - `"y (los|la|las|el)? <nutrient>"` → map to nutrient key
  - `"cuánto/a (tiene|hay)? (de )? <nutrient>"` → map to nutrient key
  - `"(dime|dame) (los|la)? <nutrient>"` → map to nutrient key
  - `"(y )? <nutrient>?"` (bare nutrient name with optional question mark)
  - Nutrient term aliases (see NUTRIENT_ALIASES map below)
- Confidence: 1.0 for unambiguous exact pattern match; lower for fuzzy matches. Any result below 0.75 is treated as a miss (fall-through to standalone).
- This function is **pure and synchronous** — no async, no Redis, no DB. Testable in isolation.

**NUTRIENT_ALIASES (canonical → display label → unit):**

| Query aliases | `nutrientKey` | Display label (ES) | Unit |
|--------------|---------------|---------------------|------|
| calorías, kcal, cal, energía | `calories` | Calorías | kcal |
| proteínas, proteína, prot | `proteins` | Proteínas | g |
| carbohidratos, carbs, hidratos, hc | `carbohydrates` | Carbohidratos | g |
| azúcar, azúcares | `sugars` | Azúcares | g |
| grasas, grasa, fat | `fats` | Grasas | g |
| grasas saturadas, sat | `saturatedFats` | Grasas saturadas | g |
| fibra | `fiber` | Fibra | g |
| sal | `salt` | Sal | g |
| sodio | `sodium` | Sodio | mg |
| grasas trans | `transFats` | Grasas trans | g |
| colesterol | `cholesterol` | Colesterol | mg |
| potasio | `potassium` | Potasio | mg |

**`detectRefinementFollowUp(text: string)` — specification:**

- Input: raw user message (trimmed, past length guard).
- Output: `{ modificationText: string; confidence: number } | null`
- Must detect Spanish refinement/modification patterns. Minimum pattern set:
  - `"(hazlo|ponlo|cambia(lo)?|pero) de <protein_swap>"` — e.g., "hazlo de pollo en vez de cerdo"
  - `"(menos|más) cantidad"` — portion down/up
  - `"sin <ingredient>"` — "sin azúcar", "sin sal"
  - `"una ración (pequeña|grande|media|enorme|extra)"` — explicit portion size
  - `"(más|menos) (pequeño/a|grande)"` — relative size
- Confidence: 1.0 for unambiguous match; lower for fuzzy. Threshold 0.70.
- This function is also **pure and synchronous**.

**`applyRefinement(originalQuery: string, modificationText: string) → { mergedQuery: string; portionMultiplierOverride?: number }`:**

- Merges the modification onto the original query string.
- Returns `{ mergedQuery, portionMultiplierOverride? }`. If the modification is portion-only (e.g., "menos cantidad", "una ración pequeña"), `mergedQuery` is the original query unchanged and `portionMultiplierOverride` carries the numeric multiplier. The estimation cascade is invoked with the explicit override if present; otherwise `extractPortionModifier` runs on `mergedQuery` as usual.
- Strategy: pattern detection + string replacement / append. Examples:
  - `("paella valenciana", "de pollo en vez de cerdo")` → `{ mergedQuery: "paella valenciana de pollo" }`
  - `("paella valenciana", "menos cantidad")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.5 }`
  - `("paella valenciana", "una ración pequeña")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.7 }`
  - `("paella valenciana", "sin azúcar")` → `{ mergedQuery: "paella valenciana sin azúcar" }`
- The `mergedQuery` is a canonical query string the existing pipeline can parse (runs through `parseDishExpression` before passing to `estimate()`). The `portionMultiplierOverride` is passed directly to `estimate()` — it bypasses `extractPortionModifier` to avoid double-parsing.
- Pure and synchronous.

#### Turn state write-back

The authoritative write policy is defined in the Storage rule (Data Model Changes). In summary:

- `intent: 'estimation'` with non-null result → write turn state (P1).
- `intent: 'follow_up_refinement'` → always write turn state, even if `estimation.result` is null (P2). The fire-and-forget pattern applies (errors swallowed, same as `setContext()`).
- `intent: 'follow_up_attribute'` → do NOT write turn state. The prior turn state remains valid so subsequent attribute follow-ups still resolve against the same dish.
- All other intents (`menu_estimation`, `comparison`, `context_set`, `reverse_search`, `text_too_long`) → do NOT write turn state.

---

### Observability

A new structured log event is emitted on any follow-up classification:

```
logger.info({
  tag: 'F-MULTITURN-001',
  classifierType: 'attribute' | 'refinement',
  confidence: number,
  turnStateHit: boolean,
  nutrientKey?: string,   // attribute only
  originalQuery?: string, // refinement only
  mergedQuery?: string,   // refinement only
}, 'follow-up classified');
```

A miss (classifier ran but fell through to standalone) emits at `debug` level:
```
logger.debug({ tag: 'F-MULTITURN-001:miss', reason: 'no_turn_state' | 'low_confidence' | 'no_match' }, 'follow-up classification miss');
```

---

### Query Logging

`queryLogger.ts` routes logging by intent branch. The two new intents must be explicitly handled to avoid silent gaps in `query_logs`. Policy:

**Note on level field naming (R2 fix — Codex SUGGESTION):** the `EstimateData` shape exposes the per-level boolean flags `level1Hit`, `level2Hit`, `level3Hit`, `level4Hit`. The route derives a single string label (`l1|l2|l3|l4|null`) from these flags before logging. The `levelLabel` column in the table below refers to that derived string label, not a non-existent `levelHit` field on `EstimateData`.

| Intent | `queryText` | `cacheHit` | `levelLabel` (derived) | `responseMs` | Notes |
|--------|-------------|------------|------------------------|--------------|-------|
| `follow_up_attribute` | `prevTurn.query` (the resolved dish name from prior turn) | `true` (no cascade call issued) | carry-over: re-derive `l1|l2|l3|l4|null` from `prevTurn.estimation.level{1,2,3,4}Hit` flags (R3 fix — flags live on `EstimateData`, not on `EstimateResult`) | small (no estimation work) | No cascade, so no new level hit — carry prior. |
| `follow_up_refinement` | `mergedQuery` (the post-refinement query submitted to cascade) | `false` | derive `l1|l2|l3|l4|null` from cascade response `EstimateData.level{1,2,3,4}Hit` flags (same logic as standalone `estimation`) | actual wall-clock time | Full cascade call — log as normal estimation. |

**`followUpFromQuery` field (decision — R2 fix Codex IMPORTANT):** the `query_logs` table has a rigid fixed shape (Prisma model `QueryLog` at `packages/api/prisma/schema.prisma:479`). Adding a new `followUpFromQuery` column requires a Prisma migration, which is **OUT OF SCOPE** for F-MULTITURN-001. The follow-up trace is therefore captured only in the structured logger event (see Observability section), not in `query_logs`. A future ticket (F-MULTITURN-FU1 or part of F-MULTITURN-002) may add the column if analytics demands it.

---

### Adapter Surface Changes

Codex finding R2 confirmed that `ResultsArea.tsx`, `naturalLanguage.ts`, and `voice.ts` use exhaustive switches on `intent` — the new intents will cause TypeScript compile errors or runtime throws without adapter updates. These adapters are now **in scope for this ticket**.

| File | Change required |
|------|----------------|
| `packages/web/src/components/ResultsArea.tsx` | Add `case 'follow_up_attribute':` — render highlighted nutrient value + full NutritionCard (use `followUpAttribute.priorEstimation` for card, highlight `followUpAttribute.nutrientKey` row). Add `case 'follow_up_refinement':` — render like `estimation` using `followUpRefinement.estimation` as the `EstimateData`. |
| `packages/bot/src/handlers/naturalLanguage.ts` | Add `case 'follow_up_attribute':` — format as Telegram MarkdownV2 text: dish name + nutrient label + value + unit (e.g., "Paella valenciana — Carbohidratos: 45 g"). Add `case 'follow_up_refinement':` — delegate to existing `formatEstimate(data.followUpRefinement.estimation)` with a prefix line "_(refinado: {mergedQuery})_". |
| `packages/bot/src/handlers/voice.ts` | Same cases as `naturalLanguage.ts`. Voice TTS prompt must be natural Spanish — avoid MarkdownV2 escaping in the TTS string (the bot sends to Telegram, not TTS, so MarkdownV2 formatting applies as in NL handler). |
| `packages/web/src/__tests__/fixtures.ts` | Add intent-specific fixtures for `follow_up_attribute` and `follow_up_refinement` response shapes. |

**PR size estimate:** ~100–200 LoC of frontend + bot adapter code + fixture tests. This is the cost of keeping intent-based analytics clean (rejected Option B of hiding new intents under `intent: 'estimation'` with metadata).

---

### Edge Cases & Error Handling

| # | Scenario | Behaviour |
|---|----------|-----------|
| EC-1 | Follow-up with no prior turn (new chat, no conv:turn key) | `prevTurn` is null → skip Step 1.5 entirely → standalone estimation. No error, no special response field. |
| EC-2 | Follow-up where prior turn has `estimation.result === null` (e.g., a refinement miss recorded under P2) | `detectAttributeFollowUp` fires but `prevTurn.estimation.result` is null → cannot extract nutrient value → fall through to standalone. DO NOT return follow_up_attribute with undefined data. (Note: under the fixed schema, `prevTurn.estimation` itself is always non-null when a turn record exists; only `.result` may be null.) |
| EC-3 | Ambiguous follow-up ("y eso?", "cuánto?") with no nutrient term | Neither classifier fires → standalone estimation → likely a miss or irrelevant result. Future F-MULTITURN-002 may handle this with clarification; for now, fall through silently. |
| EC-4 | Redis TTL expiry (30 min elapsed) | `getTurnState()` returns null → EC-1 path. User must re-query the dish. No error surfaced. |
| EC-5 | Combined attribute + refinement ("y los carbs si lo hago de pollo?") | `detectAttributeFollowUp` fires first (confidence check). If it matches on "carbs" AND the text also contains a refinement signal, the attribute classifier takes priority (lower risk, simpler path). The combined pattern is out of scope for F-MULTITURN-001; the attribute result is returned without applying the protein swap. This is documented as a known limitation; F-MULTITURN-003 may handle combined patterns. |
| EC-6 | Redis error on `getTurnState()` | Fail-open: null returned → standalone path. Same pattern as `getContext()`. |
| EC-7 | Redis error on `setTurnState()` | Fail-open: error swallowed. Turn state not written; next message cannot use follow-up features, but current response is unaffected. |
| EC-8 | Refinement `applyRefinement()` produces a query that returns a null estimation | Return `intent: 'follow_up_refinement'` with `followUpRefinement.estimation.result === null` (the wrapper EstimateData is still emitted with its level flags + null result — same shape as a standalone estimation miss). The client renders "No encontré información sobre eso". Turn state IS written (Storage rule P2: refinements always update turn state regardless of result). This means the next attribute follow-up will see `prevTurn.estimation.result === null` and fall through to standalone (EC-2). |
| EC-9 | Follow-up received when prevTurn references a menu_estimation | `conv:turn` is never written for menu_estimation, so prevTurn is either null (never written) or contains the last single-dish. EC-1 or normal follow-up applies. |
| EC-10 | Attribute follow-up for a nutrient NOT in the derived nutrient enum (15 keys from `EstimateNutrientsSchema.shape`, excluding `referenceBasis`) | `detectAttributeFollowUp` returns null → standalone path. No follow_up_attribute returned. |
| EC-11 | Regression: existing standalone `estimation` intent | Step 1.5 exits silently if neither classifier fires. Existing Step 2–4 pipeline is fully preserved. Zero regression risk for standalone queries. |

---

### Out of Scope for F-MULTITURN-001

- Negation/correction ("no, eso no", "pequeña, no grande") → F-MULTITURN-002.
- Combined attribute + refinement in one turn ("y los carbs si lo hago de pollo?") → F-MULTITURN-003.
- Multi-turn memory beyond a single previous turn (e.g., "y lo de antes" referring to two turns back) → future.
- Persisting conversation history to PostgreSQL — Redis turn state is ephemeral by design for this MVP.

**Previously out of scope — now IN scope (Codex finding R2):** Web `ResultsArea.tsx` rendering for the two new intents, and Telegram bot `naturalLanguage.ts` + `voice.ts` formatting for the two new intents. These adapter updates are required to prevent exhaustive-switch compile errors and are included in this ticket. See "Adapter Surface Changes" section.

---

## Implementation Plan

_Pending — to be generated by the planner agent in Step 2._

---

## Acceptance Criteria

### Classifier — standalone vs follow-up

- [ ] **AC-01** `detectAttributeFollowUp()` correctly classifies Spanish attribute follow-up phrases: "y los carbs?", "y la proteína?", "cuánta fibra tiene?", "y la sal?", "dame las grasas". Returns `null` for standalone queries ("paella valenciana", "big mac", "estoy en mcdonalds").
- [ ] **AC-02** `detectRefinementFollowUp()` correctly classifies Spanish refinement phrases: "hazlo de pollo en vez de cerdo", "menos cantidad", "sin azúcar", "una ración pequeña". Returns `null` for standalone queries and for attribute follow-ups ("y los carbs?").
- [ ] **AC-03** Both classifier functions are pure and synchronous — they accept a string and return a result with no I/O, no async, no side effects. Verified by unit tests that run without a Redis or DB connection.

### Attribute follow-up — happy path

- [ ] **AC-04** When `conv:turn:{actorId}` holds a valid prior estimation for "paella valenciana" and the user sends "y los carbs?", the response has `intent: 'follow_up_attribute'`, `followUpAttribute.nutrientKey === 'carbohydrates'`, and `followUpAttribute.value` matches the carbohydrate value from the prior `EstimateData`. No estimation cascade call is made.
- [ ] **AC-05** `followUpAttribute.dishName` is populated from `priorEstimation.result.nameEs ?? priorEstimation.result.name`. `followUpAttribute.unit` is `'g'` for carbohydrates, `'kcal'` for calories, `'mg'` for sodium/cholesterol/potassium.
- [ ] **AC-06** `followUpAttribute.priorEstimation` contains the full prior `EstimateData` so the client can render a complete NutritionCard if desired.

### Refinement — happy path

- [ ] **AC-07** When `conv:turn:{actorId}` holds a prior estimation for "paella valenciana" (chainSlug: null) and the user sends "hazlo de pollo en vez de cerdo", the response has `intent: 'follow_up_refinement'`, `followUpRefinement.originalQuery === 'paella valenciana'`, `followUpRefinement.mergedQuery` contains a query string incorporating the protein swap, and `followUpRefinement.estimation` is a valid `EstimateData` from the estimation cascade. For portion-only modifications (e.g., "menos cantidad"), `applyRefinement()` returns `{ mergedQuery: originalQuery, portionMultiplierOverride: 0.5 }` and the cascade is invoked with the explicit override (verified by unit test asserting `estimate()` was called with `portionMultiplier: 0.5`).
- [ ] **AC-08** After a successful refinement, `conv:turn:{actorId}` is updated to reflect the new query and estimation result. A subsequent "y los carbs?" resolves against the refined dish, not the original.

### No-context graceful fallback (EC-1, EC-4)

- [ ] **AC-09** When `conv:turn:{actorId}` does not exist in Redis (new chat, expiry, or Redis miss), attribute and refinement follow-up phrases are treated as standalone estimation queries. The response has `intent: 'estimation'` (or other appropriate intent). No error is returned to the caller.
- [ ] **AC-10** When the prior turn had `estimation.result === null` (estimation miss), a subsequent attribute follow-up returns `intent: 'estimation'` (standalone fallback), not `intent: 'follow_up_attribute'` with undefined data.

### Turn state write-back

- [ ] **AC-11** `conv:turn:{actorId}` is written to Redis with TTL `TURN_STATE_TTL_SECONDS` (1800 s, exported named constant) in exactly two cases: (a) `intent: 'estimation'` with non-null `estimation.result` (P1); (b) `intent: 'follow_up_refinement'` regardless of whether `estimation.result` is null (P2). Verified by unit tests that mock Redis and assert `setex`/`set` call for each case, including the null-result P2 case (EC-8).
- [ ] **AC-12** `conv:turn:{actorId}` is NOT written for `intent: 'menu_estimation'`, `'comparison'`, `'context_set'`, `'reverse_search'`, `'text_too_long'`, or `'follow_up_attribute'`. Verified by unit tests asserting no `set`/`setex` call on Redis mock for each of these intents.

### No regressions on existing standalone flows

- [ ] **AC-13** All existing unit tests for `processMessage()` (standalone estimation, comparison, menu_estimation, context_set, reverse_search, text_too_long) pass without modification. The new Step 1.5 is a pure fast-path guard that exits immediately when `prevTurn` is null — existing test fixtures that do not seed `conv:turn` produce null and fall through unchanged.

### Spanish language coverage

- [ ] **AC-14** NUTRIENT_ALIASES map covers at minimum: calorías/kcal/cal/energía → calories; proteínas/proteína/prot → proteins; carbohidratos/carbs/hidratos/hc → carbohydrates; azúcar/azúcares → sugars; grasas/grasa → fats; fibra → fiber; sal → salt; sodio → sodium. Verified by unit tests against each alias group.

### Schemas and specs

- [ ] **AC-15** `ConversationTurnStateSchema` is added to `packages/shared/src/schemas/conversation.ts`. `ConversationIntentSchema` is updated to include `'follow_up_attribute'` and `'follow_up_refinement'`. `ConversationMessageDataSchema` is updated with the three new optional fields (`followUpAttribute`, `followUpRefinement`, `followUpMeta`). `followUpAttribute.nutrientKey` is derived from `EstimateNutrientsSchema.shape` (excluding `referenceBasis`) — no hardcoded enum. All Zod schemas parse correctly and TypeScript strict-mode build succeeds.
- [ ] **AC-16** `docs/specs/api-spec.yaml` is updated: `ConversationIntent` enum includes the two new values; `FollowUpAttributeData`, `FollowUpRefinementData`, and `FollowUpMeta` component schemas are added and referenced from the existing `ConversationMessageResponse` component (NOT a separate `ConversationMessageData` component — the YAML name differs from the Zod schema name). Both `POST /conversation/message` and `POST /conversation/audio` inherit the additions automatically via the shared component reference.

### Observability

- [ ] **AC-17** Each follow-up classification emits **exactly one** structured log event (R2 fix — Codex SUGGESTION resolved to single-event model): on a HIT, an `info`-level event with `tag: 'F-MULTITURN-001'`, `classifierType`, `confidence`, `turnStateHit`, plus optional `nutrientKey` (attribute) or `originalQuery`+`mergedQuery` (refinement). On a MISS, a `debug`-level event with `tag: 'F-MULTITURN-001:miss'` and `reason` (`'no_turn_state'` | `'low_confidence'` | `'no_match'`). HIT and MISS are mutually exclusive — never both fire for the same classification call.

### Build and quality gates

- [ ] **AC-18** All unit tests pass (`vitest run`). Build succeeds with zero TypeScript errors (`tsc --noEmit`). No new ESLint warnings or errors.

### Query logging

- [ ] **AC-19** `queryLogger.ts` captures both new intents per the defined policy: `follow_up_attribute` logs with `intent: 'follow_up_attribute'`, `queryText: prevTurn.query`, `cacheHit: true`, derived `levelLabel` re-computed from `prevTurn.estimation.level{1,2,3,4}Hit` flags (R3 fix — flags live on `EstimateData`); `follow_up_refinement` logs with `intent: 'follow_up_refinement'`, `queryText: mergedQuery`, `cacheHit: false`, derived `levelLabel` from cascade response `EstimateData.level{1,2,3,4}Hit` flags. NO new column added to `query_logs` table (rigid Prisma shape; `followUpFromQuery` deferred per Query Logging section). Verified by unit test on `queryLogger.ts`.

### Web adapter rendering

- [ ] **AC-20** `packages/web/src/components/ResultsArea.tsx` renders `intent: 'follow_up_attribute'` by displaying the requested nutrient value (label + value + unit) highlighted, with the full prior NutritionCard available via `followUpAttribute.priorEstimation`. The component does not render `<EmptyState>` for this intent.
- [ ] **AC-21** `packages/web/src/components/ResultsArea.tsx` renders `intent: 'follow_up_refinement'` by passing `followUpRefinement.estimation` to `<NutritionCard>` — equivalent to the `estimation` case. TypeScript strict build must pass (no unhandled branches in the switch).

### Bot adapter formatting

- [ ] **AC-22** `packages/bot/src/handlers/naturalLanguage.ts` handles `intent: 'follow_up_attribute'` by returning a Telegram MarkdownV2 string containing the dish name, nutrient label, value, and unit (e.g., "Paella valenciana — Carbohidratos: 45 g"). Handles `intent: 'follow_up_refinement'` by delegating to `formatEstimate(data.followUpRefinement.estimation)` with a prefixed refinement note. No `_exhaustive: never` throw for either intent.
- [ ] **AC-23** `packages/bot/src/handlers/voice.ts` handles both new intents with the same logic as AC-22 (`naturalLanguage.ts`). The switch exhaustiveness check in `voice.ts` also passes — both intents are handled.

### Nutrient key DRY

- [ ] **AC-24** `followUpAttribute.nutrientKey` schema in `conversation.ts` is derived from `EstimateNutrientsSchema.shape` at schema definition time (excluding `referenceBasis`). No hardcoded array of nutrient key strings appears in `conversation.ts`. Verified by code review: if a new nutrient is added to `EstimateNutrientsSchema`, `followUpAttribute.nutrientKey` automatically accepts it without any change to `conversation.ts`.

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] E2E tests updated (if applicable)
- [ ] Code follows project standards
- [ ] No linting errors
- [ ] Build succeeds
- [ ] Specs reflect final implementation

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated. /review-spec 4 rounds (Codex + Gemini); both APPROVED at R4.
- [x] Step 1: Branch created (`feature/F-MULTITURN-001-multi-turn-followup`), ticket generated, tracker updated.
- [ ] Step 2: `backend-planner` executed, plan approved
- [ ] Step 3: `backend-developer` executed with TDD
- [ ] Step 4: `production-code-validator` executed, quality gates pass
- [ ] Step 5: `code-review-specialist` executed
- [ ] Step 5: `qa-engineer` executed (Standard)
- [ ] Step 6: Ticket updated with final metrics, branch deleted

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-05-06 | Branch created from develop @ `c4c3a32` | feature/F-MULTITURN-001-multi-turn-followup |
| 2026-05-06 | Step 0 Spec drafted | spec-creator agent — initial 18 ACs |
| 2026-05-06 | Step 0 /review-spec R1 | Gemini REVISE (1 IMP + 1 SUG); Codex REVISE (1 CRIT false-positive + 4 IMP). 5 real findings addressed |
| 2026-05-06 | Step 0 /review-spec R2 | Gemini APPROVED (1 IMP); Codex REVISE (2 IMP + 2 SUG). 4 findings addressed |
| 2026-05-06 | Step 0 /review-spec R3 | Gemini APPROVED (text-only); Codex REVISE (3 IMP + 1 SUG, all empirical against real code paths). 4 findings addressed |
| 2026-05-06 | Step 0 /review-spec R4 | Gemini APPROVED; Codex APPROVED (1 IMP — OpenAPI component name mismatch, fixed inline) |
| 2026-05-06 | Step 0 closed | Both APPROVED. 24 ACs total. Spec ready for planning. |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [ ] | Sections verified: (list) |
| 1. Mark all items | [ ] | AC: _/_, DoD: _/_, Workflow: _/_ |
| 2. Verify product tracker | [ ] | Active Session: step _/6, Features table: _/6 |
| 3. Update key_facts.md | [ ] | Updated: (list) / N/A |
| 4. Update decisions.md | [ ] | ADR-XXX added / N/A |
| 5. Commit documentation | [ ] | Commit: (hash) |
| 6. Verify clean working tree | [ ] | `git status`: clean |
| 7. Verify branch up to date | [ ] | merge-base: up to date / merged origin/<branch> |

---

*Ticket created: 2026-05-06*
