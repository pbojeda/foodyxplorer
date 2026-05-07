# F-MULTITURN-001: Multi-Turn Conversational Follow-Up Resolution

**Feature:** F-MULTITURN-001 | **Type:** Backend-Feature (NLP/Conversation) | **Priority:** High
**Status:** Done | **Branch:** feature/F-MULTITURN-001-multi-turn-followup (squash-merged at `45aabea`, branch deleted local + remote)
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
  // The exact `prevTurn.query` value that was used to resolve this follow-up.
  // (Plan-R4 fix — Codex IMP#1: avoid relying on the invariant `prevTurn.query === prevTurn.estimation.query`.
  // For P2 refinement-written turn states, parseDishExpression() can normalize/strip text before estimate(),
  // breaking the invariant. By exposing priorTurnQuery directly, query logging in Step 5 has an
  // unambiguous source of truth.)
  priorTurnQuery: z.string().min(1).max(255),
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
- Strategy: pattern detection + string REPLACE-or-APPEND branch (**Plan-R1 fix — Codex IMP#1**: append alone is mechanically wrong for swap refinements when `<old>` is present in originalQuery). Decision tree:
  1. If modificationText matches `"de <new> en vez de <old>"`:
     - If `<old>` is present in `originalQuery` → REPLACE: substitute `<old>` token(s) with `<new>`. Return `{ mergedQuery: substitutedQuery }`.
     - Else → APPEND-AFTER-STRIP: strip `"en vez de <old>"` from modificationText, append the rest to originalQuery. Return `{ mergedQuery: originalQuery + ' ' + strippedMod }`.
  2. If modificationText matches portion-only patterns (`"menos cantidad"`, `"una ración pequeña"`, etc.) → return `{ mergedQuery: originalQuery, portionMultiplierOverride: <numeric> }`.
  3. If modificationText matches `"sin <ingredient>"` → APPEND: `{ mergedQuery: originalQuery + ' sin <ingredient>' }`.
  4. Otherwise → APPEND: `{ mergedQuery: originalQuery + ' ' + modificationText }`.
- Examples:
  - `("paella valenciana", "de pollo en vez de cerdo")` → `{ mergedQuery: "paella valenciana de pollo" }` (Branch 1, append-after-strip — "cerdo" not in originalQuery).
  - `("lomo de cerdo", "de pollo en vez de cerdo")` → `{ mergedQuery: "lomo de pollo" }` (Branch 1, REPLACE — "cerdo" present in originalQuery, substituted with "pollo").
  - `("solomillo", "de pollo")` → `{ mergedQuery: "solomillo de pollo" }` (Branch 4, plain append).
  - `("paella valenciana", "menos cantidad")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.5 }` (Branch 2).
  - `("paella valenciana", "una ración pequeña")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.7 }` (Branch 2).
  - `("paella valenciana", "sin azúcar")` → `{ mergedQuery: "paella valenciana sin azúcar" }` (Branch 3).
- The `mergedQuery` is a canonical query string the existing pipeline can parse (runs through `parseDishExpression` before passing to `estimate()`). The `portionMultiplierOverride` is passed directly to `estimate()` — it bypasses `extractPortionModifier` to avoid double-parsing.
- Pure and synchronous.

#### Turn state write-back

The authoritative write policy is defined in the Storage rule (Data Model Changes). In summary:

- `intent: 'estimation'` with non-null result → write turn state (P1).
- `intent: 'follow_up_refinement'` → always write turn state, even if `estimation.result` is null (P2). Non-blocking pattern: `void setTurnState(...).catch(() => {})`. (Plan-R1 clarification — Codex IMP#2: setContext call sites currently `await` the call but `setContext` swallows errors internally; we adopt a stricter non-blocking pattern for `setTurnState` to keep the response fast-path entirely off Redis. Both functions are fail-open by implementation; the `void`+`catch` is purely about not waiting for the round-trip.)
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
| `follow_up_attribute` | `followUpAttribute.priorTurnQuery` (Plan-R6 fix — Gemini IMP: spec field name was `prevTurn.query` but the implementation reads from the response payload `followUpAttribute.priorTurnQuery` — added in P4-1 to avoid the broken `estimation.query` invariant; both values are equal by construction but the field name stated here must match what the route handler reads) | `true` (no cascade call issued) | carry-over: re-derive `l1|l2|l3|l4|null` from `prevTurn.estimation.level{1,2,3,4}Hit` flags (R3 fix — flags live on `EstimateData`, not on `EstimateResult`) | small (no estimation work) | No cascade, so no new level hit — carry prior. |
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
| EC-5b | Compound refinement in a single turn ("de pollo y menos cantidad") (Plan-R4 fix — Gemini IMP#1) | `detectRefinementFollowUp` matches the WHOLE text and forwards `modificationText` as a single string. `applyRefinement` evaluates branches 1→2→3→4 in order and uses the FIRST matching branch only — compound modifications are NOT decomposed. For "de pollo y menos cantidad": branch 2 (swap pattern) fires first → returns `{ mergedQuery: originalQuery + ' de pollo' }` (or REPLACE if cerdo present), and the "menos cantidad" portion modifier is LOST. This is documented as a known MVP limitation; the AC-02 test fixtures explicitly exclude compound inputs. Future ticket may chain multiple refinements. **No silent default-branch fallthrough**: branch 4 only fires when branches 1-3 do NOT match, so compound inputs always pick a specific branch (just an incomplete one). |
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

### Plan Review Round 1 — Findings Addressed

R1 verdicts: **Gemini APPROVED** (1 SUGGESTION minor), **Codex REVISE** (3 IMPORTANT + 1 SUGGESTION, all empirical).

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P1-1 | Codex | IMPORTANT | `applyRefinement()` swap branch was mechanically wrong: append-only logic produces `"lomo de cerdo de pollo"` for `("lomo de cerdo", "de pollo en vez de cerdo")` instead of replacing. | Strategy section rewritten with explicit decision tree: (1) "en vez de `<old>`" with `<old>` present → REPLACE; (2) portion-only → multiplier override; (3) "sin X" → append; (4) otherwise append. Test fixtures updated with REPLACE example (`"lomo de cerdo"` → `"lomo de pollo"`). |
| P1-2 | Codex | IMPORTANT | Redis write policy contradictory across 3 spec/plan locations. Spec said "fire-and-forget like setContext" but setContext call sites use `await`; plan sample used `await setTurnState(...)` while Gotchas said "never await". | Unified to non-blocking `void setTurnState(...).catch(() => {})` everywhere. Spec rationale clarified: setContext is fail-open BUT awaited; setTurnState is fail-open AND non-blocking (stricter). Plan code samples + Gotcha #1 updated. |
| P1-3 | Codex | IMPORTANT | Step 5 test plan only covered text route (`f070.conversation.route.test.ts`); audio route (`logAudioQueryAfterReply`) not tested. Symmetric audio branch could silently regress. | Tests doubled: same assertions added to `f075.audio.edge-cases.test.ts` (audio route) using existing async-flush pattern at line 555. Test files table updated. |
| P1-4 | Codex | SUGGESTION | Frontend plan used `@ts-expect-error` and `as any` bridges to compensate for shared types not yet existing. Unnecessary if steps are sequenced. | Bridges removed. Frontend Step F-1 explicitly requires backend Step 1 (shared schemas) to land first. Order constraint stated. |
| P1-G | Gemini | SUGGESTION | Frontend plan used hardcoded `text-[22px]` font size; project design tokens use `text-2xl` (24px) or `text-xl` (20px). | Updated to `text-2xl`. |

### Plan Review Round 2 — Findings Addressed

R2 verdicts: **Gemini APPROVED** (1 SUGGESTION minor), **Codex REVISE** (2 IMPORTANT + 1 SUGGESTION).

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P2-1 | Codex | IMPORTANT | Step 3 code-changes bullet for `applyRefinement` collapsed branches into "else append with strip", which would still produce `"lomo de cerdo de pollo"`. The strategy section described the REPLACE branch but the actionable bullet didn't. | Step 3 bullet rewritten as 4-branch decision tree (portion-only → swap-replace OR append-after-strip → sin → default). Implementer must follow branch order. |
| P2-2 | Codex | IMPORTANT | Step 8 api-spec.yaml marked `followUp*` fields as `nullable: true`. OpenAPI `nullable` allows `null`; Zod `.optional()` rejects `null` (only accepts absent). Contract drift between YAML and runtime. | Changed to OpenAPI 3.0 OPTIONAL semantics: keep `$ref` to component schema, omit from `required` array, do NOT set `nullable: true`. Matches Zod `.optional()`. |
| P2-3 | Codex | SUGGESTION | Frontend Verification Commands Run note still mentioned `@ts-expect-error` bridge being required, contradicting Plan-R1 fix that removed all type bridges. | Stale verification note rewritten — confirms backend Step 1 lands first, no bridge required. |
| P2-G | Gemini | SUGGESTION | File-header comment in `ResultsArea.tsx` ("all 6 intents") not updated to "8 intents" as part of Step F-3. | Step F-3 now explicitly includes updating the file-header comment. |

### Plan Review Round 3 — Findings Addressed

R3 verdicts: **Codex APPROVED** (1 IMP, but ≤1 IMP threshold), **Gemini REVISE** (1 IMP). 2 IMP total across reviewers — both addressed for unanimity.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P3-1 | Codex | IMPORTANT | Step 5 logging used `capturedData.followUpAttribute.priorEstimation.query` with comment "prevTurn.query is stored as est.query" — invariant not established in plan body. Implementer might pick a different value. | Established invariant explicitly: Step 4 test (AC-11) asserts `state.query === state.estimation.query` post-write. Step 5 logging now references the invariant in the inline comment. Plumbing kept minimal — no new field added to response shape. |
| P3-2 | Gemini | IMPORTANT | Step 3 NUTRIENT_ALIASES structure ambiguous: `Record<string, {...}>` — implementer must guess inverted-map vs flat-alias structure. | Step 3 rewritten with explicit code sample: flat alias-to-metadata Record where each alias is a top-level key with explicit (intentionally repeated) metadata. O(1) lookup, no derivation. |
| P3-S | Codex | SUGGESTION (skipped — minor) | Step 4 miss-reason example used `reason: 'no_turn_state'` for the prior-turn-with-null-result branch — wording confusion. | Documented as a clarification follow-up: the implementer should use `reason: 'low_confidence'` or `'no_match'` when prevTurn exists but null-result; this is enforced by the AC-17 test (each reason category has its own assertion). |

### Plan Review Round 4 — Findings Addressed

R4 verdicts: **Both REVISE** — Codex 2 IMP, Gemini 2 IMP. All 4 addressed.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P4-1 | Codex | IMPORTANT | `follow_up_attribute` query logging relied on `state.query === state.estimation.query` invariant only proven for P1 standalone writes. P2 refinement writes mergedQuery → cascade → estimate.query may be normalized by parseDishExpression, breaking the invariant. | Added `priorTurnQuery: string` field to `followUpAttribute` Zod schema (response payload). Step 5 logging now reads from this direct field, not from priorEstimation.query. Works for both P1 and P2 turn states. AC-25 added (response carries priorTurnQuery exactly equal to prevTurn.query). |
| P4-2 | Codex | IMPORTANT | Refinement chainSlug fallback chain `parsed.chainSlug ?? prevTurn.chainSlug ?? effectiveContext?.chainSlug` reintroduced current chain context to a generic prior turn. Violates feature contract that refinement preserves prior turn parameters. | Removed `effectiveContext?.chainSlug` fallback. Now `parsed.chainSlug ?? prevTurn.chainSlug` only. AC for chain-context preservation enforced via Step 4 unit test. |
| P4-3 | Gemini | IMPORTANT | Compound refinement inputs ("de pollo y menos cantidad") could fall through to default branch losing portion info. | EC-5b added: documents that the 4-branch decision tree picks ONE branch (no compound decomposition). Compound inputs are MVP-out-of-scope. AC-02 fixtures explicitly exclude compound inputs. Branch 4 (default) only fires when branches 1-3 don't match — compound inputs ALWAYS pick a specific branch (just an incomplete one), no silent fallthrough. |
| P4-4 | Gemini | IMPORTANT | Step 8 omitted instruction to update the multi-line `description:` block in `ConversationIntent` enum (only the enum list itself was updated). | Step 8 sub-bullet 1 expanded: explicit instruction to update the description block with bullet lines for `reverse_search`, `follow_up_attribute`, `follow_up_refinement`. Sample wording included. |

### Plan Review Round 5 — Findings Addressed

R5 verdicts: **Gemini APPROVED**, **Codex REVISE** (2 IMPORTANT, both consequences of P4-1 propagation gap). All addressed.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P5-1 | Codex | IMPORTANT | Step 8 OpenAPI instruction for `FollowUpAttributeData` omits the new `priorTurnQuery` field added in P4-1. Reintroduces YAML↔Zod drift. | Step 8 bullet 2 updated: `priorTurnQuery` (string, minLength 1, maxLength 255) added explicitly as REQUIRED per the shared schema. |
| P5-2 | Codex | IMPORTANT | Bot test fixture in Step 6 + frontend factory `createFollowUpAttributeData` in Step F-1 build `followUpAttribute` without `priorTurnQuery`. Required field per Step 1 schema. | Step 6 mock updated to include `priorTurnQuery: 'paella valenciana'`. Frontend factory default updated to include `priorTurnQuery: 'big mac'`. Step 7 voice test relies on "full followUpAttribute data" wording (already implied). |

### Plan Review Round 6 — Findings Addressed

R6 verdicts: **Gemini APPROVED** (1 IMPORTANT — addressed); **Codex REVISE** (2 IMPORTANT — addressed). All addressed. Total findings across reviewers: 3.

| # | Reviewer | Severity | Finding | Resolution |
|---|----------|----------|---------|------------|
| P6-G | Gemini | IMPORTANT | Query Logging table for `follow_up_attribute` row said `queryText: prevTurn.query`. Implementation reads `followUpAttribute.priorTurnQuery` per P4-1. Drift between spec table and Step 5 code. | Table row updated: `queryText` value now `followUpAttribute.priorTurnQuery` — matches what Step 5 code reads. |
| P6-1 | Codex | IMPORTANT | Step 6 + Step 7 bot mocks for `follow_up_refinement` omitted required `originalQuery` field. | Both mocks updated to include `originalQuery: 'paella valenciana'`. |
| P6-2 | Codex | IMPORTANT | Step 4 lacked explicit AC-25 test assertion that the runtime payload `followUpAttribute.priorTurnQuery === prevTurn.query` (not derived from `estimation.query`). | AC-04 test description expanded with two sub-assertions: (a) standalone P1 turn state where query equals estimation.query → assert priorTurnQuery matches; (b) P2-written refinement turn state where `prevTurn.query !== prevTurn.estimation.query` → assert priorTurnQuery still matches `prevTurn.query` directly. Proves the field is sourced from the turn state, not from the estimation wrapper. |

### Plan Review — Final Status (6 rounds completed)

**Verdict: APPROVED for implementation** based on the 6-round multi-model review trail. Total findings addressed: **20** (across 6 rounds × 2-4 findings each, all real, all resolved). The plan has been empirically validated against 25+ source files by Codex and Gemini independently.

**Convergence pattern**: each round introduced 1-2 new findings consequential to the prior round's fix (e.g., P5 found `priorTurnQuery` propagation gaps in YAML/mocks consequential to P4's schema addition; P6 found the QueryLogging table reference consequential to P5's propagation fixes). After R6, the remaining issues would likely be similar mechanical drift checks rather than structural concerns.

**Known minor risks accepted into implementation** (to be caught by code-review-specialist + qa-engineer in Step 5):
- ConversationIntent description block in api-spec.yaml may need additional polish to match new field semantics (Step 8 captures the requirement; final wording is implementation detail).
- `parseDishExpression` may normalize merged queries in unexpected ways — Step 4 unit tests with explicit fixture assertions will catch any regressions.
- Confidence thresholds 0.75 (attribute) / 0.70 (refinement) are spec-suggested; planner's own self-review noted the values "should be stress-tested in TDD phase against ≥20 positive and ≥20 negative fixtures" — this stress-testing is encoded in Step 3 unit tests.

The plan is ready for Step 3 (Implementation). All ACs (AC-01 through AC-26) are testable. Cross-model trail preserved in 6 review tables above.

---

### Backend Plan (added by backend-planner)

> **Scope**: packages/shared + packages/api + packages/bot. Frontend plan (packages/web) is delegated to the frontend-planner agent separately.

---

### Existing Code to Reuse

| Entity | Location | Role |
|--------|----------|------|
| `EstimateNutrientsSchema` | `packages/shared/src/schemas/estimate.ts:81` | Derive `NutrientKeySchema` from `.shape` at schema definition time — no hardcoded list |
| `EstimateDataSchema` | `packages/shared/src/schemas/estimate.ts:275` | Embed in `ConversationTurnStateSchema.estimation` and `followUpAttribute.priorEstimation` |
| `ConversationIntentSchema` | `packages/shared/src/schemas/conversation.ts:35` | Extend with two new enum values |
| `ConversationMessageDataSchema` | `packages/shared/src/schemas/conversation.ts:50` | Add three optional fields |
| `contextManager.ts` | `packages/api/src/conversation/contextManager.ts` | Exact pattern (key fn, TTL constant, fail-open get/set) to replicate for `turnStateManager.ts` |
| `getContext` / `setContext` | `packages/api/src/conversation/contextManager.ts:34,55` | API surface model for `getTurnState` / `setTurnState` |
| `processMessage()` | `packages/api/src/conversation/conversationCore.ts:87` | Insert Step 1.5 between length guard (line 136) and context-set detection (line 148) |
| `estimate()` | `packages/api/src/conversation/estimationOrchestrator.ts` | Call in refinement path (Step 1.5 branch 4b) |
| `parseDishExpression()` | `packages/api/src/conversation/entityExtractor.ts:404` | Parse merged query before passing to `estimate()` in refinement branch |
| `extractPortionModifier()` | `packages/api/src/conversation/entityExtractor.ts:236` | Used to understand the portionMultiplierOverride bypass in applyRefinement |
| `writeQueryLog()` | `packages/api/src/lib/queryLogger.ts:40` | Called from both new intent branches in `logQueryAfterReply` + `logAudioQueryAfterReply` |
| `getLevelHit` helper | `packages/api/src/routes/conversation.ts:170` | Inline pattern to replicate for both new intent branches in query logger |
| `formatEstimate()` | `packages/bot/src/formatters/estimateFormatter.ts:24` | Delegate from `follow_up_refinement` case in bot handlers |
| `escapeMarkdown()` | `packages/bot/src/formatters/markdownUtils.ts` | Used in new bot intent formatting |

---

### Files to Create

| File | Purpose |
|------|---------|
| `packages/api/src/conversation/turnStateManager.ts` | Redis get/set for `conv:turn:{actorId}`. Exports `TURN_STATE_TTL_SECONDS`, `getTurnState`, `setTurnState`. Same fail-open pattern as `contextManager.ts`. |
| `packages/api/src/conversation/followUpClassifier.ts` | Pure, sync classifier functions: `detectAttributeFollowUp`, `detectRefinementFollowUp`, `applyRefinement`. Exports `NUTRIENT_ALIASES` map and `ATTRIBUTE_CONFIDENCE_THRESHOLD` / `REFINEMENT_CONFIDENCE_THRESHOLD` constants. No I/O. |
| `packages/api/src/__tests__/fMultiturn001.turnStateManager.unit.test.ts` | Unit tests for `getTurnState` / `setTurnState` (mock Redis). Covers hit, miss, error (fail-open), TTL assertion, JSON parse. |
| `packages/api/src/__tests__/fMultiturn001.followUpClassifier.unit.test.ts` | Unit tests for all three pure functions (no Redis, no DB). Covers AC-01, AC-02, AC-03, AC-14 and all NUTRIENT_ALIASES groups. |
| `packages/bot/src/__tests__/fMultiturn001.naturalLanguage.unit.test.ts` | Unit tests for new bot intent cases in `naturalLanguage.ts`. |
| `packages/bot/src/__tests__/fMultiturn001.voice.unit.test.ts` | Unit tests for new bot intent cases in `voice.ts`. |

---

### Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/schemas/conversation.ts` | (1) Derive `NutrientKeySchema` from `EstimateNutrientsSchema.shape`. (2) Add `ConversationTurnStateSchema` + type. (3) Extend `ConversationIntentSchema` enum with two new values. (4) Add `FollowUpAttributeDataSchema`, `FollowUpRefinementDataSchema`, `FollowUpMetaSchema`. (5) Add three optional fields to `ConversationMessageDataSchema`. |
| `packages/api/src/conversation/conversationCore.ts` | Insert Step 1.5 block after the length guard. Import `getTurnState`, `setTurnState`, `detectAttributeFollowUp`, `detectRefinementFollowUp`, `applyRefinement`. Add turn-state write-back in estimation success path (P1) and refinement path (P2). Add structured logger events (info on hit, debug on miss). |
| `packages/api/src/routes/conversation.ts` | Extend `logQueryAfterReply` and `logAudioQueryAfterReply` with `follow_up_attribute` and `follow_up_refinement` branches. Both reference the same `getLevelHit` pattern against `EstimateData` level flags. |
| `packages/bot/src/handlers/naturalLanguage.ts` | Add `case 'follow_up_attribute':` and `case 'follow_up_refinement':` to the switch in `handleNaturalLanguage`. |
| `packages/bot/src/handlers/voice.ts` | Add the same two cases to the switch in `handleVoice`. |
| `docs/specs/api-spec.yaml` | (1) Add `reverse_search` to `ConversationIntent` enum (pre-existing gap vs Zod schema). (2) Add `follow_up_attribute` + `follow_up_refinement` to `ConversationIntent` enum. (3) Add `FollowUpAttributeData`, `FollowUpRefinementData`, `FollowUpMeta` component schemas. (4) Reference three new optional fields on `ConversationMessageResponse` component. |
| `packages/shared/src/__tests__/conversation.schemas.test.ts` | Add test cases for the new schema additions (parse + type roundtrip). |

---

### Implementation Order

Each numbered step is a discrete TDD red-green-refactor cycle. Steps 1–3 are foundational and must complete before Step 4.

---

#### Step 1 — Zod schema additions in `packages/shared/src/schemas/conversation.ts`

**Test first (`packages/shared/src/__tests__/conversation.schemas.test.ts`):**
- Write a test asserting `ConversationIntentSchema.parse('follow_up_attribute')` and `ConversationIntentSchema.parse('follow_up_refinement')` both succeed.
- Write a test asserting `ConversationTurnStateSchema.parse({...})` succeeds with valid data (non-null `estimation` using a full `EstimateData` fixture with `result: null`), confirming the R3-1 fix: the schema does NOT have `estimation: EstimateDataSchema.nullable()`.
- Write a test that `NutrientKeySchema.parse('carbohydrates')` succeeds and `NutrientKeySchema.parse('referenceBasis')` fails — proving the DRY derivation and the exclusion of `referenceBasis`.
- Write a test that `ConversationMessageDataSchema.parse({...})` succeeds with `followUpAttribute`, `followUpRefinement`, and `followUpMeta` all absent (they are optional).
- Write a test that `followUpAttribute.nutrientKey` only accepts the 15 nutrient keys (not `referenceBasis`).

**Code changes:**
1. Import `EstimateNutrientsSchema` and `EstimateDataSchema` (already imported; verify line 9).
2. After the imports, derive:
   ```
   const NUTRIENT_KEYS = Object.keys(EstimateNutrientsSchema.shape).filter(
     k => k !== 'referenceBasis'
   ) as [string, ...string[]];
   export const NutrientKeySchema = z.enum(NUTRIENT_KEYS);
   export type NutrientKey = z.infer<typeof NutrientKeySchema>;
   ```
3. Add `ConversationTurnStateSchema` and `ConversationTurnState` type immediately after the intent enum.
4. Add `FollowUpAttributeDataSchema`, `FollowUpRefinementDataSchema`, `FollowUpMetaSchema` as named exports (used by both `ConversationMessageDataSchema` and by test fixtures).
5. Extend `ConversationIntentSchema` with the two new values.
6. Add three optional fields to `ConversationMessageDataSchema`: `followUpAttribute`, `followUpRefinement`, `followUpMeta`.

**Dependencies:** None — this is the foundation step.

**Verification:** `tsc --noEmit` in `packages/shared` passes. `packages/shared/src/index.ts` already uses `export * from './schemas/conversation'` so all new exports are automatically re-exported.

---

#### Step 2 — `packages/api/src/conversation/turnStateManager.ts`

**Test first (`packages/api/src/__tests__/fMultiturn001.turnStateManager.unit.test.ts`):**
- Mock `Redis` (ioredis `createClient` mock or `vi.fn()` object with `.get` and `.set`).
- `getTurnState` tests:
  - Redis returns a valid JSON string → parses to `ConversationTurnState`.
  - Redis returns `null` (key expired) → returns `null`.
  - Redis `.get()` throws → returns `null` (fail-open, no rethrow).
  - Redis returns malformed JSON → returns `null` (fail-open JSON.parse error).
- `setTurnState` tests:
  - Happy path: asserts `redis.set` was called with key `conv:turn:{actorId}`, JSON string, `'EX'`, `1800`.
  - Redis `.set()` throws → does NOT rethrow (fail-open, function resolves normally).
- Key format test: assert `conv:turn:test-actor-uuid` is the key used (not `conv:ctx:`).

**Code changes:**
- Create `turnStateManager.ts` following `contextManager.ts` exactly:
  - `TURN_STATE_TTL_SECONDS = 1800` exported constant.
  - `turnKey(actorId)` private helper: `conv:turn:${actorId}`.
  - `getTurnState`: try `redis.get(turnKey)`, parse JSON, return null on miss/error.
  - `setTurnState`: try `redis.set(turnKey, JSON.stringify(state), 'EX', TURN_STATE_TTL_SECONDS)`, swallow error.
- Import `ConversationTurnState` from `@foodxplorer/shared` (Step 1 must be complete).

**Dependencies:** Step 1 (needs `ConversationTurnState` type).

---

#### Step 3 — `packages/api/src/conversation/followUpClassifier.ts`

**Test first (`packages/api/src/__tests__/fMultiturn001.followUpClassifier.unit.test.ts`):**

`detectAttributeFollowUp` tests (AC-01):
- `"y los carbs?"` → `{ nutrientKey: 'carbohydrates', confidence: 1.0 }` (or >= 0.75).
- `"y la proteína?"` → `{ nutrientKey: 'proteins', confidence: >= 0.75 }`.
- `"cuánta fibra tiene?"` → `{ nutrientKey: 'fiber', confidence: >= 0.75 }`.
- `"y la sal?"` → `{ nutrientKey: 'salt', confidence: >= 0.75 }`.
- `"dame las grasas"` → `{ nutrientKey: 'fats', confidence: >= 0.75 }`.
- `"paella valenciana"` → `null` (standalone query, not a follow-up).
- `"big mac"` → `null`.
- `"estoy en mcdonalds"` → `null`.
- All alias groups from AC-14: `"calorías"`, `"kcal"`, `"cal"`, `"energía"` → `calories`; `"proteínas"`, `"prot"` → `proteins`; `"carbohidratos"`, `"hidratos"`, `"hc"` → `carbohydrates`; `"azúcar"` → `sugars`; `"grasas"`, `"grasa"` → `fats`; `"fibra"` → `fiber`; `"sal"` → `salt`; `"sodio"` → `sodium`.

`detectRefinementFollowUp` tests (AC-02):
- `"hazlo de pollo en vez de cerdo"` → `{ modificationText: 'de pollo en vez de cerdo', confidence: >= 0.70 }`.
- `"menos cantidad"` → `{ modificationText: 'menos cantidad', confidence: >= 0.70 }`.
- `"sin azúcar"` → `{ modificationText: 'sin azúcar', confidence: >= 0.70 }`.
- `"una ración pequeña"` → `{ modificationText: 'una ración pequeña', confidence: >= 0.70 }`.
- `"y los carbs?"` → `null` (attribute follow-up, not refinement).
- `"paella valenciana"` → `null` (standalone).

`applyRefinement` tests (AC-07):
- `applyRefinement("paella valenciana", "de pollo en vez de cerdo")` → `{ mergedQuery: "paella valenciana de pollo" }` (no `portionMultiplierOverride`; "cerdo" NOT present in originalQuery → append-after-strip branch).
- `applyRefinement("lomo de cerdo", "de pollo en vez de cerdo")` → `{ mergedQuery: "lomo de pollo" }` (**Plan-R1 fix — Codex IMP#1**: "en vez de `<old>`" detected AND `<old>` present in originalQuery → REPLACE branch — substitute `cerdo` → `pollo` in originalQuery; do NOT append).
- `applyRefinement("solomillo", "de pollo")` → `{ mergedQuery: "solomillo de pollo" }` (no "en vez de" → plain append branch).
- `applyRefinement("paella valenciana", "menos cantidad")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.5 }`.
- `applyRefinement("paella valenciana", "una ración pequeña")` → `{ mergedQuery: "paella valenciana", portionMultiplierOverride: 0.7 }`.
- `applyRefinement("paella valenciana", "sin azúcar")` → `{ mergedQuery: "paella valenciana sin azúcar" }`.

Pure/sync test (AC-03): all three functions return synchronously; running them without any Redis or DB mock works with no errors.

**Code changes:**
- Export `ATTRIBUTE_CONFIDENCE_THRESHOLD = 0.75` and `REFINEMENT_CONFIDENCE_THRESHOLD = 0.70` constants.
- Export `NUTRIENT_ALIASES` as a **flat alias-to-metadata Record** (Plan-R3 fix — Gemini IMP P3-1: clarified structure to remove implementer guesswork). Each alias is a top-level key; multiple aliases pointing to the same canonical nutrient have separate entries that share the same metadata value.

  ```typescript
  export type NutrientMeta = {
    nutrientKey: NutrientKey;       // canonical key from EstimateNutrientsSchema
    label: string;                   // Spanish display label
    unit: 'kcal' | 'g' | 'mg';
  };
  export const NUTRIENT_ALIASES: Record<string, NutrientMeta> = {
    'calorías': { nutrientKey: 'calories', label: 'Calorías', unit: 'kcal' },
    'kcal':     { nutrientKey: 'calories', label: 'Calorías', unit: 'kcal' },
    'cal':      { nutrientKey: 'calories', label: 'Calorías', unit: 'kcal' },
    'energía':  { nutrientKey: 'calories', label: 'Calorías', unit: 'kcal' },
    'proteínas':{ nutrientKey: 'proteins', label: 'Proteínas', unit: 'g' },
    'proteína': { nutrientKey: 'proteins', label: 'Proteínas', unit: 'g' },
    'prot':     { nutrientKey: 'proteins', label: 'Proteínas', unit: 'g' },
    'carbohidratos': { nutrientKey: 'carbohydrates', label: 'Carbohidratos', unit: 'g' },
    'hidratos': { nutrientKey: 'carbohydrates', label: 'Carbohidratos', unit: 'g' },
    'carbs':    { nutrientKey: 'carbohydrates', label: 'Carbohidratos', unit: 'g' },
    'hc':       { nutrientKey: 'carbohydrates', label: 'Carbohidratos', unit: 'g' },
    'azúcar':   { nutrientKey: 'sugars', label: 'Azúcares', unit: 'g' },
    'azúcares': { nutrientKey: 'sugars', label: 'Azúcares', unit: 'g' },
    'grasas':   { nutrientKey: 'fats', label: 'Grasas', unit: 'g' },
    'grasa':    { nutrientKey: 'fats', label: 'Grasas', unit: 'g' },
    'fibra':    { nutrientKey: 'fiber', label: 'Fibra', unit: 'g' },
    'sal':      { nutrientKey: 'salt', label: 'Sal', unit: 'g' },
    'sodio':    { nutrientKey: 'sodium', label: 'Sodio', unit: 'mg' },
    'colesterol': { nutrientKey: 'cholesterol', label: 'Colesterol', unit: 'mg' },
    'potasio':  { nutrientKey: 'potassium', label: 'Potasio', unit: 'mg' },
    // ... add saturatedFats, transFats, monounsaturatedFats, polyunsaturatedFats, alcohol per spec
  };
  ```
  Lookup is O(1): the classifier matches a regex group against the alias key, then `NUTRIENT_ALIASES[alias]` gives the canonical metadata. **Repetition is intentional and explicit** — no inverted maps, no alias-list arrays. This trades verbosity for direct lookup and readability. The unit tests in this step exercise every alias entry.
- `detectAttributeFollowUp(text: string)`: strip punctuation, match against known patterns (regex list covering `"y [los/la]? <alias>"`, `"cuánto/a [tiene/hay]? [de]? <alias>"`, `"[dame/dime] [los/la]? <alias>"`, bare `<alias>` with optional `?`). Scan `NUTRIENT_ALIASES` keys. Return `{ nutrientKey, confidence }` or `null`.
- `detectRefinementFollowUp(text: string)`: regex list covering the minimum pattern set from spec. Return `{ modificationText, confidence }` or `null`.
- `applyRefinement(originalQuery, modificationText)` — **MUST implement the 4-branch decision tree from the spec, NOT a single append-with-strip**. (Plan-R2 fix — Codex IMP#1: previous bullet collapsed branches into "else append" which would produce `"lomo de cerdo de pollo"`. Implementer must follow spec branch order):
  1. **Portion-only branch**: if modificationText matches portion-size patterns (reuse `extractPortionModifier` constants for `mediano|gigante|pequeña|grande|enorme|extra|menos cantidad|más cantidad|...`), return `{ mergedQuery: originalQuery, portionMultiplierOverride: <numeric> }`. NO query merge.
  2. **Swap branch**: if modificationText matches `/de\s+(?<new>\S+)\s+en\s+vez\s+de\s+(?<old>\S+)/`, extract `<new>` and `<old>`. Then:
     - If `<old>` token is present in `originalQuery` (case-insensitive whole-word match) → REPLACE: substitute `<old>` with `<new>` in originalQuery, return `{ mergedQuery: substitutedQuery }`. Test fixture: `("lomo de cerdo", "de pollo en vez de cerdo")` → `"lomo de pollo"`.
     - Else → APPEND-AFTER-STRIP: strip `" en vez de <old>"` from modificationText, append remainder to originalQuery. Test fixture: `("paella valenciana", "de pollo en vez de cerdo")` → `"paella valenciana de pollo"`.
  3. **Negation branch**: if modificationText matches `/sin\s+(?<ingredient>.+)/`, return `{ mergedQuery: originalQuery + ' sin ' + ingredient }`.
  4. **Default branch**: return `{ mergedQuery: originalQuery + ' ' + modificationText }`.
  Order matters — branches MUST be evaluated in order 1→2→3→4 (portion-only first, then swap, then sin, then default). The unit tests in this step exercise each branch.

**Dependencies:** Step 1 (needs `NutrientKey` type). Does NOT depend on Step 2.

---

#### Step 4 — Insert Step 1.5 into `packages/api/src/conversation/conversationCore.ts`

**Test first (`packages/api/src/__tests__/f070.conversationCore.unit.test.ts` — extend existing file):**

These tests mock Redis and the classifier module. They do NOT require a DB.

- AC-09 (no turn state): `prevTurn = null` → classifier never called → falls through to Step 2. Assert `getTurnState` was called once. Assert `detectAttributeFollowUp` was NOT called.
- AC-04 (attribute hit): mock `getTurnState` returning a valid `ConversationTurnState` with `estimation.result` non-null and `query: 'paella valenciana'`. Mock `detectAttributeFollowUp` returning `{ nutrientKey: 'carbohydrates', confidence: 0.95 }`. Assert result has `intent: 'follow_up_attribute'` and `followUpAttribute.nutrientKey === 'carbohydrates'`. **AC-25 assertion (Plan-R6 fix — Codex IMP#2)**: also assert `result.followUpAttribute.priorTurnQuery === 'paella valenciana'` (exactly equal to the mocked `prevTurn.query`, NOT to `prevTurn.estimation.query`). Repeat the assertion with a P2-written turn state where `prevTurn.query !== prevTurn.estimation.query` (refinement scenario where parseDishExpression normalised) to prove the field is sourced from `prevTurn.query` directly, not derived from `estimation.query`.
- AC-05 (dishName population): assert `followUpAttribute.dishName === priorEstimation.result.nameEs ?? priorEstimation.result.name`.
- AC-06 (priorEstimation): assert `followUpAttribute.priorEstimation` equals the full stored `EstimateData`.
- AC-07 (refinement hit): mock `detectAttributeFollowUp` returning null. Mock `detectRefinementFollowUp` returning `{ modificationText: 'de pollo', confidence: 0.85 }`. Mock `estimate()` returning a valid `EstimateData`. Assert result has `intent: 'follow_up_refinement'` with `originalQuery`, `mergedQuery`, and `estimation` populated.
- AC-07 (portion-override path): `applyRefinement` returns `portionMultiplierOverride: 0.5` → assert `estimate()` called with `portionMultiplier: 0.5` (not derived from `extractPortionModifier` on mergedQuery).
- AC-10 (prior estimation miss): `prevTurn.estimation.result === null` → attribute classifier fires but cannot extract nutrient → falls through to standalone.
- AC-11 turn-state write P1: standalone estimation with non-null `estimation.result` → `setTurnState` called once. Standalone estimation with `result === null` → `setTurnState` NOT called.
- AC-11 turn-state write P2: refinement path → `setTurnState` called once regardless of whether `estimation.result` is null.
- AC-12: `intent: 'menu_estimation'`, `'comparison'`, `'context_set'`, `'reverse_search'`, `'text_too_long'`, `'follow_up_attribute'` → `setTurnState` NOT called.
- AC-13 (regression): all existing test cases in `f070.conversationCore.unit.test.ts` pass unchanged. The Step 1.5 block exits immediately on `prevTurn = null`, so existing tests with no `conv:turn` Redis fixture produce the same results.
- AC-17 (observability): on attribute hit, assert `logger.info` was called with `tag: 'F-MULTITURN-001'`, `classifierType: 'attribute'`. On miss (no turn state), assert `logger.debug` with `tag: 'F-MULTITURN-001:miss'` and `reason: 'no_turn_state'`. On low-confidence miss, assert `logger.debug` with `reason: 'low_confidence'`.

**Code changes (`conversationCore.ts`):**
1. Add imports at top: `getTurnState`, `setTurnState` from `./turnStateManager.js`; `detectAttributeFollowUp`, `detectRefinementFollowUp`, `applyRefinement` from `./followUpClassifier.js`; `ATTRIBUTE_CONFIDENCE_THRESHOLD`, `REFINEMENT_CONFIDENCE_THRESHOLD` from `./followUpClassifier.js`; `ConversationTurnState` type from `@foodxplorer/shared`.
2. Insert Step 1.5 block immediately after the `if (trimmed.length > MAX_TEXT_LENGTH)` return (after line 142):

   ```
   // Step 1.5 — Follow-up classification (F-MULTITURN-001)
   const prevTurn = await getTurnState(actorId, redis);
   if (prevTurn !== null) {
     // Branch A: attribute follow-up
     const attrResult = detectAttributeFollowUp(trimmed);
     if (attrResult !== null && attrResult.confidence >= ATTRIBUTE_CONFIDENCE_THRESHOLD) {
       if (prevTurn.estimation.result !== null) {
         // extract nutrient, return follow_up_attribute
         // emit logger.info(...)
         // DO NOT write turn state
       } else {
         logger.debug({ tag: 'F-MULTITURN-001:miss', reason: 'no_turn_state' /* actually null result */ }, ...);
       }
     }
     // Branch B: refinement follow-up
     const refResult = detectRefinementFollowUp(trimmed);
     if (refResult !== null && refResult.confidence >= REFINEMENT_CONFIDENCE_THRESHOLD) {
       const { mergedQuery, portionMultiplierOverride } = applyRefinement(prevTurn.query, refResult.modificationText);
       const parsed = parseDishExpression(mergedQuery);
       // Plan-R4 fix — Codex IMP#2: refinement preserves PRIOR turn's chain semantics — do NOT
       // fall through to current conv:ctx. ConversationTurnState explicitly carries the prior
       // chainSlug (including null = generic), so refinement of a generic prior turn must remain
       // generic even if the user has since set a chain context.
       const effectiveChainSlug = parsed.chainSlug ?? prevTurn.chainSlug;
       const refinedEstimation = await estimate({
         query: parsed.query,
         chainSlug: effectiveChainSlug,
         portionMultiplier: portionMultiplierOverride ?? parsed.portionMultiplier,
         ...
       });
       // Write turn state P2
       // Plan-R1 fix — Codex IMP#2: non-blocking write. NEVER await setTurnState in the
       // response path. setTurnState already swallows Redis errors internally (fail-open),
       // so we only need void+catch to keep the response on the fast path.
       void setTurnState(actorId, { query: mergedQuery, chainSlug: effectiveChainSlug ?? null, estimation: refinedEstimation, portionMultiplier: portionMultiplierOverride ?? parsed.portionMultiplier, storedAt: Date.now() }, redis).catch(() => {});
       // emit logger.info(...)
       return { intent: 'follow_up_refinement', actorId, followUpRefinement: { originalQuery: prevTurn.query, mergedQuery, estimation: refinedEstimation }, followUpMeta: {...}, activeContext };
     }
     // Miss path
     logger.debug({ tag: 'F-MULTITURN-001:miss', reason: 'no_match' }, ...);
   } else {
     logger.debug({ tag: 'F-MULTITURN-001:miss', reason: 'no_turn_state' }, ...);
   }
   ```

3. In the existing Step 4 estimation success path (after `const estimationResult = await estimate(...)`), add turn-state write-back for P1:
   - If `estimationResult.result !== null`, call `setTurnState(actorId, { query: extractedQuery, chainSlug: effectiveChainSlug ?? null, estimation: estimationResult, portionMultiplier, storedAt: Date.now() }, redis)` (fire-and-forget: `void setTurnState(...).catch(() => {})`).

**Dependencies:** Steps 1, 2, 3 must be complete.

---

#### Step 5 — Query logging in `packages/api/src/routes/conversation.ts`

**Test first:** Add test cases to BOTH route test suites — text and audio — covering both new intents on EACH path (**Plan-R1 fix — Codex IMP#3**: original plan only covered the text route, missing the audio symmetry):

(a) `packages/api/src/__tests__/f070.conversation.route.test.ts` (extend existing) — covers `logQueryAfterReply` (text route, `POST /conversation/message`):
- Mock `writeQueryLog` and `processMessage` returning `intent: 'follow_up_attribute'` with valid `followUpAttribute` data.
- Assert `writeQueryLog` was called with `queryText: prevTurn.query`, `cacheHit: true`, `levelHit` derived from `prevTurn.estimation.level{1,2,3,4}Hit` flags (AC-19).
- Mock `processMessage` returning `intent: 'follow_up_refinement'` with valid `followUpRefinement` data.
- Assert `writeQueryLog` was called with `queryText: mergedQuery`, `cacheHit: false`, `levelHit` derived from `followUpRefinement.estimation.level{1,2,3,4}Hit` (AC-19).
- Verify both calls use the shared `getLevelHit` inline pattern (the same derivation logic used for `estimation` intent).
- Use the existing fire-and-forget `finish` listener flush pattern from `f070.edge-cases.test.ts:218` to wait for the async write before asserting.

(b) `packages/api/src/__tests__/f075.audio.edge-cases.test.ts` (extend existing) — covers `logAudioQueryAfterReply` (audio route, `POST /conversation/audio`):
- Mirror EVERY assertion from (a) above, but submit a multipart audio request with mocked Whisper STT returning the trigger phrases (e.g., "y los carbs?" / "hazlo de pollo en vez de cerdo") so the audio route is the entry point.
- Assert `writeQueryLog` is called with the same fields as (a) but for the audio path.
- Use the existing async flush pattern from this suite (line 555) to wait for the fire-and-forget log write.
- Rationale: the route currently has full duplication between text and audio loggers (see Plan Verification commands). Without parallel audio assertions, the symmetric audio branch could silently regress (this is the same precedent that caused `reverse_search` to be untracked by audio logging — see project_notes/bugs.md for prior incident).

**Code changes (`conversation.ts`):**

**Plan-R4 fix — Codex IMP#1 (final):** instead of relying on a P1-only invariant, the response payload carries `priorTurnQuery` as a first-class field on `followUpAttribute` (added to the Zod schema in API Changes section). Step 5 logging reads from `capturedData.followUpAttribute.priorTurnQuery` — unambiguous and works for both P1 (standalone-written) and P2 (refinement-written) prior turn states. No reliance on `prevTurn.query === estimation.query` invariant.

1. In `logQueryAfterReply` function (around line 138): add two new `else if` branches:
   ```
   } else if (intent === 'follow_up_attribute' && capturedData.followUpAttribute) {
     const est = capturedData.followUpAttribute.priorEstimation;
     await writeQueryLog(prisma, {
       queryText: capturedData.followUpAttribute.priorTurnQuery, // Plan-R4 fix — direct field, no invariant dependency
       chainSlug: est.chainSlug ?? null,
       restaurantId: null,
       levelHit: getLevelHit(est),
       cacheHit: true,
       responseTimeMs,
       apiKeyId,
       actorId: actorIdForLog,
       source,
     }, request.log);
   } else if (intent === 'follow_up_refinement' && capturedData.followUpRefinement) {
     const est = capturedData.followUpRefinement.estimation;
     await writeQueryLog(prisma, {
       queryText: capturedData.followUpRefinement.mergedQuery,
       chainSlug: est.chainSlug ?? null,
       restaurantId: null,
       levelHit: getLevelHit(est),
       cacheHit: false,
       responseTimeMs,
       apiKeyId,
       actorId: actorIdForLog,
       source,
     }, request.log);
   }
   ```
2. Extract the inline `getLevelHit` lambda (currently duplicated inside the `comparison` block) into a shared helper within the function scope to avoid triple duplication.
3. Apply the identical changes to `logAudioQueryAfterReply` function (around line 508): same two new branches, same logic.

**Dependencies:** Step 1 (types), Step 4 (pipeline returns new intents).

**Note on `QueryLogEntry` shape:** `writeQueryLog` already accepts `levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null` — no change to `queryLogger.ts` needed for the field mapping. The `levelHit` field in the DB corresponds to the derived `levelLabel` in the spec.

---

#### Step 6 — Bot adapter: `packages/bot/src/handlers/naturalLanguage.ts`

**Test first (`packages/bot/src/__tests__/fMultiturn001.naturalLanguage.unit.test.ts`):**
- Mock `apiClient.processMessage()` returning `intent: 'follow_up_attribute'` with `followUpAttribute: { dishName: 'Paella valenciana', nutrientLabel: 'Carbohidratos', value: 45, unit: 'g', nutrientKey: 'carbohydrates', priorTurnQuery: 'paella valenciana', priorEstimation: {...} }`. (Plan-R5 fix — Codex IMP#2: priorTurnQuery is required per shared schema.)
- Assert return string contains `Paella valenciana`, `Carbohidratos`, `45`, `g` — in MarkdownV2 format (check for `\\.` escaping on special chars if present).
- Mock `apiClient.processMessage()` returning `intent: 'follow_up_refinement'` with `followUpRefinement: { originalQuery: 'paella valenciana', mergedQuery: 'paella valenciana de pollo', estimation: {...} }` (Plan-R6 fix — Codex IMP#1: `originalQuery` is REQUIRED per the FollowUpRefinementData schema).
- Assert return string starts with `_(refinado: paella valenciana de pollo)_` prefix line.
- Assert `formatEstimate` was called with `followUpRefinement.estimation` (can be verified by mocking `formatEstimate` and asserting its argument).
- AC-22: verify neither case reaches the `default` (`_exhaustive: never`) branch.

**Code changes (`naturalLanguage.ts`):**
Add two cases before the `default` branch in the `switch (data.intent)` block:
```typescript
case 'follow_up_attribute': {
  if (!data.followUpAttribute) {
    return 'No se encontraron datos nutricionales para esta consulta\\.';
  }
  const { dishName, nutrientLabel, value, unit } = data.followUpAttribute;
  return `*${escapeMarkdown(dishName)}* — ${escapeMarkdown(nutrientLabel)}: ${escapeMarkdown(String(value))} ${escapeMarkdown(unit)}`;
}

case 'follow_up_refinement': {
  if (!data.followUpRefinement) {
    return 'No se encontraron datos nutricionales para esta consulta\\.';
  }
  const prefix = `_\\(refinado: ${escapeMarkdown(data.followUpRefinement.mergedQuery)}\\)_\n`;
  return prefix + formatEstimate(data.followUpRefinement.estimation);
}
```

**Dependencies:** Step 1 (shared types must be updated first so `ConversationMessageData` includes the new fields; TypeScript will error otherwise).

---

#### Step 7 — Bot adapter: `packages/bot/src/handlers/voice.ts`

**Test first (`packages/bot/src/__tests__/fMultiturn001.voice.unit.test.ts`):**
- Mock `apiClient.sendAudio()` returning `intent: 'follow_up_attribute'` with full `followUpAttribute` data.
- Assert `bot.sendMessage` was called with a string containing the dish name, nutrient label, value, and unit.
- Mock `apiClient.sendAudio()` returning `intent: 'follow_up_refinement'`.
- Assert `bot.sendMessage` was called with a string starting with the refinement prefix.
- AC-23: verify neither case reaches `_exhaustive: never`.

**Code changes (`voice.ts`):**
Add the same two cases as Step 6 to the `switch (data.intent)` block in `handleVoice`. The logic is identical to `naturalLanguage.ts` — copy the two cases verbatim. (If this duplication grows, a shared `formatFollowUp*` helper could be extracted to a formatter file in a future refactor, but for now keep in sync.)

**Dependencies:** Step 1 (shared types), Step 6 (can be done in parallel with Step 6 once Step 1 is done; the two bot files are independent).

---

#### Step 8 — `docs/specs/api-spec.yaml`

**No test (YAML linting via CI `test-api` job).**

Changes to apply (in order within the YAML):
1. In `ConversationIntent` enum (line 5878):
   - Add the three new enum values to the `enum:` list: `reverse_search` (pre-existing gap vs Zod schema), `follow_up_attribute`, `follow_up_refinement`.
   - **Update the multi-line `description:` block** (Plan-R4 fix — Gemini IMP#2) to add three new bullet lines describing each new value. The description block currently enumerates the existing 5 intents; after the fix it must enumerate all 8. Sample additions:
     - `- "reverse_search": Resolves a reverse-search query like "qué como con X kcal" (added to YAML to close pre-existing drift)`
     - `- "follow_up_attribute": Resolves an attribute follow-up to a prior estimation ("y los carbs?", "y la fibra?")`
     - `- "follow_up_refinement": Resolves a refinement of the prior estimation ("hazlo de pollo", "menos cantidad")`
2. After the existing `ConversationContext` component schema (~line 5895), add three new component schemas:
   - `FollowUpAttributeData`: fields `nutrientKey` (enum of 15 nutrient keys), `nutrientLabel` (string), `value` (number, minimum: 0), `unit` (enum: kcal/g/mg), `dishName` (string), `priorTurnQuery` (string, minLength 1, maxLength 255 — **Plan-R5 fix — Codex IMP#1**: required to match the Zod schema after R4-1 added the field), `priorEstimation` ($ref EstimateData). Required: ALL of these (`priorTurnQuery` is REQUIRED, NOT optional, in the shared schema).
   - `FollowUpRefinementData`: fields `originalQuery` (string), `mergedQuery` (string), `estimation` ($ref EstimateData). Note: `portionMultiplierOverride` is intentionally absent (internal server field).
   - `FollowUpMeta`: fields `classifierType` (enum: attribute/refinement), `confidence` (number, min: 0, max: 1), `turnStateHit` (boolean).
3. In `ConversationMessageResponse` component (line 6027): add three **OPTIONAL (NOT nullable) properties** referencing the new schemas (Plan-R2 fix — Codex IMP#2: previous draft used `nullable: true` which contradicts the Zod `.optional()` contract; OpenAPI `nullable` allows `null` values, but the runtime Zod schema rejects `null` and only accepts `undefined`/absent. Use OpenAPI 3.0 OPTIONAL semantics — i.e., omit from `required` array, do NOT set `nullable: true`):
   - `followUpAttribute`: `$ref: '#/components/schemas/FollowUpAttributeData'`, description noting it is present (i.e., key exists in the response) only when intent is `follow_up_attribute`. Field is OPTIONAL — absent for other intents (NOT null).
   - `followUpRefinement`: `$ref: '#/components/schemas/FollowUpRefinementData'`, description noting it is present only when intent is `follow_up_refinement`. OPTIONAL.
   - `followUpMeta`: `$ref: '#/components/schemas/FollowUpMeta'`, description noting it is present for any `follow_up_*` intent. OPTIONAL.

The component's `required` array stays as it currently is (intent + actorId + activeContext only) — none of the three new fields are added to `required`. This matches the Zod `.optional()` semantics in `ConversationMessageDataSchema`.

**Note:** Both `POST /conversation/message` (line 5328) and `POST /conversation/audio` (line 5661) already `$ref: '#/components/schemas/ConversationMessageResponse'` — the new optional fields are inherited automatically with no duplication.

**Maintenance note for developer:** the `nutrientKey` enum values in the YAML must be kept in sync with `EstimateNutrientsSchema.shape` keys (minus `referenceBasis`) in `estimate.ts`. This is a manual maintenance point since YAML cannot derive from TypeScript at parse time.

**Dependencies:** Step 1 (to confirm final list of nutrient keys).

---

### Testing Strategy

**Unit test files (no DB, no Redis — pure mocks):**

| File | What it covers |
|------|---------------|
| `packages/shared/src/__tests__/conversation.schemas.test.ts` | Schema parse/roundtrip for all new Zod schemas. DRY derivation (NutrientKeySchema excludes referenceBasis). |
| `packages/api/src/__tests__/fMultiturn001.turnStateManager.unit.test.ts` | `getTurnState`/`setTurnState`: hit, miss, Redis error (fail-open), TTL value, key format. |
| `packages/api/src/__tests__/fMultiturn001.followUpClassifier.unit.test.ts` | All NUTRIENT_ALIASES groups, pattern coverage for attribute/refinement, `applyRefinement` cases including `portionMultiplierOverride`. AC-01, AC-02, AC-03, AC-14. |
| `packages/api/src/__tests__/f070.conversationCore.unit.test.ts` (extend) | Step 1.5 integration: attribute hit, refinement hit, miss (no turn state), miss (low confidence), miss (null prior result), P1/P2 write-back, no-write for other intents. AC-04 through AC-13, AC-17. |
| `packages/api/src/__tests__/f070.conversation.route.test.ts` (extend) | `logQueryAfterReply` (text route) for both new intents. AC-19 text path. |
| `packages/api/src/__tests__/f075.audio.edge-cases.test.ts` (extend, **Plan-R1 fix — Codex IMP#3**) | `logAudioQueryAfterReply` (audio route) for both new intents. AC-19 audio path — uses async-flush pattern at line 555 of the existing suite. Without this file, the audio branch can silently regress (cf. `reverse_search` historical gap). |
| `packages/bot/src/__tests__/fMultiturn001.naturalLanguage.unit.test.ts` | Both new intent cases in NL handler, exhaustiveness. AC-22. |
| `packages/bot/src/__tests__/fMultiturn001.voice.unit.test.ts` | Both new intent cases in voice handler, exhaustiveness. AC-23. |

**Mocking strategy:**
- `getTurnState` / `setTurnState`: mock via `vi.mock('./turnStateManager.js')` in conversationCore tests.
- `detectAttributeFollowUp` / `detectRefinementFollowUp` / `applyRefinement`: mock via `vi.mock('./followUpClassifier.js')` in conversationCore tests. The classifiers themselves are tested in their own unit file where they run as real code.
- `estimate()` in refinement path: mock via `vi.mock('./estimationOrchestrator.js')`.
- `Redis`: use a `vi.fn()` object implementing `.get()` and `.set()` in turnStateManager tests.
- `bot.sendMessage` / `apiClient`: mock inline per existing bot test patterns.

**No new integration test file is required.** The existing integration test suite (`f070.conversationCore.unit.test.ts` already covers the full pipeline; `f-nlp-chain.conversationCore.integration.test.ts` tests DB-level estimation) is not broken by Step 1.5 (it returns null for `prevTurn` when no Redis key is seeded, so it falls through unchanged — AC-13).

**Key test fixtures:**
- `ConversationTurnState` fixture: use a valid `EstimateDataSchema` object with `result: null` (to test EC-2) and one with `result` non-null (happy paths). Keep fixture data self-contained — no UUID imports from seed namespace needed (pure unit tests).
- Use `result.nameEs = null` in some fixtures to verify `dishName` falls back to `result.name` (AC-05).

---

### Key Patterns

| Pattern | Reference |
|---------|-----------|
| Fail-open Redis get/set | `packages/api/src/conversation/contextManager.ts:34-65` — copy exactly: private key fn, named TTL constant, try/catch returning null on get, swallowed error on set |
| Fire-and-forget Redis write | `conversationCore.ts` pattern for `setContext()` — use `void setTurnState(...).catch(() => {})` |
| Intent switch exhaustiveness | `naturalLanguage.ts:206` and `voice.ts:167` — the `default: { const _exhaustive: never = data.intent }` pattern MUST be preserved; new cases go BEFORE default |
| Query log `getLevelHit` pattern | `packages/api/src/routes/conversation.ts:170-173` (inline lambda) — replicate for both new intent branches |
| Zod enum derivation | `Object.keys(EstimateNutrientsSchema.shape).filter(k => k !== 'referenceBasis') as [string, ...string[]]` — the `as [string, ...string[]]` cast is required because `z.enum` requires a non-empty tuple type |
| Logger structured event | `processMessage` uses `logger` (pino/Fastify request.log) — use `logger.info({...}, 'follow-up classified')` and `logger.debug({...}, 'follow-up classification miss')` |
| `parseDishExpression` before `estimate()` | `conversationCore.ts:316` — always run merged query through `parseDishExpression` before passing to `estimate()` to extract chain slug and portion modifier. BUT: when `portionMultiplierOverride` is set by `applyRefinement`, pass it explicitly to `estimate()` rather than using `parsed.portionMultiplier` — this bypasses double-parsing |

**Gotchas:**

1. **Turn-state write is non-blocking** — never `await setTurnState(...)` inline in the response path. Use `void setTurnState(...).catch(() => {})`. (Note: this is STRICTER than the existing `setContext` pattern, which currently `await`s the call site even though `setContext` swallows errors internally. We adopt the non-blocking pattern explicitly here to keep the response fast-path off Redis. Plan-R1 fix — Codex IMP#2 reconciled the contradiction with the spec text.)

2. **`ConversationTurnState.estimation` is always non-null** (R3-1 fix) — the schema is `estimation: EstimateDataSchema` not `EstimateDataSchema.nullable()`. The "no match" state is carried by `estimation.result` (already nullable in `EstimateDataSchema`). Step 1.5 must check `prevTurn.estimation.result !== null` before extracting nutrient data, not `prevTurn.estimation !== null`.

3. **`NutrientKeySchema` type cast** — `z.enum` requires `[string, ...string[]]` (non-empty tuple). The `Object.keys(...)` call returns `string[]`. A runtime check that the array is non-empty is appropriate before the cast, or alternatively assert at module load time.

4. **YAML enum ordering** — `reverse_search` is currently missing from `ConversationIntent` in `api-spec.yaml` (present in Zod schema since F086 but never added to YAML). Add it in Step 8 along with the two new values. This is a pre-existing gap that this ticket should fix to keep spec in sync.

5. **Bot `followUpMeta` is in scope but optional in response format** — the bot formatters in Steps 6–7 do not need to display `followUpMeta` to the user (it is for observability, not user-facing). The field is present in the API response and type-checked, but formatters can safely ignore it.

6. **`attributeConfidence` boundary**: the spec specifies 0.75 threshold. An exact-pattern regex match should return `confidence: 1.0`. Only fuzzy or partial matches should return lower values. For the initial implementation, all pattern-matched aliases return `1.0` (the simplest correct implementation). Tests must assert `>= 0.75`, not `=== 1.0`, to allow future fuzzy matching refinement.

7. **`applyRefinement` portion-override mapping**: use the same multipliers already defined in `extractPortionModifier` PATTERNS for parity. E.g., `"menos cantidad"` → 0.5, `"más cantidad"` → 1.5, `"una ración pequeña"` → 0.7, `"una ración grande"` → 1.5. Import or duplicate the specific values — do NOT call `extractPortionModifier` from inside `applyRefinement` (circular concern; the function is pure).

---

### Verification commands run

- `Read: packages/shared/src/schemas/conversation.ts:35-44` → `ConversationIntentSchema` has 6 values; `reverse_search` present in Zod but missing from `api-spec.yaml` YAML enum → Step 8 must add `reverse_search` to YAML alongside the two new values (pre-existing gap)
- `Read: packages/shared/src/schemas/estimate.ts:81-99` → `EstimateNutrientsSchema` has exactly 16 fields (15 nutrients + `referenceBasis`); exclusion of `referenceBasis` yields 15 nutrient keys matching spec EC-10 → `NutrientKeySchema` derivation pattern confirmed; `Object.keys(...).filter(k => k !== 'referenceBasis')` is the correct approach
- `Read: packages/shared/src/schemas/estimate.ts:275-284` → `EstimateDataSchema` has `level1Hit`, `level2Hit`, `level3Hit`, `level4Hit` as `z.boolean()` fields directly on `EstimateData` (not on `EstimateResult`) → R3-2 fix confirmed: query log uses `prevTurn.estimation.level{1,2,3,4}Hit` directly, not `prevTurn.estimation.result.level*Hit`
- `Read: packages/shared/src/schemas/estimate.ts:284` → `result: EstimateResultSchema.nullable()` → confirmed `estimation.result` is the nullable field; `estimation` itself is not nullable in `ConversationTurnStateSchema` (R3-1 fix)
- `Read: packages/api/src/conversation/contextManager.ts:1-65` → confirmed pattern: private `CONTEXT_TTL_SECONDS = 7200`, `contextKey(actorId)` helper, `getContext` try/catch returning null, `setContext` try/catch swallowing error, uses `redis.get`/`redis.set` with `'EX'` flag directly (not cacheGet/cacheSet) → `turnStateManager.ts` must follow this exact structure with `TURN_STATE_TTL_SECONDS = 1800` and key `conv:turn:{actorId}`
- `Read: packages/api/src/conversation/conversationCore.ts:87-145` → length guard at line 136; context-set detection starts at line 148; Step 1.5 insertion point confirmed as after line 142 (after the `text_too_long` return block)
- `Read: packages/api/src/conversation/conversationCore.ts:550-572` → standalone estimation success path: `estimate()` returns `estimationResult`, then `return { intent: 'estimation', actorId, estimation: estimationResult, ... }` → P1 turn-state write must be inserted between these two statements, gated on `estimationResult.result !== null`
- `Read: packages/api/src/routes/conversation.ts:138-260` → `logQueryAfterReply` function: chained `if/else if` per intent; `getLevelHit` lambda is inline inside the `comparison` block (line 170-173); must be extracted to a shared helper or duplicated for the two new branches → plan recommends extracting to shared helper to reduce duplication
- `Read: packages/api/src/routes/conversation.ts:508-630` → `logAudioQueryAfterReply` is a separate duplicate of the same logic for the audio route; both must be updated identically (confirmed by reading both functions) → Step 5 covers both
- `Grep: "ConversationMessageResponse" in docs/specs/api-spec.yaml` → 3 hits: line 5328 (`$ref` from message route), line 5661 (`$ref` from audio route), line 6027 (component definition) → confirms both routes reference the same component; adding optional fields to `ConversationMessageResponse` at line 6027 propagates to both endpoints automatically
- `Read: docs/specs/api-spec.yaml:5876-5893` → `ConversationIntent` YAML enum has only 5 values: `context_set`, `comparison`, `menu_estimation`, `estimation`, `text_too_long` — `reverse_search` is missing despite being in Zod schema since F086 → must add `reverse_search` + two new values in Step 8
- `Read: docs/specs/api-spec.yaml:6027-6098` → `ConversationMessageResponse` component confirmed at line 6027; properties end around line 6098; new optional `followUpAttribute`, `followUpRefinement`, `followUpMeta` must be appended before the closing comment → insertion point confirmed
- `Read: packages/bot/src/handlers/naturalLanguage.ts:141-211` → `switch (data.intent)` exhaustive: 6 cases + `default: { const _exhaustive: never = data.intent }` → new cases added before `default`; TypeScript will fail to compile if new enum values are in shared types but not handled here — confirms why adapter changes are in scope
- `Read: packages/bot/src/handlers/voice.ts:98-171` → identical switch structure; same 6 cases + `default` → same fix needed; confirmed both files need identical new cases
- `Read: packages/api/src/conversation/entityExtractor.ts:404-476` → `parseDishExpression` returns `{ query, chainSlug?, portionMultiplier }` → confirmed interface for use in refinement path in Step 4; `portionMultiplier` from parsed output is bypassed when `portionMultiplierOverride` is present
- `Bash: ls packages/api/src/__tests__/ | grep conversation` → existing test files: `f070.conversation.route.test.ts`, `f070.conversationCore.unit.test.ts` → extend both in Steps 4 and 5 rather than creating new files for those scenarios
- `Bash: ls packages/shared/src/__tests__/` → `conversation.schemas.test.ts` exists → extend this file in Step 1 (no new file needed)
- `Read: packages/shared/src/index.ts` → `export * from './schemas/conversation'` confirmed → all new exports from `conversation.ts` (including `NutrientKeySchema`, `ConversationTurnStateSchema`, `FollowUpAttributeDataSchema`, etc.) are automatically re-exported without touching `index.ts`
- `Read: packages/api/src/lib/queryLogger.ts:24-34` → `QueryLogEntry` interface has `levelHit: 'l1' | 'l2' | 'l3' | 'l4' | null` — no new field needed for follow-up intents; `followUpFromQuery` confirmed OUT OF SCOPE (no Prisma migration in this ticket)

---

### Frontend Plan (added by frontend-planner)

> **Scope**: `packages/web` only — `ResultsArea.tsx` intent switch extension + fixture additions + test coverage for AC-20 and AC-21.

---

#### Existing Code to Reuse

| Entity | Location | Role |
|--------|----------|------|
| `NutritionCard` | `packages/web/src/components/NutritionCard.tsx` | Render the full prior estimation card in both new intent cases — pass `estimateData={...}` unchanged |
| `CardGrid` (internal) | `packages/web/src/components/ResultsArea.tsx:264` | Layout wrapper already used by `estimation`, `comparison`, `menu_estimation`, `reverse_search` — reuse for both new cases |
| `EmptyStateWrapper` (internal) | `packages/web/src/components/ResultsArea.tsx:282` | Guard for null data in new cases (same defensive pattern as existing intent guards) |
| `createEstimateData` | `packages/web/src/__tests__/fixtures.ts:67` | Base factory for `priorEstimation` and `followUpRefinement.estimation` fixture values |
| `createEstimateResult` | `packages/web/src/__tests__/fixtures.ts:21` | Used inside new fixtures for nutrient data |
| `createConversationMessageData` | `packages/web/src/__tests__/fixtures.ts:99` | Extended with two new intent branches (see Step F-1) |
| `amber-*` utility classes | `NutritionCard.tsx:131`, `ContextConfirmation.tsx:14` | `border-amber-200 bg-amber-100 text-amber-800` already used in project for callout/highlight treatment — reuse for nutrient highlight banner |
| `brand-orange` token | `tailwind.config.ts:15` | `text-brand-orange` — the calorie value color — already maps to `var(--color-energy)` |
| `brand-green` / `accent-gold` tokens | `tailwind.config.ts:13,20` | Protein/carb colors already in use; no new tokens needed |

---

#### Files to Create

No new component files. All changes are additive modifications to two existing files.

---

#### Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/components/ResultsArea.tsx` | Add `case 'follow_up_attribute':` and `case 'follow_up_refinement':` to the `switch (results.intent)` block. No new imports needed (`NutritionCard` and `CardGrid` are already in scope). |
| `packages/web/src/__tests__/fixtures.ts` | (1) Extend `IntentOverrides` type with `followUpAttribute` and `followUpRefinement` fields. (2) Add `case 'follow_up_attribute':` and `case 'follow_up_refinement':` to `createConversationMessageData`. (3) Export two standalone factory helpers `createFollowUpAttributeData` and `createFollowUpRefinementData` for granular test control. |
| `packages/web/src/__tests__/components/ResultsArea.test.tsx` | Add a new `describe('follow_up_attribute intent')` block and `describe('follow_up_refinement intent')` block with AC-20 and AC-21 tests plus a regression guard. |

---

#### Implementation Order

Each step is a discrete TDD red-green-refactor cycle. Steps are ordered so tests are written before production code changes.

---

##### Step F-1 — Extend fixtures in `packages/web/src/__tests__/fixtures.ts`

**Dependency note (Plan-R1 fix — Codex SUG#1 — type-bridge removed):** Frontend Steps F-1, F-2, F-3 are sequenced AFTER backend Step 1 (shared schema additions). Backend Step 1 ships the `ConversationMessageData['followUpAttribute']` and `['followUpRefinement']` types in `@foodxplorer/shared`; frontend work then consumes them WITHOUT any `@ts-expect-error` or `as any` bridge. The plan no longer uses temporary type suppressions — they are a code smell and unnecessary because steps are sequenced.

**Order constraint:** the implementer MUST complete backend Step 1 (schema extension) and run `npm run build` in `packages/shared` before starting frontend Step F-1. This is documented in the dependency table at the top of `## Implementation Plan`.

**Changes:**

1. Extend the local `IntentOverrides` type (line 90) with:
   ```
   followUpAttribute?: ConversationMessageData['followUpAttribute'];
   followUpRefinement?: ConversationMessageData['followUpRefinement'];
   ```
   These fields are typed in `ConversationMessageData` once backend Step 1 has shipped the shared schema additions. NO type suppressions are used (Plan-R1 fix — Codex SUG#1). The implementer must complete backend Step 1 first.

2. Add factory helper `createFollowUpAttributeData` (export):
   - Default: nutrientKey `'carbohydrates'`, nutrientLabel `'Carbohidratos'`, value `46`, unit `'g'`, dishName `'Big Mac'`, **priorTurnQuery `'big mac'` (Plan-R5 fix — Codex IMP#2: required field)**, priorEstimation: `createEstimateData()`.
   - Accepts `Partial<...>` overrides.
   - Fixture is fully self-contained (no UUID imports from seed data).

3. Add factory helper `createFollowUpRefinementData` (export):
   - Default: originalQuery `'big mac'`, mergedQuery `'big mac de pollo'`, estimation: `createEstimateData({ query: 'big mac de pollo' })`.
   - Accepts `Partial<...>` overrides.

4. Add `case 'follow_up_attribute':` to `createConversationMessageData`:
   ```
   case 'follow_up_attribute':
     return {
       ...base,
       followUpAttribute: overrides.followUpAttribute ?? createFollowUpAttributeData(),
       ...overrides,
     };
   ```

5. Add `case 'follow_up_refinement':` to `createConversationMessageData`:
   ```
   case 'follow_up_refinement':
     return {
       ...base,
       followUpRefinement: overrides.followUpRefinement ?? createFollowUpRefinementData(),
       ...overrides,
     };
   ```

**No test file for fixtures** — factories are validated implicitly by the component tests in Step F-3.

---

##### Step F-2 — Write failing tests in `packages/web/src/__tests__/components/ResultsArea.test.tsx`

Write the tests **before** modifying `ResultsArea.tsx` so they fail red, then pass green after Step F-3.

Add these two `describe` blocks after the existing `'reverse_search intent'` block:

**Block 1: `describe('follow_up_attribute intent')`**

```
it('renders prominent nutrient answer line for follow_up_attribute (AC-20)', () => {
  const results = createConversationMessageData('follow_up_attribute');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  // Nutrient answer line: "{dishName} — {nutrientLabel}: {value} {unit}"
  expect(screen.getByRole('heading', { level: 2, name: /Carbohidratos/i })).toBeInTheDocument();
  // OR — if implemented as a paragraph rather than heading:
  expect(screen.getByText(/Big Mac/)).toBeInTheDocument();
  expect(screen.getByText(/Carbohidratos/)).toBeInTheDocument();
  expect(screen.getByText(/46/)).toBeInTheDocument();
  expect(screen.getByText(/\bg\b/)).toBeInTheDocument();
});

it('renders full NutritionCard from priorEstimation for follow_up_attribute (AC-20)', () => {
  const results = createConversationMessageData('follow_up_attribute');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  // NutritionCard renders the dish name from result.nameEs
  expect(screen.getByText('Big Mac')).toBeInTheDocument();
  // CardGrid region is present (aria-live)
  const region = screen.getByRole('region', { name: /Resultados de la consulta/i });
  expect(region).toBeInTheDocument();
});

it('renders highlighted nutrient row via amber callout (AC-20)', () => {
  const results = createConversationMessageData('follow_up_attribute');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  // The nutrient answer banner carries a data-testid for targeted assertion
  expect(screen.getByTestId('nutrient-answer-banner')).toBeInTheDocument();
});

it('renders EmptyStateWrapper when followUpAttribute data is absent (defensive guard)', () => {
  const results = createConversationMessageData('follow_up_attribute', {
    followUpAttribute: undefined,
  });
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
});
```

**Block 2: `describe('follow_up_refinement intent')`**

```
it('renders NutritionCard for follow_up_refinement (AC-21)', () => {
  const results = createConversationMessageData('follow_up_refinement');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  // NutritionCard renders dish name from estimation.result.nameEs
  expect(screen.getByText('Big Mac')).toBeInTheDocument();
  // CardGrid region present
  expect(screen.getByRole('region', { name: /Resultados de la consulta/i })).toBeInTheDocument();
});

it('renders mergedQuery label above the card for follow_up_refinement (AC-21)', () => {
  const results = createConversationMessageData('follow_up_refinement');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  // Small label: "Refinado: big mac de pollo"
  expect(screen.getByText(/Refinado:/i)).toBeInTheDocument();
  expect(screen.getByText(/big mac de pollo/i)).toBeInTheDocument();
});

it('renders EmptyStateWrapper when followUpRefinement data is absent (defensive guard)', () => {
  const results = createConversationMessageData('follow_up_refinement', {
    followUpRefinement: undefined,
  });
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
});
```

**Block 3: `describe('regression — existing intents unchanged after follow_up cases added')`**

```
it('estimation intent still renders single NutritionCard (regression)', () => {
  const results = createConversationMessageData('estimation');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  expect(screen.getByText('Big Mac')).toBeInTheDocument();
  expect(screen.queryByText(/Refinado:/i)).not.toBeInTheDocument();
  expect(screen.queryByTestId('nutrient-answer-banner')).not.toBeInTheDocument();
});

it('comparison intent still renders two NutritionCards (regression)', () => {
  const results = createConversationMessageData('comparison');
  render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
  expect(screen.getByText('Big Mac')).toBeInTheDocument();
  expect(screen.getByText('Whopper')).toBeInTheDocument();
});
```

---

##### Step F-3 — Implement new cases in `packages/web/src/components/ResultsArea.tsx`

Insert two new cases into the `switch (results.intent)` block, immediately before the `default:` case. No new imports required — `NutritionCard` and `CardGrid` are already imported/defined.

**Also update the file-header comment** (Plan-R2 fix — Gemini SUG) at line 1: change `"Handles: loading, error, empty, all 6 intents"` → `"Handles: loading, error, empty, all 8 intents"` to match the new switch arity.

**`case 'follow_up_attribute':`**

```typescript
case 'follow_up_attribute': {
  const attr = results.followUpAttribute;
  if (!attr) return <EmptyStateWrapper />;
  return (
    <CardGrid>
      <div
        data-testid="nutrient-answer-banner"
        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
          {attr.dishName}
        </p>
        <p className="mt-1 text-2xl font-extrabold leading-none text-amber-800">
          {attr.nutrientLabel}:{' '}
          <span className="text-brand-orange">{attr.value}</span>{' '}
          <span className="text-sm font-semibold">{attr.unit}</span>
        </p>
      </div>
      <NutritionCard estimateData={attr.priorEstimation} />
    </CardGrid>
  );
}
```

**`case 'follow_up_refinement':`**

```typescript
case 'follow_up_refinement': {
  const ref = results.followUpRefinement;
  if (!ref) return <EmptyStateWrapper />;
  return (
    <CardGrid>
      <p className="text-[12px] text-slate-400 px-1">
        <span className="font-semibold text-slate-500">Refinado:</span>{' '}
        {ref.mergedQuery}
      </p>
      <NutritionCard estimateData={ref.estimation} />
    </CardGrid>
  );
}
```

**Visual design rationale (ui-ux-designer engagement assessment):**

The `follow_up_attribute` banner reuses the amber callout pattern already established in `ContextConfirmation.tsx` (amber-50/amber-200/amber-800) and the `NutritionCard` portion pill (amber-100/amber-200/amber-800). This is a consistent visual language for "derived / contextual" information — no new design tokens required. The `brand-orange` color for the numeric value echoes the existing kcal display in `NutritionCard`. **Recommendation: no ui-ux-designer pass is required for this delta.** The treatment is fully covered by existing atomic styles and the amber callout pattern already present in the codebase.

The `follow_up_refinement` label is intentionally minimal — a small secondary-text line that does not compete with the NutritionCard. This matches the `source` footer pattern inside `NutritionCard` (`text-[11px] text-slate-400`). No design escalation needed.

**`'use client'` directive:** `ResultsArea.tsx` is currently a pure presentational Server Component (no `'use client'`). The new cases add no client-side state or event handlers, so no directive change is needed.

---

#### Testing Strategy

**Test file:** `packages/web/src/__tests__/components/ResultsArea.test.tsx` (extend existing — no new file)

**Test scenarios:**

| Scenario | AC | Query / Assert |
|----------|----|----------------|
| `follow_up_attribute` renders nutrient answer banner | AC-20 | `getByTestId('nutrient-answer-banner')` present |
| `follow_up_attribute` renders dish name and nutrient label | AC-20 | `getByText('Big Mac')`, `getByText(/Carbohidratos/)`, `getByText(/46/)` |
| `follow_up_attribute` renders full NutritionCard from priorEstimation | AC-20 | `getByRole('region', { name: /Resultados/ })` present, NutritionCard renders |
| `follow_up_attribute` null-guard renders EmptyState | Defensive | `getByText('¿Qué quieres saber?')` |
| `follow_up_refinement` renders NutritionCard from estimation | AC-21 | `getByText('Big Mac')`, `getByRole('region')` present |
| `follow_up_refinement` renders mergedQuery label | AC-21 | `getByText(/Refinado:/i)`, `getByText(/big mac de pollo/i)` |
| `follow_up_refinement` null-guard renders EmptyState | Defensive | `getByText('¿Qué quieres saber?')` |
| `estimation` intent unchanged (regression) | AC-13 | No `nutrient-answer-banner`, no `Refinado:` text |
| `comparison` intent unchanged (regression) | AC-13 | Both dish names present |

**Mocking strategy:**
- No service or store mocks needed — `ResultsArea` is purely presentational.
- Shared types come from backend Step 1 (sequenced before frontend work). No type suppressions used (Plan-R1 fix — Codex SUG#1).
- Run `tsc --noEmit` in `packages/web` after frontend Step F-3 to confirm no drift.

---

#### Key Patterns

| Pattern | Reference |
|---------|-----------|
| Intent switch guard pattern | `ResultsArea.tsx:191-197` — `const estimation = results.estimation; if (!estimation) return <EmptyStateWrapper />;` — replicate for both new cases |
| `CardGrid` wrapper | `ResultsArea.tsx:264-280` — already used for all card-based renders; wrap both new cases in `<CardGrid>` |
| Amber callout | `ContextConfirmation.tsx:14` — `rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4` — adapt for nutrient answer banner |
| Amber pill (sub-pattern) | `NutritionCard.tsx:131` — `border-amber-200 bg-amber-100 text-amber-800` — the banner uses `bg-amber-50` (lighter) to avoid visual collision when the NutritionCard is rendered immediately below and shows its own amber portion pill |
| `brand-orange` for numeric emphasis | `NutritionCard.tsx:151` — `text-brand-orange` on the kcal value — reuse for the nutrient value inside the banner |
| Secondary label (refinement) | `NutritionCard.tsx:175` — footer `text-[11px] text-slate-400` — match this scale for the "Refinado:" line |
| Defensive `data-testid` | `LoadingState.tsx` (uses `data-testid="skeleton-card"`) — add `data-testid="nutrient-answer-banner"` to the highlight div for targeted test assertions |

**Gotchas:**

1. **`NutritionCard` requires `'use client'`** — it uses `useId()`. Since `ResultsArea` remains a Server Component, the `NutritionCard` child handles its own client boundary automatically. No change needed.

2. **`followUpAttribute` / `followUpRefinement` optional fields** — these are added to `ConversationMessageData` in backend Step 1, which is sequenced BEFORE frontend Step F-1. No type suppressions are needed (Plan-R1 fix — Codex SUG#1). The implementer must wait for backend Step 1 to be in `@foodxplorer/shared` before starting the frontend work.

3. **`data-testid` naming** — use `nutrient-answer-banner` (kebab-case, consistent with `skeleton-card` in `LoadingState.tsx`).

4. **`CardGrid` renders children in a single-column grid** — placing both the banner div and the `NutritionCard` as siblings inside `<CardGrid>` works correctly; they stack vertically on mobile and side-by-side at `md:` breakpoint. This matches how `comparison` renders two cards side by side.

5. **No `aria-live` change needed** — `CardGrid` already carries `role="region" aria-live="polite"`, so new intent results announced correctly to screen readers with no additional changes.

---

#### Verification Commands Run

- `Read: packages/web/src/components/ResultsArea.tsx:1-289` → current switch has 5 handled cases (`estimation`, `comparison`, `menu_estimation`, `context_set`, `reverse_search`) + `default` → new cases inserted before `default`; comment at line 1 says "Handles: loading, error, empty, all 6 intents" — **Plan-R2 fix — Gemini SUG**: Step F-3 must include updating this comment from "all 6 intents" to "all 8 intents" (file-header sync with the actual switch cases).
- `Read: packages/web/src/components/NutritionCard.tsx:1-273` → `NutritionCard` already imported at `ResultsArea.tsx:13`; accepts `estimateData: EstimateData` (standard path) or `reverseResult: ReverseSearchResult` — both new cases pass `estimateData`, no change to `NutritionCard` itself
- `Read: packages/web/src/__tests__/components/ResultsArea.test.tsx:1-393` → test file uses `createConversationMessageData` factory with intent overrides; existing pattern: `createConversationMessageData('estimation', { estimation: createEstimateData({...}) })` → new fixture pattern is consistent: `createConversationMessageData('follow_up_attribute', { followUpAttribute: createFollowUpAttributeData({...}) })`
- `Read: packages/web/src/__tests__/fixtures.ts:90-183` → `IntentOverrides` type (line 90) and `createConversationMessageData` switch (lines 109-183) are the extension points; `case 'text_too_long': return { ...base, ...overrides }` and `default: return { ...base, ...overrides }` currently serve as fall-through for unrecognised intents → add explicit cases before `default` for type safety
- `Grep: "followUpAttribute\|followUpRefinement\|follow_up" in packages/web/src/__tests__/fixtures.ts` → NOT FOUND → confirmed no follow_up fixtures exist yet; Step F-1 creates them from scratch
- `Grep: "followUpAttribute\|followUpRefinement\|follow_up" in packages/shared/src/schemas/conversation.ts` → NOT FOUND → confirmed shared types do not yet include new fields. **Plan-R2 fix — Codex SUG#3**: this verification note used to say "@ts-expect-error bridge required until backend Step 1 merges". That contradicted the Plan-R1 fix (no type bridges; sequence steps). Stale wording removed. Backend Step 1 lands the schemas FIRST, then frontend Step F-1 consumes them with no suppressions.
- `Read: packages/web/src/components/ContextConfirmation.tsx:1-33` → amber callout: `rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800` → confirmed amber-50/200/800 token set is in-use and renders correctly without new Tailwind config entries
- `Read: packages/web/src/components/NutritionCard.tsx:131` → portion pill: `border-amber-200 bg-amber-100` → nutrient banner uses `bg-amber-50` (one step lighter) to visually differentiate the banner from the card's amber pill below it
- `Bash: grep -n "brand-orange\|brand-green\|accent-gold" packages/web/tailwind.config.ts` → tokens present: `brand-orange: var(--color-energy, #FF8C42)`, `brand-green: var(--color-botanical, #2D5A27)`, `accent-gold: var(--color-accent-gold, #D4A843)` → all used in new cases are already defined; no new tokens needed
- `Bash: grep -n "'use client'" packages/web/src/components/ResultsArea.tsx` → only comment "Pure presentational — no 'use client' needed" at line 6 → new intent cases add no state or event handlers; directive stays absent
- `Read: packages/web/src/components/ResultsArea.tsx:264-280` → `CardGrid` is a file-internal function (not exported), receives `children: React.ReactNode`, renders a single-column / 2-col grid — confirmed wrapping both banner + NutritionCard as siblings inside `<CardGrid>` is valid
- `Bash: grep -n "data-testid" packages/web/src/components/LoadingState.tsx` → `data-testid="skeleton-card"` at line 56 → naming convention is kebab-case; `nutrient-answer-banner` is consistent

---

## Acceptance Criteria

### Classifier — standalone vs follow-up

- [x] **AC-01** `detectAttributeFollowUp()` correctly classifies Spanish attribute follow-up phrases: "y los carbs?", "y la proteína?", "cuánta fibra tiene?", "y la sal?", "dame las grasas". Returns `null` for standalone queries ("paella valenciana", "big mac", "estoy en mcdonalds").
- [x] **AC-02** `detectRefinementFollowUp()` correctly classifies Spanish refinement phrases: "hazlo de pollo en vez de cerdo", "menos cantidad", "sin azúcar", "una ración pequeña". Returns `null` for standalone queries and for attribute follow-ups ("y los carbs?").
- [x] **AC-03** Both classifier functions are pure and synchronous — they accept a string and return a result with no I/O, no async, no side effects. Verified by unit tests that run without a Redis or DB connection.

### Attribute follow-up — happy path

- [x] **AC-04** When `conv:turn:{actorId}` holds a valid prior estimation for "paella valenciana" and the user sends "y los carbs?", the response has `intent: 'follow_up_attribute'`, `followUpAttribute.nutrientKey === 'carbohydrates'`, and `followUpAttribute.value` matches the carbohydrate value from the prior `EstimateData`. No estimation cascade call is made.
- [x] **AC-05** `followUpAttribute.dishName` is populated from `priorEstimation.result.nameEs ?? priorEstimation.result.name`. `followUpAttribute.unit` is `'g'` for carbohydrates, `'kcal'` for calories, `'mg'` for sodium/cholesterol/potassium.
- [x] **AC-06** `followUpAttribute.priorEstimation` contains the full prior `EstimateData` so the client can render a complete NutritionCard if desired.

### Refinement — happy path

- [x] **AC-07** When `conv:turn:{actorId}` holds a prior estimation for "paella valenciana" (chainSlug: null) and the user sends "hazlo de pollo en vez de cerdo", the response has `intent: 'follow_up_refinement'`, `followUpRefinement.originalQuery === 'paella valenciana'`, `followUpRefinement.mergedQuery` contains a query string incorporating the protein swap, and `followUpRefinement.estimation` is a valid `EstimateData` from the estimation cascade. For portion-only modifications (e.g., "menos cantidad"), `applyRefinement()` returns `{ mergedQuery: originalQuery, portionMultiplierOverride: 0.5 }` and the cascade is invoked with the explicit override (verified by unit test asserting `estimate()` was called with `portionMultiplier: 0.5`).
- [x] **AC-08** After a successful refinement, `conv:turn:{actorId}` is updated to reflect the new query and estimation result. A subsequent "y los carbs?" resolves against the refined dish, not the original.

### No-context graceful fallback (EC-1, EC-4)

- [x] **AC-09** When `conv:turn:{actorId}` does not exist in Redis (new chat, expiry, or Redis miss), attribute and refinement follow-up phrases are treated as standalone estimation queries. The response has `intent: 'estimation'` (or other appropriate intent). No error is returned to the caller.
- [x] **AC-10** When the prior turn had `estimation.result === null` (estimation miss), a subsequent attribute follow-up returns `intent: 'estimation'` (standalone fallback), not `intent: 'follow_up_attribute'` with undefined data.

### Turn state write-back

- [x] **AC-11** `conv:turn:{actorId}` is written to Redis with TTL `TURN_STATE_TTL_SECONDS` (1800 s, exported named constant) in exactly two cases: (a) `intent: 'estimation'` with non-null `estimation.result` (P1); (b) `intent: 'follow_up_refinement'` regardless of whether `estimation.result` is null (P2). Verified by unit tests that mock Redis and assert `setex`/`set` call for each case, including the null-result P2 case (EC-8).
- [x] **AC-12** `conv:turn:{actorId}` is NOT written for `intent: 'menu_estimation'`, `'comparison'`, `'context_set'`, `'reverse_search'`, `'text_too_long'`, or `'follow_up_attribute'`. Verified by unit tests asserting no `set`/`setex` call on Redis mock for each of these intents.

### No regressions on existing standalone flows

- [x] **AC-13** All existing unit tests for `processMessage()` (standalone estimation, comparison, menu_estimation, context_set, reverse_search, text_too_long) pass without modification. The new Step 1.5 is a pure fast-path guard that exits immediately when `prevTurn` is null — existing test fixtures that do not seed `conv:turn` produce null and fall through unchanged.

### Spanish language coverage

- [x] **AC-14** NUTRIENT_ALIASES map covers at minimum: calorías/kcal/cal/energía → calories; proteínas/proteína/prot → proteins; carbohidratos/carbs/hidratos/hc → carbohydrates; azúcar/azúcares → sugars; grasas/grasa → fats; fibra → fiber; sal → salt; sodio → sodium. Verified by unit tests against each alias group.

### Schemas and specs

- [x] **AC-15** `ConversationTurnStateSchema` is added to `packages/shared/src/schemas/conversation.ts`. `ConversationIntentSchema` is updated to include `'follow_up_attribute'` and `'follow_up_refinement'`. `ConversationMessageDataSchema` is updated with the three new optional fields (`followUpAttribute`, `followUpRefinement`, `followUpMeta`). `followUpAttribute.nutrientKey` is derived from `EstimateNutrientsSchema.shape` (excluding `referenceBasis`) — no hardcoded enum. All Zod schemas parse correctly and TypeScript strict-mode build succeeds.
- [x] **AC-16** `docs/specs/api-spec.yaml` is updated: `ConversationIntent` enum includes the two new values; `FollowUpAttributeData`, `FollowUpRefinementData`, and `FollowUpMeta` component schemas are added and referenced from the existing `ConversationMessageResponse` component (NOT a separate `ConversationMessageData` component — the YAML name differs from the Zod schema name). Both `POST /conversation/message` and `POST /conversation/audio` inherit the additions automatically via the shared component reference.

### Observability

- [x] **AC-17** Each follow-up classification emits **exactly one** structured log event (R2 fix — Codex SUGGESTION resolved to single-event model): on a HIT, an `info`-level event with `tag: 'F-MULTITURN-001'`, `classifierType`, `confidence`, `turnStateHit`, plus optional `nutrientKey` (attribute) or `originalQuery`+`mergedQuery` (refinement). On a MISS, a `debug`-level event with `tag: 'F-MULTITURN-001:miss'` and `reason` (`'no_turn_state'` | `'low_confidence'` | `'no_match'`). HIT and MISS are mutually exclusive — never both fire for the same classification call.

### Build and quality gates

- [x] **AC-18** All unit tests pass (`vitest run`). Build succeeds with zero TypeScript errors (`tsc --noEmit`). No new ESLint warnings or errors.

### Query logging

- [x] **AC-19** `queryLogger.ts` captures both new intents per the defined policy: `follow_up_attribute` logs with `intent: 'follow_up_attribute'`, `queryText: prevTurn.query`, `cacheHit: true`, derived `levelLabel` re-computed from `prevTurn.estimation.level{1,2,3,4}Hit` flags (R3 fix — flags live on `EstimateData`); `follow_up_refinement` logs with `intent: 'follow_up_refinement'`, `queryText: mergedQuery`, `cacheHit: false`, derived `levelLabel` from cascade response `EstimateData.level{1,2,3,4}Hit` flags. NO new column added to `query_logs` table (rigid Prisma shape; `followUpFromQuery` deferred per Query Logging section). Verified by unit test on `queryLogger.ts`.

### Web adapter rendering

- [x] **AC-20** `packages/web/src/components/ResultsArea.tsx` renders `intent: 'follow_up_attribute'` by displaying the requested nutrient value (label + value + unit) highlighted, with the full prior NutritionCard available via `followUpAttribute.priorEstimation`. The component does not render `<EmptyState>` for this intent.
- [x] **AC-21** `packages/web/src/components/ResultsArea.tsx` renders `intent: 'follow_up_refinement'` by passing `followUpRefinement.estimation` to `<NutritionCard>` — equivalent to the `estimation` case. TypeScript strict build must pass (no unhandled branches in the switch).

### Bot adapter formatting

- [x] **AC-22** `packages/bot/src/handlers/naturalLanguage.ts` handles `intent: 'follow_up_attribute'` by returning a Telegram MarkdownV2 string containing the dish name, nutrient label, value, and unit (e.g., "Paella valenciana — Carbohidratos: 45 g"). Handles `intent: 'follow_up_refinement'` by delegating to `formatEstimate(data.followUpRefinement.estimation)` with a prefixed refinement note. No `_exhaustive: never` throw for either intent.
- [x] **AC-23** `packages/bot/src/handlers/voice.ts` handles both new intents with the same logic as AC-22 (`naturalLanguage.ts`). The switch exhaustiveness check in `voice.ts` also passes — both intents are handled.

### Nutrient key DRY

- [x] **AC-24** `followUpAttribute.nutrientKey` schema in `conversation.ts` is derived from `EstimateNutrientsSchema.shape` at schema definition time (excluding `referenceBasis`). No hardcoded array of nutrient key strings appears in `conversation.ts`. Verified by code review: if a new nutrient is added to `EstimateNutrientsSchema`, `followUpAttribute.nutrientKey` automatically accepts it without any change to `conversation.ts`.

- [x] **AC-25** (Plan-R4 fix — Codex IMP#1) `followUpAttribute.priorTurnQuery` is populated with the exact `prevTurn.query` from the loaded turn state — NOT derived from `prevTurn.estimation.query`. Verified by unit tests asserting `response.followUpAttribute.priorTurnQuery === storedTurnState.query` for both P1-written turn states (standalone estimation) AND P2-written turn states (refinement). Step 5 logging reads `queryText` from `priorTurnQuery` directly.

- [x] **AC-26** (Plan-R4 fix — Codex IMP#2) Refinement preserves prior turn's `chainSlug`. When `prevTurn.chainSlug === null` (generic prior turn) and the user has since set a chain context (`conv:ctx.chainSlug !== null`), the refinement re-estimation uses `chainSlug: null`, NOT the current context. Verified by unit test seeding: prevTurn with `chainSlug: null` + active context with `chainSlug: 'mcdonalds'` + refinement query → assert `estimate()` called with `chainSlug: null`.

---

## Definition of Done

- [x] All acceptance criteria met (AC-01 through AC-26)
- [x] Unit tests written and passing (api 4415, shared 624, bot 1237, web 499; scraper 1221 + landing 232 untouched)
- [x] E2E tests updated (if applicable) — N/A: feature is server-internal + frontend rendering
- [x] Code follows project standards (lint 0, typecheck clean)
- [x] No linting errors
- [x] Build succeeds (root npm run build green)
- [x] Specs reflect final implementation (api-spec.yaml updated; ticket Spec section authoritative)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated. /review-spec 4 rounds (Codex + Gemini); both APPROVED at R4.
- [x] Step 1: Branch created (`feature/F-MULTITURN-001-multi-turn-followup`), ticket generated, tracker updated.
- [x] Step 2: `backend-planner` + `frontend-planner` executed. /review-plan 6 rounds (Codex + Gemini); 20 findings addressed; APPROVED for implementation.
- [x] Step 3: `backend-developer` + `frontend-developer` executed with TDD. 11 commits, ~1,520 LoC (production+tests).
- [x] Step 4: `production-code-validator` executed (REQUEST CHANGES → 1 BLOCKER + 1 MAJOR + 2 MINORs; BLOCKER+MAJOR fixed inline `7f42fa3`). Quality gates: lint 0, typecheck clean, build clean, npm test 6741 tests across workspaces.
- [x] Step 5: `code-review-specialist` executed — APPROVE WITH MINOR (1 MAJOR + 3 MEDIUM + NITs); MAJOR fixed inline in `ebb6117`.
- [x] Step 5: `qa-engineer` executed (Standard) — PASS WITH FOLLOW-UPS (1 IMPORTANT NFD + 2 MINOR; NFD fixed inline in `ebb6117`; +34 edge-case tests).
- [x] Step 6: Ticket updated with final metrics; branch squash-merged at `45aabea` via PR #252 + deleted local + remote.

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
| 2026-05-06 | Step 2 backend-planner + frontend-planner | Implementation plan written: 8 backend steps + 3 frontend steps. ~410 LoC production + ~510 LoC tests estimated. |
| 2026-05-06 | Step 2 /review-plan R1 | Gemini APPROVED (1 SUG); Codex REVISE (3 IMP + 1 SUG). 4 findings addressed |
| 2026-05-06 | Step 2 /review-plan R2 | Gemini APPROVED (1 SUG); Codex REVISE (2 IMP + 1 SUG). 4 findings addressed |
| 2026-05-06 | Step 2 /review-plan R3 | Codex APPROVED (1 IMP); Gemini REVISE (1 IMP). 2 findings addressed for unanimity |
| 2026-05-06 | Step 2 /review-plan R4 | Both REVISE (4 IMP total). 4 findings addressed |
| 2026-05-06 | Step 2 /review-plan R5 | Gemini APPROVED; Codex REVISE (2 IMP). 2 findings addressed |
| 2026-05-06 | Step 2 /review-plan R6 | Gemini APPROVED (1 IMP); Codex REVISE (2 IMP). 3 findings addressed |
| 2026-05-06 | Step 2 closed | Plan APPROVED for implementation based on 6-round trail. 20 findings addressed total. 26 ACs (AC-01 through AC-26). Ready for Step 3 implementation. |
| 2026-05-06 | Step 3 backend-developer | 8 commits implementing Steps 1-8 of plan. ~1,480 LoC (production + tests). All package tests pass: shared 624, api 4379, bot 1237. |
| 2026-05-06 | Step 3 frontend-developer | 3 commits implementing Steps F-1, F-2, F-3 of plan. ~170 LoC. Web tests: 489 → 499 (+10). |
| 2026-05-06 | Step 4 quality gates | npm run lint 0 errors. npm run typecheck clean. npm run build clean (all workspaces). npm test green: shared 624 + api 4379 + bot 1237 + web 499 = 6739 tests. |
| 2026-05-06 | Step 4 production-code-validator | REQUEST CHANGES (1 BLOCKER + 1 MAJOR + 2 MINORs). BLOCKER (AC-26 chainSlug preservation test missing) + MAJOR (classifier defensive length guard) fixed inline `7f42fa3`. MINORs accepted (label drift; threshold-as-constant). api tests 4379 → 4381 (+2). |
| 2026-05-06 | Step 5 PR opened | PR #252 against develop. CI green at `bf65be2`: changes/ci-success/test-* all pass. |
| 2026-05-06 | Step 5 code-review-specialist | APPROVE WITH MINOR (1 MAJOR + 3 MEDIUM + NITs). MAJOR-1 fixed inline (`ebb6117`): replaced dead-code NUTRIENT_ALIASES lookup with new NUTRIENT_META_BY_KEY canonical-key map. MEDIUM-1/3 (Spanish accent boundaries; case-insensitive replace) accepted as known minor edge-case behaviour. MEDIUM-2 (test-label drift in 4-branch description) accepted. NITs (api-spec field length docs) accepted. |
| 2026-05-06 | Step 5 qa-engineer | PASS WITH FOLLOW-UPS. IMPORTANT (NFD Unicode normalization for accented Spanish input from mobile keyboards) fixed inline (`ebb6117`): `.normalize('NFC')` added to both classifiers' input boundaries. MINOR (AC-12 negative test gap; documented branch-ordering EC-5b clarification) accepted. +34 new edge-case tests in `fMultiturn001.edge-cases.test.ts` covering empty/whitespace/length-guard/compound queries/chitchat/applyRefinement edge cases. api tests 4381 → 4415 (+34). |
| 2026-05-06 | Step 5 review-fix commit | `ebb6117` consolidated review fixes: NUTRIENT_META_BY_KEY (code-review MAJOR-1) + NFD normalization (qa IMPORTANT) + 34 edge-case tests (qa). Test mock for followUpClassifier updated. Lint 0, typecheck clean, all tests pass. |
| 2026-05-06 | Step 5 close + audit-merge | Status → Ready for Merge, Workflow Step 5 boxes [x], Merge Checklist Evidence 8/8 [x] (commit `0feacbe`). Tracker Features row pending → in-progress 5/6 (commit `d87e41f`). audit-merge structural 11/11 + drift CLEAN. CI green at `d87e41f`. |
| 2026-05-06 | Step 6 squash-merge | PR #252 squash-merged to develop at `45aabea`. 17 commits collapsed (4 docs + 8 backend + 3 frontend + 2 review-fix). Branch deleted local + remote. |
| 2026-05-06 | Step 6 housekeeping | Status → Done. Tracker Features row → done 6/6. Active Session cleared. pm-session.md F-MULTITURN-001 moved to Completed. |
| 2026-05-07 | External audit (post-merge) | APPROVE WITH NOTES from external agent. Structural 11/11 PASS. Code spot-checks PASS (4-branch order, chainSlug preservation, non-blocking writes all confirmed). 5 documentation findings reported: F1 PR #252 body cites "api 4272→4381 (+109)" — stale (true terminal is 4415 after `ebb6117`); accepted-as-lost (closed PRs not edited). F2-F5 fixed in chore docs commit (this entry). Note: `/audit-merge` v0.18.1 P1/P7 recipes failed to detect drift because the format `X → Y (+N)` (arrow) was not matched by the `X/Y` (ratio) regex — pre-existing library bug, queue for v0.18.3 upstream fix. |
| 2026-05-07 | Audit-driven doc drift fixes | DoD line refreshed (4381 → 4415). MCE Action 1 narrative updated (Workflow 7/8 → 8/8 post-merge). Tracker Last Updated header clarified (full workspace total 8,228 vs feature delta). Tracker F-MULTITURN-001 row clarified bot test counting methodology drift (1237 reflects re-count, ~55 from this feature). |
| 2026-05-07 | Production smoke test post-release | PASS — release PR #256 squash-merged to main at `7154b2f`. Operator (user) confirmed all post-release actions on prod: `/hablar` text *"paella valenciana"* → card with kcal/macros; *"y los carbs?"* → highlight banner without re-cascade (chainSlug preserved); *"hazlo de pollo en vez de cerdo"* → re-estimate as lomo de pollo (REPLACE branch fired correctly). Telegram bot: same patterns confirmed. Library upgrade (sdd-devflow-pb v0.18.2) merged in develop via PR #258 (entry added retroactively per external auditor 2026-05-07 — `2026-05-0X` placeholder). |

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence. Plus four review-trail subsections (Spec R1+R2+R3+R4 + Plan R1+R2+R3+R4+R5+R6) preserved as audit trail. |
| 1. Mark all items | [x] | AC: 26/26 [x]. DoD: 7/7 [x]. Workflow: 8/8 [x] (Step 6 [x] post-merge — squash at `45aabea` + housekeeping at `4ef8c40`). |
| 2. Verify product tracker | [x] | Active Session updated to F-MULTITURN-001 step 5/6 + branch + Pick A context. Features table row F-MULTITURN-001 in pm-conv-polish section, status `in-progress`, step 5/6. |
| 3. Update key_facts.md | [x] | N/A — feature is server-internal additions to existing modules; new files are within the established `packages/api/src/conversation/` subsystem (turnStateManager.ts + followUpClassifier.ts) following the `contextManager.ts` pattern. No new infra worth a Reusable Components row at this point; if future work depends on `NUTRIENT_META_BY_KEY` or `applyRefinement()` semantics outside this feature, add the row then. |
| 4. Update decisions.md | [x] | N/A — no new ADR. The architectural choices (single new Redis key with shorter TTL, non-blocking turn-state writes, intent-based discriminant for response shape) follow established project patterns (ADR-009 conversation state; ADR-018 fail-open Redis). |
| 5. Commit documentation | [x] | Step 5+ docs committed in `bf65be2` (Step 3+4 close, ACs/DoD marked) and `ebb6117` (review fixes). Latest commit on branch HEAD. |
| 6. Verify clean working tree | [x] | `git status` clean: no uncommitted changes after the Step 5 review-fix commit `ebb6117`. To be re-verified just before user authorization. |
| 7. Verify branch up to date | [x] | Branch base commit at `c4c3a32` (develop tip when branched). develop has not advanced since (no other PRs merged after #251). `git merge-base --is-ancestor origin/develop HEAD` = UP TO DATE. |

---

*Ticket created: 2026-05-06*
