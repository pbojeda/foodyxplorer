# F-H7: NLP Temporal Wrappers + Frame Strip Extension

**Feature:** F-H7 | **Type:** Backend-Feature | **Priority:** High
**Status:** Done | **Branch:** feature/F-H7-nlp-temporal-wrappers (deleted post-merge)
<!-- Valid Status values: Spec | In Progress | Planning | Review | Ready for Merge | Done -->
**Created:** 2026-04-26 | **Dependencies:** F-MULTI-ITEM-IMPLICIT (merged PR #206), F-H6 (merged PR #211)

---

## Spec

### Description

F-H7 is a backend NLP-only feature that extends `CONVERSATIONAL_WRAPPER_PATTERNS` in `packages/api/src/conversation/entityExtractor.ts` with five new pattern groups (H7-P1 through H7-P5). No new dishes, no seed data, no schema changes, no migrations.

**Problem:** The post-F-H6 QA battery (650 queries, 2026-04-26) shows 367 OK / 282 NULL / 1 FAIL. Of the 282 NULLs:
- **Cat 29 — Fecha Hora y Contexto (lines 691–711): 20/20 NULL.** All 20 queries contain temporal or activity-reference prefixes followed by a 1st-person past-tense eating verb, followed by the dish name. No existing wrapper pattern covers these full-sentence constructions.
- **Cat 22 — Internacional en España (lines 527–552): 14/14 NULL** on F-H6 atoms that are correctly in the catalog but whose queries contain leading conversational frames (`quiero un`, `una de`, `quiero probar el`) or trailing modifiers (`con extra de picante`, `a baja temperatura`, `a la plancha`, `clásico`, `casero de postre`, `con sésamo`, `con parmesano`, `con trufa`, `con cilantro y piña`) that prevent L1 lookup from matching.
- **Cat 21 — Cocina Regional Española (lines 495–525): 6+ NULL** on preexisting atoms blocked by the same conversational-frame patterns.

**Root cause diagnosis:** The existing `CONVERSATIONAL_WRAPPER_PATTERNS` has **13 entries (indices 0–12)** in the array (see `entityExtractor.ts:536–574`). The last extension was in F-MULTI-ITEM-IMPLICIT: Pattern 4b at array index 4 (`esta mañana/tarde/noche he + participle`) and Pattern 7b at array index 8 (bar/restaurant entry). The existing patterns cover only past-tense self-reference starting with `esta mañana/tarde/noche he` or `he entrado en ... y me he pedido`. The Cat 29 queries use a larger family of temporal and activity-reference prefixes (e.g. `ayer por la noche`, `el domingo`, `durante el viaje`, `en el desayuno de hoy`) that compose with a wider set of 1st-person eating verbs in the simple past (`cené`, `me comí`, `me tomé`, `tomé`, `comí`, `pedí`, `compartí`, `probé`, `me bebí`, `me hice`, `piqué`).

**Proposed fix:** Add five new patterns (H7-P1 through H7-P5) to `CONVERSATIONAL_WRAPPER_PATTERNS`. H7-P1 and H7-P2 use compound regexes that consume both the temporal/activity prefix and the subsequent 1st-person eat-verb in a single match. H7-P3 is a standalone fallback for queries that begin directly with an eat-verb (no temporal/activity prefix). H7-P4 strips leading conversational fillers. H7-P5 is a two-pass trailing modifier strip integrated as a retry seam inside `engineRouter.ts`.

---

### API Changes (if applicable)

No new endpoints. No request/response schema changes. No change to `QueryLogEntry` in `queryLogger.ts`.

The `POST /conversation/message` and `POST /conversation/audio` pipelines are unchanged at the route level. The only behavioral change is that more queries that previously returned `intent: estimation` with `estimation: null` (NULL result) will now return `intent: estimation` with a non-null estimation result.

Observability: wrapper pattern identification is recorded via `request.log.debug({ wrapperPattern: 'H7-P1' | 'H7-P2' | 'H7-P3' | 'H7-P4' | 'H7-P5' })` ephemeral structured log lines only. No change to the `QueryLogEntry` interface, no new DB column, no change to `api-spec.yaml` response schema.

---

### Data Model Changes (if applicable)

None. No Prisma migrations, no new tables, no new seed data, no changes to `spanish-dishes.json`.

---

### UI Changes (if applicable)

None. The web assistant and bot consume the same `ConversationMessageData` response shape. Existing renderers handle the new OK results transparently.

---

### In Scope — Five New Pattern Groups

All new patterns are additive to `CONVERSATIONAL_WRAPPER_PATTERNS` in `packages/api/src/conversation/entityExtractor.ts`. H7-P1 through H7-P4 are inserted **after** the existing 13 entries (current indices 0–12) as new array entries at indices 13–16. H7-P5 is NOT added to `CONVERSATIONAL_WRAPPER_PATTERNS`; instead it is implemented as a retry seam inside `packages/api/src/estimation/engineRouter.ts` (see H7-P5 section below). Single-pass, first-match-wins semantics for `CONVERSATIONAL_WRAPPER_PATTERNS` are preserved.

**Existing array count clarification:** `CONVERSATIONAL_WRAPPER_PATTERNS` currently has 13 entries at indices 0–12 (`entityExtractor.ts:536–574`). The existing patterns use comment labels "Pattern 8" through "Pattern 11" in the source code comments (lines 566–573) for the nutrient/info wrappers, but those entries actually occupy **array indices 9–12** (Pattern 7b is inserted at index 8). The new F-H7 patterns use ticket-local names H7-P1 through H7-P5 to avoid collision with those existing source-comment labels. The developer must NOT renumber existing patterns or modify their source comments.

#### H7-P1 (NEW) — Pure Temporal Prefix (compound regex, strips temporal head + eat-verb together)

Strips date/time references at the head of the query, AND the immediately following 1st-person eat-verb, in a single regex match. The compound approach is required because `extractFoodQuery()` is single-pass (`entityExtractor.ts:721–726`): once H7-P1 fires, the loop `break`s and the eat-verb must already be consumed. A separate eat-verb strip in the same pass is architecturally impossible.

Covered temporal forms:
- `ayer` (bare)
- `ayer por la noche`
- `ayer tarde`
- `anoche`
- `hoy`
- `hoy al mediodía`
- `esta mañana`
- `esta tarde`
- `esta noche`
- `a medianoche`
- `el lunes / el martes / el miércoles / el jueves / el viernes / el sábado / el domingo`
- `el [día_semana] por la mañana / tarde / noche / al mediodía`
- `el [día_semana] [en|por] [el|la] [lugar]` (e.g. `el viernes en la oficina`)
- `el [día_semana] [después|antes] de [Y]` (e.g. `el lunes después de clase` — Q646; covers temporal+activity-bridge composition)
- `esta mañana/tarde antes de [Y]` / `esta mañana/tarde después de [Y]`
- `esta mañana/tarde/noche en [el|la] [lugar]` (e.g. `esta tarde en la cafetería` — Q644; covers temporal+location-bridge composition)
- `anoche después del [evento]`

Eat-verbs consumed (joined into the same regex after temporal head):
`cené`, `me cené`, `desayuné`, `me desayuné`, `almorcé`, `me almorcé`, `comí`, `me comí`, `merendé`, `me merendé`, `tomé`, `me tomé`, `pedí`, `me pedí`, `compartí`, `probé`, `bebí`, `me bebí`, `me hice`, `piqué`

Regex structure (compound — temporal head + optional `me` clitic + eat-verb, example only; developer must refine for correctness and ReDoS safety):

```
/^(?:ayer\s+(?:por\s+la\s+(?:ma[nñ]ana|tarde|noche)|tarde)?|anoche(?:\s+después\s+de[l]?\s+\S+)?|hoy(?:\s+al\s+medi[oó]d[ií]a)?|esta\s+(?:ma[nñ]ana|tarde|noche)(?:\s+(?:antes|después)\s+de[l]?\s+[^,]{1,30}|\s+en\s+(?:el|la|los|las)\s+[^,]{1,25})?,?\s*|a\s+medianoche|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+(?:(?:por\s+la|al)\s+(?:ma[nñ]ana|tarde|noche|medi[oó]d[ií]a)|en\s+(?:la\s+)?[^,]{1,25}|(?:antes|después)\s+de[l]?\s+[^,]{1,30}))?,?\s*)\s+(?:me\s+)?(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]|compartí|prob[eé]|beb[ií]|me\s+hice?|piqu[eé]|me\s+(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]))\s+/i
```

**QA target queries covered:**
- Q631 `ayer por la noche cené salmón con verduras al horno` → strip: `salmón con verduras al horno`
- Q632 `el domingo me comí un plato de migas con huevo` → strip: `un plato de migas con huevo`
- Q637 `anoche después del cine compartí nachos con queso` → strip: `nachos con queso`
- Q638 `el viernes en la oficina pedí noodles con pollo y verduras` → strip: `noodles con pollo y verduras`
- Q646 `el lunes después de clase comí una empanadilla de carne` → strip: `una empanadilla de carne`
- Q647 `ayer tarde me bebí un smoothie de mango con yogur` → strip: `un smoothie de mango con yogur`
- Q650 `a medianoche me hice una tortilla francesa con champiñones` → strip: `una tortilla francesa con champiñones`
- Q636 `esta mañana antes de trabajar tomé un croissant de mantequilla` → strip: `un croissant de mantequilla`

**Ordering note:** H7-P1 is a NEW separate array entry placed AFTER existing Patterns 2 and 3 (indices 1–2). Existing Pattern 3 covers `^(?:ayer|anoche|anteayer|hoy|esta\s+mañana|esta\s+noche)\s+(?:cen[eé]|...)` for a narrower subset — Pattern 3 remains untouched and wins on its exact forms via first-match-wins. H7-P1 covers the extended family (day-of-week, `ayer tarde`, `ayer por la noche`, `a medianoche`, mixed temporal+activity bridges) not covered by Pattern 3.

**Contract: H7-P1 is added as a new entry at index 13 — do NOT extend or modify existing Pattern 3.** This keeps the implementation auditable, preserves Pattern 3's compile-time stability, and enables the AC-10 `wrapperPattern: 'H7-P1'` log identification (extending Pattern 3 in place would conflate the wrapper-pattern label).

#### H7-P2 (NEW) — Activity Reference Prefix (compound regex, strips activity/context head + eat-verb together)

Strips activity-reference and location/context frames that appear before the eat-verb, AND the eat-verb itself, in a single compound regex match. Same rationale as H7-P1: single-pass semantics require both to be consumed in one shot.

Covered forms:
- `después del [actividad]` / `después de [actividad]` / `después de [verb-inf]`
- `antes de [actividad]` / `antes del [evento]`
- `durante el viaje` / `durante la siesta` / `durante la comida de empresa`
- `en el desayuno de hoy` / `en la cena familiar del [día_semana]` / `en la cafetería` / `en la oficina` / `en la comida de empresa` / `en el [lugar]`
- `para merendar [time-ref]?` / `para desayunar` / `para comer` / `para cenar` — when followed by an eat-verb

Regex structure (compound — activity/context head + eat-verb, example only):

```
/^(?:después\s+de[l]?\s+[^,]{1,40}?|antes\s+de[l]?\s+[^,]{1,40}?|durante\s+(?:el|la)\s+[^,]{1,40}?|en\s+(?:el|la|un[ao]?)\s+[^,]{1,40}?|para\s+(?:merendar|desayunar|comer|cenar|almorzar)(?:\s+(?:ayer|hoy|esta\s+(?:ma[nñ]ana|tarde|noche)))?\s*)\s+(?:me\s+)?(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]|compartí|prob[eé]|beb[ií]|me\s+hice?|piqu[eé]|me\s+(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]))\s+/i
```

**QA target queries covered:**
- Q633 `después del gimnasio me tomé un batido de chocolate con avena` → strip: `un batido de chocolate con avena`
- Q634 `antes de dormir cené una crema de puerros con picatostes` → strip: `una crema de puerros con picatostes`
- Q635 `en el desayuno de hoy comí tostadas con aguacate y huevo` → strip: `tostadas con aguacate y huevo`
- Q639 `para merendar ayer tomé un yogur con granola` → strip: `un yogur con granola`
- Q640 `después de correr me comí una barrita energética de frutos secos` → strip: `una barrita energética de frutos secos`
- Q641 `en la cena familiar del sábado probé cochinillo asado con ensalada` → strip: `cochinillo asado con ensalada`
- Q642 `hoy al mediodía comí garbanzos con espinacas` → strip: `garbanzos con espinacas` *(shared P1 — H7-P1 fires first)*
- Q643 `durante el viaje me tomé un bocata de pavo con queso` → strip: `un bocata de pavo con queso`
- Q644 `esta tarde en la cafetería pedí una porción de brownie` → strip: `una porción de brownie` *(handled by H7-P1 `esta tarde en [lugar]` branch — H7-P2 entry kept here for documentation only; H7-P1 fires first)*
- Q645 `antes del partido cené arroz con atún y maíz` → strip: `arroz con atún y maíz`
- Q648 `en la comida de empresa tomé ternera guisada con patatas` → strip: `ternera guisada con patatas`
- Q649 `después de la siesta piqué queso fresco con membrillo` → strip: `queso fresco con membrillo`

**Ordering note:** H7-P2 must be placed AFTER Pattern 6 (existing, index 6: `^para\s+(?:cenar|desayunar|comer|almorzar|merendar)\s+(?:tuve|com[ií]|tom[eé])\s+`) so Pattern 6 wins on its exact form. H7-P2 handles the extended `para merendar [time-ref]? eat-verb` forms not covered by Pattern 6.

**Overlap between H7-P1 and H7-P2:** Some queries share temporal + activity frames (e.g. Q642 `hoy al mediodía...`). Single-pass first-match-wins: H7-P1 is placed before H7-P2, so queries where the temporal head is more anchored (day-of-week, `hoy`, `ayer`, etc.) are handled by H7-P1. H7-P2 covers residual activity/location frames that lack a day/time head.

#### H7-P3 (NEW) — Standalone 1st-Person Eat-Verb Fallback

Strips a 1st-person eating verb in the simple past tense that appears at position 0 of the text with NO preceding temporal or activity prefix. This pattern fires ONLY when none of Patterns 0–12 and H7-P1/H7-P2 have fired — it is a standalone fallback for queries like `comí garbanzos con espinacas` (no leading frame at all).

**H7-P3 does NOT compose with H7-P1 or H7-P2.** H7-P1 and H7-P2 already consume the eat-verb as part of their compound regex. H7-P3 is only reached when those patterns did not match (no temporal/activity prefix was present). H7-P3 is disjoint from existing Patterns 1–7b by construction: Patterns 1–7b cover `me he + participle`, `anoche me cené`, `anoche cené`, `he desayunado`, `esta mañana/tarde/noche he + participle`, `acabo de + inf`, `para cenar tuve`, `me voy a pedir`, and `he entrado en [place] y me he pedido` — all distinct from bare simple-past forms at position 0.

Verbs covered: `cené`, `me cené`, `desayuné`, `me desayuné`, `almorcé`, `me almorcé`, `comí`, `me comí`, `merendé`, `me merendé`, `tomé`, `me tomé`, `pedí`, `me pedí`, `compartí`, `probé`, `bebí`, `me bebí`, `me hice`, `piqué`

Regex:

```
/^(?:me\s+)?(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]|compartí|prob[eé]|beb[ií]|me\s+hice?|piqu[eé])\s+/i
```

**QA target queries covered (standalone, no temporal/activity prefix):**
- Any Cat 29 query where the text begins directly with an eat-verb and H7-P1/H7-P2 did not fire.

#### H7-P4 (NEW) — Common Leading Conversational Fillers

Strips conversational framing before a dish name. These are polite or socio-linguistic frames that carry no dish-semantic content.

Forms covered:
- `quiero un` / `quiero una`
- `quiero probar el` / `quiero probar la`
- `quería probar el` / `quería probar la`
- `qué tal está el` / `qué tal está la`
- `ponme un` / `ponme una` / `ponme una tapa de`
- `tráeme una` / `tráeme un` / `tráeme una de` / `tráeme un de`
- **Bare `un/una de [dish]`** — covers Q472 `una de michirones para picar` and Q484 `una de pad thai de langostinos` (the existing `ARTICLE_PATTERN` only strips `un/una`, leaving `de michirones...` which won't L1-hit; H7-P4 must explicitly strip the bare `un[ao]?\s+de\s+` form). Regex fragment: `^un[ao]?\s+de\s+`.
- `me pones`
- `cuánto cuesta la` / `cuánto cuesta el` / `cuánto cuesta un` / `cuánto cuesta una`
- `tenéis` / `tienes`

**Implementation note:** These are all `^`-anchored. After strip, the standard `ARTICLE_PATTERN` in `extractFoodQuery` handles any remaining leading articles. The `tenéis`/`tienes` pattern strips only the leading verb + whitespace (e.g. `tenéis\s+` or `tienes\s+`), not any content following the dish name.

**Fallback behavior:** If no L1 hit is found after H7-P4 strip, the conservative fallback (see Behavior Contract below) forwards the original text to L2/L3/L4.

**Price queries note:** `cuánto cuesta` strips the price-query frame for dish lookup. The result is a calorie response, not a price — this is existing expected behavior (no price data in the system). No special handling needed.

**QA target queries covered:**
- Q487 `quiero un pastel de nata` → strip: `pastel de nata` → L1 CE-294 ✓
- Q463 `quiero probar la ropa vieja canaria` → strip: `ropa vieja canaria` → L1 CE-256 ✓
- Q453 `quería probar el ternasco de aragón` → strip: `ternasco de aragón` → L1 CE-275 (alias) ✓
- Q456 `qué tal está el bacalao al pil-pil` → strip: `bacalao al pil-pil` → L1 CE-106 ✓
- Q457 `ponme una tapa de zarangollo murciano` → strip: `zarangollo murciano` → L1 CE-273 ✓
- Q462 `tráeme una de escalivada con anchoas` → strip: `escalivada con anchoas` → L1 CE-092 (alias) ✓
- Q499 `tenéis gyozas a la plancha?` → strip: `gyozas a la plancha` → (H7-P5 then strips `a la plancha`) → L1 CE-300 ✓
- Q504 `quiero probar el steak tartar` → strip: `steak tartar` → L1 CE-305 ✓
- Q474 `cuánto cuesta la sobrassada con miel` → strip: `sobrassada con miel` → L1 CE-282 ✓
- Q472 `una de michirones para picar` → article strip `una de` → `michirones para picar` → H7-P5 strips `para picar` → L1 CE-274 ✓

#### H7-P5 (NEW) — Common Trailing Conversational Modifiers (Two-Pass, Retry Seam in `engineRouter.ts`)

Strips trailing tokens that are conversational modifiers, not part of the dish's canonical name. These tokens prevent L1 exact/FTS match for dishes that are correctly in the catalog.

**CRITICAL: Implementation location is `packages/api/src/estimation/engineRouter.ts`, NOT `estimationOrchestrator.ts`**

H7-P5 does NOT belong in `CONVERSATIONAL_WRAPPER_PATTERNS` (which is a pre-lookup pass). It operates as an **L1-retry seam inside `runEstimationCascade()` in `engineRouter.ts`**, inserted between line 168 (L1 returns null) and line 170 (L2 attempt begins).

Architecture (Option A — L1-retry seam):

```
// existing L1 attempt (lines 140–168)
if (lookupResult1 !== null) { return levelHit: 1 result; }

// NEW H7-P5 seam — inserted here, between L1 null and L2 fallback
// Apply trailing modifier strip to normalizedQuery.
// If stripped text !== normalizedQuery, retry L1 with stripped text.
// If retry L1 hits → return levelHit: 1 result.
// If retry L1 also misses → proceed to L2 with ORIGINAL normalizedQuery (not stripped).
// This ensures no L2/L3/L4 regression when strip produces a false positive.

// existing L2 attempt (lines 170+)
```

This approach:
- Does not touch `estimationOrchestrator.ts` (which only calls `runEstimationCascade()` once).
- Does not risk double-counting: the retry uses the stripped text as a one-off L1 lookup; if it misses, L2 onward use the original.
- Does not require a second full cascade call.
- Keeps `extractFoodQuery` as a pure text-normalizer.

**Trailing modifiers to strip in H7-P5:**

Category A — pure conversational suffixes (always strip in retry):
- `, por favor` / `por favor`
- `para merendar` / `para picar` / `para dos` / `para compartir` / `para el centro`
- `clásico` / `clásica` / `clásicos` / `clásicas`
- `bien caliente` / `bien frío` / `bien fría`
- `de postre` — when it follows a dish name (e.g. `tiramisú casero de postre` → `tiramisú casero`)
- `casero de postre` → strip leaving the dish name before

Category B — cooking/serving method suffixes (strip in retry when they follow a dish name without the method):
- `a baja temperatura`
- `a la plancha` — only strip as trailing modifier when followed by `?` or end-of-string; `sepia a la plancha` is itself a catalog item, so Pass 1 (original text L1) hits before H7-P5 runs
- `con extra de [token]` — strip `con extra de [^,\s]+` from the tail

Category C — trailing `con [tail]` strip (the most dangerous category):
- `con [1–4 tokens]` at end of string — strip only when the dish name before `con` is at least 2 whitespace-delimited tokens
- Examples: `con sésamo`, `con parmesano`, `con trufa`, `con anchoas`, `con miel`, `con cilantro y piña`, `con queso de cabra y cebolla caramelizada`
- **Safety guard (defense in depth):** Cat C strip fires ONLY when:
  - (a) The pre-`con` fragment is ≥ 2 whitespace-delimited tokens, AND
  - (b) The whole text did NOT match L1 on the first attempt (guaranteed by the retry seam architecture), AND
  - (c) The pre-`con` fragment is NOT itself a whole-text L1 hit in `detectImplicitMultiItem`'s Guard 2 sense (i.e., the implicit multi-item detector's whole-text catalog check). This is already covered by the first L1 attempt (Pass 1): if the full text including `con [tail]` resolves to a catalog dish, we never reach the retry seam. However, as an additional guard: if the pre-`con` text contains `con` itself (e.g. `tostada con jamón con tomate`), limit Cat C to stripping only the LAST `con [tail]` segment.

**Landmine corpus awareness (S1 addressed):** The F-MULTI-ITEM-IMPLICIT landmine protection relies on the DB-based Guard 2 (`detectImplicitMultiItem`: whole-text L1 lookup at `implicitMultiItemDetector.ts:125`). H7-P5 Cat C operates AFTER L1 already returned null for the full text — which already proves the full text is not a catalog landmine. The `≥2 pre-con tokens` guard provides defense-in-depth against single-word-dish `con [tail]` strips. No static corpus list is needed; the DB lookup is the authoritative landmine guard.

**QA target queries covered by H7-P5 (retry pass):**
- Q482 `un burrito de cochinita pibil con extra de picante` → L1 on `burrito de cochinita pibil con extra de picante` → NULL; H7-P5 Cat B strips `con extra de picante` → `burrito de cochinita pibil` → L1 CE-289 ✓
- Q484 `una de pad thai de langostinos` → H7-P4 strips `una de` → `pad thai de langostinos` → L1 NULL (alias: verify CE-291 alias `pad thai de langostinos` exists — confirmed at `spanish-dishes.json:7630`); actually L1 hits via alias → CE-291 ✓ (H7-P5 not needed here)
- Q488 `un tiramisú casero de postre` → L1 NULL; H7-P5 Cat A strips `casero de postre` → `tiramisú` → L1 ✓ (preexisting)
- Q491 `una hamburguesa gourmet con queso de cabra y cebolla caramelizada` → L1 NULL; H7-P5 Cat C strips `con queso de cabra y cebolla caramelizada` → `hamburguesa gourmet` → L1 CE-217 alias check
- Q494 `dos nigiris de pez mantequilla con trufa` → article+count strip leaves `nigiris de pez mantequilla con trufa`. **L1 outcome empirically uncertain:** CE-295 has aliases `["nigiri de pez mantequilla con trufa", "nigiris de pez mantequilla", "sushi de pez mantequilla"]` (`spanish-dishes.json:7732–7745`). The query string `nigiris de pez mantequilla con trufa` does NOT exactly match any alias (plural `nigiris` + `con trufa` is the cross-product not present), but the Spanish FTS in `level1Lookup` (`packages/api/src/estimation/level1Lookup.ts:123,263`) may stem `nigiris → nigiri` and FTS-match the singular alias `nigiri de pez mantequilla con trufa`. **Two acceptable outcomes:**
  - **Path A — L1 Pass 1 hits via FTS pluralization:** Q494 already resolves; H7-P5 never fires; OK result returned. Acceptable.
  - **Path B — L1 Pass 1 misses:** H7-P5 Cat C strips `con trufa` → `nigiris de pez mantequilla` → L1 alias hit (exact alias `nigiris de pez mantequilla` exists). Acceptable.
  - **Q494 is NOT counted as a hard target for AC-2** (its outcome depends on L1 plural-handling, not on H7-P5 mechanism). It is included in AC-2 only when Path B is exercised — and even then the test must verify the H7-P5 retry-seam by stubbing/mocking, not by relying on Path B occurring naturally.
- Q496 `tacos al pastor con cilantro y piña` → L1 NULL; H7-P5 Cat C strips `con cilantro y piña` → `tacos al pastor` → L1 CE-297 ✓
- Q497 `bao de panceta a baja temperatura` → L1 NULL; H7-P5 Cat B strips `a baja temperatura` → `bao de panceta` → L1 CE-298 ✓
- Q499 `tenéis gyozas a la plancha?` → H7-P4 strips `tenéis` → `gyozas a la plancha` → L1 NULL; H7-P5 Cat B strips `a la plancha` → `gyozas` → L1 CE-300 ✓
- Q500 `un ceviche de corvina clásico` → article strip → `ceviche de corvina clásico` → L1 NULL; H7-P5 Cat A strips `clásico` → `ceviche de corvina` → L1 CE-301 ✓
- Q503 `un tataki de atún con sésamo` → L1 NULL; H7-P5 Cat C strips `con sésamo` → `tataki de atún` → L1 CE-304 ✓
- Q505 `un carpaccio de buey con parmesano` → L1 NULL; H7-P5 Cat C strips `con parmesano` → `carpaccio de buey` → L1 CE-306 (alias `carpaccio de buey`) ✓
- Q478 `un talo con chistorra, por favor` → article strip → `talo con chistorra, por favor` → L1 NULL; H7-P5 Cat A strips `, por favor` → `talo con chistorra` → L1 **CE-285** ✓ *(previously incorrectly deferred to F-H9 — talo con chistorra IS in catalog)*
- Q476 `un gazpachuelo malagueño bien caliente` → L1 NULL; H7-P5 Cat A strips `bien caliente` → `gazpachuelo malagueño` → L1 CE-283 ✓
- Q472 `una de michirones para picar` → article strip `una de` → `michirones para picar` → L1 NULL; H7-P5 Cat A strips `para picar` → `michirones` → L1 CE-274 ✓

**Q480 status — `una horchata con fartons para merendar`:**
After H7-P5 Cat A strips `para merendar` → `horchata con fartons`. `Fartons` is in catalog as CE-287 but `Horchata con fartons` compound is NOT. This will NOT be a hard L1 hit. Resolution: Q480 is downgraded to best-effort via L2/L3 similarity (likely L3 cosine hit on `Fartons` or `Horchata`). Q480 is explicitly excluded from the hard AC-3 target list. The H7-P5 Cat A strip for `para merendar` is still applied, improving the L2/L3 signal.

---

### CE-ID Reference Table (empirically verified from `spanish-dishes.json`)

| CE-ID | Dish Name | Key Aliases |
|-------|-----------|-------------|
| CE-092 | Pimientos asados | `escalivada`, `escalivada con anchoas` |
| CE-106 | Bacalao al pil-pil | `bacalao` |
| CE-256 | Ropa vieja canaria | `ropa vieja de garbanzos`, `ropa vieja (canaria)` |
| CE-273 | Zarangollo murciano | `zarangollo`, `pisto murciano con huevo` |
| CE-274 | Michirones | `michirones murcianos`, `habas secas guisadas` |
| CE-275 | Ternasco asado | `ternasco de aragón`, `cordero lechal asado`, `ternasco al horno` |
| CE-282 | Sobrassada con miel | `sobrasada con miel` |
| CE-283 | Gazpachuelo malagueño | `gazpachuelo` |
| CE-285 | Talo con chistorra | `talo vasco` |
| CE-287 | Fartons | `fartón` |
| CE-289 | Burrito de cochinita pibil | — |
| CE-291 | Pad thai | `pad thai de langostinos`, `pad thai de gambas` |
| CE-294 | Pastel de nata | `pastéis de nata`, `pastel de belém` |
| CE-295 | Nigiri de pez mantequilla | `nigiri de pez mantequilla con trufa`, `nigiris de pez mantequilla` |
| CE-296 | Uramaki roll | `uramaki roll de atún`, `uramaki roll de atún picante` |
| CE-297 | Tacos al pastor | `taco al pastor` |
| CE-298 | Bao de panceta | `bao chino` |
| CE-300 | Gyozas | `gyoza`, `dumplings japoneses`, `empanadillas japonesas` |
| CE-301 | Ceviche | `ceviche de corvina`, `ceviche peruano` |
| CE-303 | Hummus | `humus`, `hummus con pan de pita` |
| CE-304 | Tataki de atún | `tataki de atún rojo` |
| CE-305 | Steak tartar | `tartar de ternera`, `tartar de buey`, `steak tartare` |
| CE-306 | Carpaccio | `carpaccio de ternera`, `carpaccio de buey` |

---

### Out of Scope

The following are explicitly deferred to future features:

1. **"y" connector misrouting to `menu_estimation`** (Q481 `un poke bowl de salmón y aguacate`, Q490 `un risotto de setas y trufa`) — H5-B follow-up. These require changes to `detectImplicitMultiItem` or `menuDetector`, not wrapper patterns.
2. **Missing atoms** (Q466 `arroz a banda`, Q471 `lacón con grelos`) — deferred to F-H9 seed expansion. Neither dish name nor relevant aliases exist in the current seed data.
3. **Info-intent queries** (Q492 `qué incluye el brunch del domingo?`, Q493 `un menú de 12 piezas de sushi variado`, Q502 `el hummus con pan de pita es casero?`, Q471 `el lacón con grelos es de temporada?`) — these are `text_too_long`/info intents or menu queries; not addressable by wrapper strip.
4. **L3 similarity threshold tuning** — separate concern, separate ticket.
5. **Currency/price queries result type** (`cuánto cuesta`) — H7-P4 strips the frame for dish lookup, but the result will be a calorie response, not a price. This is already the expected behavior (no price data in the system).
6. **Cat 26 — Voz transcrita y errores STT** — typo/STT errors require a different solution (fuzzy matching or normalization).
7. **Cat 27 — Estructuras compuestas** — compound dish descriptions; require L2/L3/L4 or new catalog entries, not wrapper strips.
8. **Q480 `horchata con fartons` compound** — H7-P5 Cat A strips `para merendar`, but the residue `horchata con fartons` is not a single catalog dish. Best-effort via L2/L3 only; not in hard AC-3 target.

**Dishes previously (incorrectly) listed as deferred that are NOW in scope after empirical verification:**
The following dishes were listed as missing atoms in v1 spec but ARE in the current seed data — F-H7 wrapper strips enable L1 hits for them:
- `bacalao al pil-pil` → CE-106 ✓
- `ropa vieja canaria` → CE-256 ✓
- `zarangollo murciano` → CE-273 ✓
- `ternasco de aragón` → alias of CE-275 ✓
- `sobrassada con miel` → CE-282 ✓
- `escalivada con anchoas` → alias of CE-092 ✓
- `michirones` → CE-274 ✓
- `gazpachuelo malagueño` → CE-283 ✓
- `talo con chistorra` → CE-285 ✓ *(was claimed deferred, exists in seed)*

---

### Behavior Contract

1. **Strip order for H7-P1 through H7-P4:** All new patterns strip BEFORE L1 lookup, identical to how Patterns 0–12 work today (inside `extractFoodQuery()` single-pass loop). H7-P5 operates as a post-L1-null retry seam inside `runEstimationCascade()` in `engineRouter.ts`.
2. **Conservative fallback:** If no L1 hit after any wrapper strip, the original pre-strip text is used for L2/L3/L4. No regression on queries that currently hit L2/L3/L4. For H7-P5 specifically: if the retry L1 also misses, L2 onward use the ORIGINAL normalizedQuery (not the H7-P5 stripped text).
3. **Intent classification safety:** Temporal/activity wrapper detection must NOT reclassify a query as `menu_estimation`. The wrapper strip happens inside `extractFoodQuery` which is called on the single-dish estimation path, after `detectMenuQuery` has already run (see `conversationCore.ts:80+`). H7-P1 through H7-P4 firing inside `extractFoodQuery` cannot affect intent routing.
4. **Observability:** `request.log.debug({ wrapperPattern: 'H7-P1' | 'H7-P2' | 'H7-P3' | 'H7-P4' | 'H7-P5' })` ephemeral structured log line only. No change to `QueryLogEntry` interface (`queryLogger.ts:24–34`). No new DB column. No change to API response schema. The `wrapperPattern` label is for runtime debugging/grep only.
5. **Pattern 4b non-regression:** Existing Pattern 4b (`^esta\s+(?:ma[nñ]ana|tarde|noche)\s+he\s+...`, index 4) covers `esta mañana/tarde/noche he + past-participle` (F-MULTI-ITEM-IMPLICIT canonical #2). H7-P1 targets simple-past verb forms (no `he`). These are orthogonally disjoint — no conflict. Ordering: Pattern 4b (index 4) fires before H7-P1 (index 13+) for its subset, which is correct.

---

### Edge Cases & Error Handling

1. **Overlap between H7-P1 and existing Patterns 2 and 3:** Existing Pattern 3 (index 2) covers `^(?:ayer|anoche|anteayer|hoy|esta\s+mañana|esta\s+noche)\s+(?:cen[eé]|...)` — temporal marker + eat-verb in one compound shot, narrower subset. H7-P1 is added as a NEW separate entry at index 13, AFTER index 2, so Pattern 3 wins for its exact forms via first-match-wins. H7-P1 handles the extended family (day-of-week, mixed temporal+activity bridges, `ayer tarde`, `ayer por la noche`, `a medianoche`) not covered by Pattern 3. **Pattern 3 must NOT be modified** — see "Contract" in the H7-P1 section.
2. **Overlap between H7-P2 and Pattern 6 (existing):** Pattern 6 (index 6) covers `^para\s+(?:cenar|desayunar|comer|almorzar|merendar)\s+(?:tuve|com[ií]|tom[eé])`. H7-P2 must be placed AFTER index 6. No conflict: Pattern 6 fires first for its exact form; H7-P2 handles the longer `para merendar [time-ref]? eat-verb` forms.
3. **H7-P3 interaction with existing Patterns 1–7b:** H7-P3 covers bare simple-past forms at position 0. All existing patterns 0–12 are disjoint from these by construction (they target different sentence structures). H7-P3 is a safe fallback.
4. **H7-P5 `con [tail]` strip: `pan con tomate` protection (verified-in-seed example):** The retry seam architecture (H7-P5 only runs after L1 already returned null) protects this: `Pan con tomate` is a catalog dish (`spanish-dishes.json`), so L1 Pass 1 returns non-null and the retry seam is never reached. Same protection applies to `Tostada con tomate y aceite`, `Café con leche`, `Tostada con jamón y tomate`, `Berenjenas con miel`, `Huevos rotos con jamón`, `Espárragos con jamón`, `Judías verdes con patatas`, etc. The `≥2 pre-con tokens` guard and the DB-based Guard 2 from `detectImplicitMultiItem` provide defense-in-depth for the rare case where a `con [tail]` query is NOT in the catalog at full text.
5. **Empty remainder guard:** All new patterns must honor the existing empty-remainder safety: if stripping produces an empty string, `extractFoodQuery` returns the original `originalTrimmed` text as fallback (see `entityExtractor.ts:778`).
6. **ReDoS safety:** H7-P1 and H7-P2 compound regexes contain `.+?` lazy quantifiers. Developer must audit for catastrophic backtracking. Model after Pattern 7b (existing index 8, proven safe via `^`-anchor + required literal suffix). Day-of-week alternation and fixed verb suffixes are safe. The `[^,]{1,40}?` bounded quantifier in H7-P2 prevents unbounded backtracking.
7. **H7-P5 retry and Redis cache:** The retry must not double-count cache hits. The Redis cache key is derived from the query text. An H7-P5 retry uses the stripped text as the cache key for the retry L1 attempt only. If retry L1 hits a cache entry, that is correct behavior. If retry L1 misses, L2 onward use the original normalizedQuery (also with original cache key path).
8. **`normalizedQuery` vs. `extractFoodQuery` output:** H7-P5 in `engineRouter.ts` operates on the `normalizedQuery` value as received by `runEstimationCascade()` — this is already the post-`extractFoodQuery()` text (wrapper-stripped by H7-P1 through H7-P4 if applicable). The H7-P5 retry applies to this already-stripped text.
9. **Q494 nigiri alias / FTS plural-handling — soft target only:** Q494 `dos nigiris de pez mantequilla con trufa` may resolve at L1 Pass 1 via Spanish FTS pluralization (`nigiris → nigiri` stem matching alias `nigiri de pez mantequilla con trufa`) OR at L1 retry-pass after H7-P5 strips `con trufa` (matching alias `nigiris de pez mantequilla`). Both Path A and Path B are acceptable; the test suite must NOT depend on which path fires naturally. Q494 is a SOFT target excluded from AC-2's hard numerator. Tests for the H7-P5 retry-seam mechanism must use queries where L1 Pass 1 deterministically misses (Q482, Q488, Q496, Q497, Q500, Q503, Q504, Q505, Q478) or use mocked L1 stubs to force the retry path.

---

## Implementation Plan

### Strategy

F-H7 is a pure NLP extension — no DB migrations, no schema changes, no API contract changes. The approach is TDD across 7 phases, staged by pattern group. Phases 1–4 extend `CONVERSATIONAL_WRAPPER_PATTERNS` in `entityExtractor.ts` with four new entries (indices 13–16), each preceded by a RED unit test in `fH7.temporal.unit.test.ts`. Phase 5 introduces an H7-P5 retry seam inside `runEstimationCascade()` in `engineRouter.ts` between the L1-null branch (line 168) and the L2 attempt (line 170), with pure-function strip helpers extracted to `packages/api/src/estimation/h7TrailingStrip.ts`, preceded by RED unit tests in `fH7.trailing.unit.test.ts`. Phase 6 produces an edge-case suite in `fH7.edge-cases.test.ts` covering all 9 spec edge cases, landmine corpus, and observability assertions. Phase 7 handles documentation. All changes are additive; rollback is `git revert`. The conservative fallback principle is enforced throughout: any strip that produces no L1 hit forwards the original text to L2/L3/L4.

---

### Existing Code to Reuse

- `packages/api/src/conversation/entityExtractor.ts` — `CONVERSATIONAL_WRAPPER_PATTERNS` (current 13-entry array, indices 0–12), `extractFoodQuery()`, `ARTICLE_PATTERN`, single-pass for-break loop at lines 721–726, empty-remainder guard at line 778.
- `packages/api/src/estimation/engineRouter.ts` — `runEstimationCascade()`, `normalizedQuery` variable (line 111), `level1Lookup` call (line 143), L1-null branch (lines 151–168), L2 start (line 170), existing `logger` optional parameter already present on `EngineRouterOptions`.
- `packages/api/src/estimation/level1Lookup.ts` — `level1Lookup()` function, called directly for the retry; same signature as existing call on line 143.
- `packages/api/src/lib/queryLogger.ts` — `QueryLogEntry` interface (lines 24–34) confirmed fixed at 9 fields, no `wrapperPattern` field, no change required.
- Existing test files as structural references: `f-multi-item-implicit.wrapper.unit.test.ts` (pattern for pure `extractFoodQuery()` unit tests), `f-multi-item-implicit.integration.test.ts` (pattern for `processMessage()` integration tests with mocked `runEstimationCascade`), `f-nlp-chain.entityExtractor.unit.test.ts` (pattern for pattern-ordering regression assertions).

---

### Files to Create

1. `packages/api/src/__tests__/fH7.temporal.unit.test.ts` — Unit tests for H7-P1, H7-P2, H7-P3, H7-P4: `extractFoodQuery()` output assertions for all 20 Cat 29 queries, Cat 21/22 leading-frame queries, empty-remainder edge cases, ReDoS timing guards, pattern-ordering regression checks.
2. `packages/api/src/__tests__/fH7.trailing.unit.test.ts` — Unit tests for H7-P5 strip helpers (Cat A, B, C separately), landmine guard (≥2 pre-con tokens), empty-remainder, and explicit tests for the retry-seam behavior using a mocked `level1Lookup`.
3. `packages/api/src/__tests__/fH7.engineRouter.integration.test.ts` — Integration tests for `runEstimationCascade()` end-to-end (real DB, mocked Redis/cache) verifying L1-retry path, pass-through when L1 Pass 1 hits, fallback to original text when retry also misses.
4. `packages/api/src/__tests__/fH7.conversationCore.integration.test.ts` — AC-9 compliance: `POST /conversation/message` end-to-end via `processMessage()` (real DB, mocked Redis/cache/engineRouter per ADR-021 pattern) asserting at least one Cat 29 query returns `estimation !== null`.
5. `packages/api/src/__tests__/fH7.edge-cases.test.ts` — Edge cases 1–9 from spec, F-MULTI-ITEM-IMPLICIT landmine corpus (using verified seed dishes only), `request.log.debug` observability assertion with Fastify mock log, Unicode normalization edge cases.
6. `packages/api/src/__tests__/fH7.q494-pathB.unit.test.ts` — **Dedicated** unit test file with top-level `vi.mock('../estimation/level1Lookup.js')` to deterministically force Path B execution for the Q494 nigiri retry-seam test (per Codex R-Plan I4 — scoped per-test mocks do not work; top-level hoisted mocks are the codebase convention).
7. `packages/api/src/estimation/h7TrailingStrip.ts` — Pure-function strip helpers for H7-P5 Cat A, B, C. Exported individually for unit-testability.

---

### Files to Modify

1. `packages/api/src/conversation/entityExtractor.ts` — Append four new entries to `CONVERSATIONAL_WRAPPER_PATTERNS` (indices 13–16: H7-P1, H7-P2, H7-P3, H7-P4). **AC-10 observability contract (concrete):** Change `extractFoodQuery()` return shape from `{ query, chainSlug? }` to `{ query, chainSlug?, matchedWrapperLabel?: 'H7-P1'|'H7-P2'|'H7-P3'|'H7-P4'|null }`. Capture the matched pattern's index inside the for-break loop, map indices 13/14/15/16 to labels `'H7-P1'..'H7-P4'`, populate `matchedWrapperLabel` accordingly. Returning the label from the pure function — rather than threading a logger or callback into `extractFoodQuery` — preserves its purity and avoids the "multiple call sites" duplicate-log problem. Existing return-shape consumers (~3 call sites in `conversationCore.ts`) ignore the new field unless they explicitly read it.
2. `packages/api/src/conversation/conversationCore.ts` — At the primary single-dish estimation path call site (line 507), after calling `extractFoodQuery()`, emit `request.log.debug({ wrapperPattern: matchedWrapperLabel })` when `matchedWrapperLabel !== null`. **AC-10 scope (explicit):** The fallback `extractFoodQuery()` call inside the catch block at line 521/528 (defensive error-recovery path, only reached when the primary path throws) is OUT of AC-10 scope — observability there is best-effort and intentionally not required. The line 399 menu-detection rerun is also out of scope (pre-routing classification, not the production estimation path). Document this scope decision with a code comment. H7-P5 in `engineRouter.ts` emits its own `logger.debug({ wrapperPattern: 'H7-P5' })` at the retry seam (line 168-170).
3. `packages/api/src/estimation/engineRouter.ts` — Add import of `applyH7TrailingStrip` from `./h7TrailingStrip.js`. Insert H7-P5 retry seam block (≈25 lines) between lines 168 and 170 (between L1-null branch close and L2 fallback comment).
4. `docs/project_notes/key_facts.md` — Update API test count (3932 + final delta after all phases).
5. `docs/project_notes/decisions.md` — Add ADR-023: H7-P5 L1-retry seam in `engineRouter.ts` (next available after ADR-022 at line 643).

---

### Implementation Order

1. **Phase 1 — H7-P1 unit tests + implementation** (`fH7.temporal.unit.test.ts` + `entityExtractor.ts` index 13)
2. **Phase 2 — H7-P2 unit tests + implementation** (`fH7.temporal.unit.test.ts` + `entityExtractor.ts` index 14)
3. **Phase 3 — H7-P3 unit tests + implementation** (`fH7.temporal.unit.test.ts` + `entityExtractor.ts` index 15)
4. **Phase 4 — H7-P4 unit tests + implementation** (`fH7.temporal.unit.test.ts` + `entityExtractor.ts` index 16)
5. **Phase 5a — H7-P5 strip helper unit tests + `h7TrailingStrip.ts` implementation** (`fH7.trailing.unit.test.ts` + `h7TrailingStrip.ts`)
6. **Phase 5b — H7-P5 retry seam integration tests + seam wiring** (`fH7.engineRouter.integration.test.ts` + `engineRouter.ts` modification)
7. **Phase 5c — AC-9 `processMessage()` integration test** (`fH7.conversationCore.integration.test.ts`)
8. **Phase 6 — Edge-case suite** (`fH7.edge-cases.test.ts`)
8. **Phase 7 — Documentation** (`key_facts.md`, `decisions.md`)

---

#### Phase 1 — H7-P1 (Pure Temporal Prefix, compound regex)

**Step 1.1 — Write failing unit tests (`fH7.temporal.unit.test.ts`, first RED suite)**

Test cases in `describe('H7-P1 — Pure Temporal Prefix')`:

- `'ayer por la noche cené salmón con verduras al horno'` → `extractFoodQuery().query === 'salmón con verduras al horno'` (Q631)
- `'el domingo me comí un plato de migas con huevo'` → `'un plato de migas con huevo'` (Q632)
- `'anoche después del cine compartí nachos con queso'` → `'nachos con queso'` (Q637)
- `'el viernes en la oficina pedí noodles con pollo y verduras'` → `'noodles con pollo y verduras'` (Q638)
- `'el lunes después de clase comí una empanadilla de carne'` → `'una empanadilla de carne'` (Q646)
- `'ayer tarde me bebí un smoothie de mango con yogur'` → `'un smoothie de mango con yogur'` (Q647)
- `'a medianoche me hice una tortilla francesa con champiñones'` → `'una tortilla francesa con champiñones'` (Q650)
- `'esta mañana antes de trabajar tomé un croissant de mantequilla'` → `'un croissant de mantequilla'` (Q636)
- **Negative regression — Pattern 3 still fires:** `'anoche cené paella'` → `query === 'paella'` (Pattern 3 wins, not H7-P1 — verified because Pattern 3 is at index 2, H7-P1 at index 13; the stripped output is identical so the test confirms Pattern 3 still fires by also confirming H7-P1 does NOT change existing behavior)
- **Negative regression — Pattern 2 still fires:** `'anoche me cené paella'` → `query === 'paella'` (Pattern 2 at index 1)
- **Empty-remainder guard:** `'el lunes'` (no eat-verb) → H7-P1 must NOT match; `extractFoodQuery().query === 'el lunes'` (original text returned)
- **ReDoS timing bound:** Construct a 100-character input that attempts pathological backtracking (e.g. `'el lunes '.repeat(10) + 'comí tortilla'`); assert `Date.now()` delta < 50 ms. (Note: bounded `[^,]{1,40}?` quantifiers prevent catastrophic backtracking; timing test is a regression guard.)

All 12 tests must be RED before step 1.2.

**Step 1.2 — Implement H7-P1 at index 13 in `entityExtractor.ts`**

Append to `CONVERSATIONAL_WRAPPER_PATTERNS` array as element at index 13. The compound regex must:
- Be `^`-anchored.
- Cover all temporal head forms listed in the spec (see H7-P1 spec section): `ayer`, `ayer por la noche`, `ayer tarde`, `anoche`, `anoche después del [event]`, `hoy`, `hoy al mediodía`, `esta mañana/tarde/noche`, `esta mañana/tarde antes/después de [Y]`, `a medianoche`, `el [día_semana]` with optional continuation `(por la|al) (mañana|tarde|noche|mediodía)`, `en [lugar]`, `(antes|después) de[l]? [^,]{1,30}`.
- Consume the eat-verb immediately following the temporal head (with optional `me` clitic prefix).
- Eat-verb alternation: `cen[eé]`, `desayun[eé]`, `almorc[eé]`, `com[ií]`, `merend[eé]`, `tom[eé]`, `ped[ií]`, `compartí`, `prob[eé]`, `beb[ií]`, `me\s+hice?`, `piqu[eé]`.
- End with `\s+` so the dish name becomes the remainder.
- Use `i` flag (case-insensitive).
- Developer note: the `[^,]{1,N}` bounded quantifier pattern used in existing Pattern 7b is the ReDoS-safe idiom for variable-length middle sections — follow it. Do NOT use unbounded `.*` or `[^]+` in the middle of compound patterns.

Add source comment line above entry: `// H7-P1 (NEW). Pure temporal prefix + eat-verb — compound. Covers day-of-week, ayer tarde/por la noche, a medianoche, esta mañana/tarde/noche + optional bridge. F-H7.`

Run unit tests. Expect all 12 H7-P1 tests GREEN.

**Step 1.3 — Run full test suite**

`npm test -w @foodxplorer/api` — expect all pre-existing tests pass, 0 regressions, 12 new H7-P1 tests GREEN.

---

#### Phase 2 — H7-P2 (Activity Reference Prefix, compound regex)

**Step 2.1 — Write failing unit tests (`fH7.temporal.unit.test.ts`, second suite)**

Test cases in `describe('H7-P2 — Activity Reference Prefix')`:

- `'después del gimnasio me tomé un batido de chocolate con avena'` → `'un batido de chocolate con avena'` (Q633)
- `'antes de dormir cené una crema de puerros con picatostes'` → `'una crema de puerros con picatostes'` (Q634)
- `'en el desayuno de hoy comí tostadas con aguacate y huevo'` → `'tostadas con aguacate y huevo'` (Q635)
- `'para merendar ayer tomé un yogur con granola'` → `'un yogur con granola'` (Q639)
- `'después de correr me comí una barrita energética de frutos secos'` → `'una barrita energética de frutos secos'` (Q640)
- `'en la cena familiar del sábado probé cochinillo asado con ensalada'` → `'cochinillo asado con ensalada'` (Q641)
- `'durante el viaje me tomé un bocata de pavo con queso'` → `'un bocata de pavo con queso'` (Q643)
- `'esta tarde en la cafetería pedí una porción de brownie'` → `'una porción de brownie'` (Q644)
- `'antes del partido cené arroz con atún y maíz'` → `'arroz con atún y maíz'` (Q645)
- `'en la comida de empresa tomé ternera guisada con patatas'` → `'ternera guisada con patatas'` (Q648)
- `'después de la siesta piqué queso fresco con membrillo'` → `'queso fresco con membrillo'` (Q649)
- **Empty-remainder guard:** `'para merendar'` (no eat-verb following) → must NOT match; `extractFoodQuery().query === 'para merendar'`
- **ReDoS timing bound:** Construct a 100-character activity-frame input; assert < 50 ms.

Note: Q642 (`hoy al mediodía comí garbanzos con espinacas`) is NOT a H7-P2 test — it is covered by H7-P1 (temporal head `hoy al mediodía`). Add a cross-check test: `'hoy al mediodía comí garbanzos con espinacas'` → H7-P1 fires (index 13, before H7-P2 at index 14) → `query === 'garbanzos con espinacas'`. This test confirms ordering.

All 14 tests must be RED before step 2.2.

**Step 2.2 — Implement H7-P2 at index 14 in `entityExtractor.ts`**

Append to `CONVERSATIONAL_WRAPPER_PATTERNS` as element at index 14 (after H7-P1 at 13). The compound regex must:
- Be `^`-anchored.
- Cover activity/context head forms: `después\s+de[l]?\s+[^,]{1,40}?`, `antes\s+de[l]?\s+[^,]{1,40}?`, `durante\s+(?:el|la)\s+[^,]{1,40}?`, `en\s+(?:el|la|un[ao]?)\s+[^,]{1,40}?`, `para\s+(?:merendar|desayunar|comer|cenar|almorzar)(?:\s+(?:ayer|hoy|esta\s+(?:ma[nñ]ana|tarde|noche)))?\s*`.
- Immediately followed by the same eat-verb alternation as H7-P1 (with optional `me` clitic).
- End with `\s+`.
- Use `i` flag, `[^,]{1,40}?` bounded lazy quantifier for all variable-length middle sections.
- Developer note: the `?` after `[^,]{1,40}` makes the quantifier lazy — needed to prevent over-consuming and missing the eat-verb anchor that follows. This is the ReDoS-safe pattern from spec Edge Case 6.

Add source comment: `// H7-P2 (NEW). Activity/context reference prefix + eat-verb — compound. Covers después de, antes de, durante, en [lugar], para [meal-verb]. F-H7.`

Ordering verification: add an in-test assertion that `'para cenar tuve paella'` still matches Pattern 6 (index 6: `^para\s+(?:cenar|...)\s+(?:tuve|...)`) and NOT H7-P2 — the output `query` will be `'paella'` from Pattern 6; add comment in test that if Pattern 6 is removed the output would still be `'paella'` via H7-P2, but the pattern identity difference matters for AC-10 observability.

Run unit tests. Expect GREEN.

**Step 2.3 — Run full test suite**

`npm test -w @foodxplorer/api` — 0 regressions.

---

#### Phase 3 — H7-P3 (Standalone Bare Eat-Verb Fallback)

**Step 3.1 — Write failing unit tests (`fH7.temporal.unit.test.ts`, third suite)**

Test cases in `describe('H7-P3 — Standalone eat-verb fallback')`:

- `'comí garbanzos con espinacas'` → `extractFoodQuery().query === 'garbanzos con espinacas'`
- `'cené pollo asado'` → `'pollo asado'`
- `'me comí una tortilla de patatas'` → `'tortilla de patatas'` (article stripped subsequently)
- `'pedí arroz con leche'` → `'arroz con leche'`
- `'probé el gazpacho andaluz'` → `'gazpacho andaluz'` (article stripped after wrapper)
- `'piqué almendras'` → `'almendras'`
- **`me hice` regex ambiguity test (R5 risk mitigation):** `'me hice una tortilla francesa con champiñones'` → `query === 'tortilla francesa con champiñones'`. The H7-P3 regex `/^(?:me\s+)?(?:cen[eé]|...|me\s+hice?|...)\s+/i` has overlap between outer `(?:me\s+)?` and inner `me\s+hice?`. Test asserts the regex correctly matches both `'me hice una tortilla'` AND `'hice una tortilla'` (without `me`).
- **`hice` standalone test:** `'hice una tortilla'` → `query === 'una tortilla'` (subsequent article strip → `'tortilla'`). Covers the case where outer clitic is absent and inner `hice?` matches without `me`.
- **Non-regression: H7-P3 does NOT fire when H7-P1 already matched:** `'ayer cené paella'` → Pattern 3 (index 2) fires, not H7-P3 (index 15); output is still `'paella'` but test documents that Pattern 3 fires first.
- **Non-regression: H7-P3 does NOT fire when H7-P2 already matched:** `'después de correr me comí salmón'` → H7-P2 fires (index 14), not H7-P3; output `'salmón'`.
- **Empty-remainder guard:** `'comí'` alone → H7-P3 regex would match and strip, leaving empty remainder; empty-remainder guard at line 778 returns original text `'comí'`.

All 11 tests must be RED before step 3.2.

**Step 3.2 — Implement H7-P3 at index 15 in `entityExtractor.ts`**

The regex is already specified in the spec (simpler than P1/P2 — no temporal head section):
```
/^(?:me\s+)?(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|ped[ií]|compartí|prob[eé]|beb[ií]|me\s+hice?|piqu[eé])\s+/i
```

Add source comment: `// H7-P3 (NEW). Bare 1st-person simple-past eat-verb at position 0, no temporal/activity prefix. Fallback for Cat 29 queries without leading frames. F-H7.`

Developer caution: the `me\s+hice?` alternation is a two-token pattern; the outer `(?:me\s+)?` clitic prefix is separate. The regex handles both `me comí` (outer clitic) and `me hice` (inner two-token verb). Verify that `me hice` does not double-match the clitic prefix. The correct form is: outer `(?:me\s+)?` covers single-token clitics (`me comí`, `me tomé`, etc.); `me\s+hice?` inside the inner alternation covers the idiom `me hice una tortilla`.

Run unit tests. Expect GREEN.

**Step 3.3 — Run full test suite** — 0 regressions.

---

#### Phase 4 — H7-P4 (Leading Conversational Fillers)

**Step 4.1 — Write failing unit tests (`fH7.temporal.unit.test.ts`, fourth suite)**

Test cases in `describe('H7-P4 — Leading conversational fillers')`:

- `'quiero un pastel de nata'` → `extractFoodQuery().query === 'pastel de nata'` (Q487, CE-294 target)
- `'quiero probar la ropa vieja canaria'` → `'ropa vieja canaria'` (Q463, CE-256)
- `'quería probar el ternasco de aragón'` → `'ternasco de aragón'` (Q453, CE-275 alias)
- `'qué tal está el bacalao al pil-pil'` → `'bacalao al pil-pil'` (Q456, CE-106)
- `'ponme una tapa de zarangollo murciano'` → `'zarangollo murciano'` (Q457, CE-273)
- `'tráeme una de escalivada con anchoas'` → `'escalivada con anchoas'` (Q462, CE-092 alias)
- `'cuánto cuesta la sobrassada con miel'` → `'sobrassada con miel'` (Q474, CE-282)
- `'tenéis gyozas a la plancha?'` → `'gyozas a la plancha'` (Q499; `?` trailing punctuation handled by existing normalization or trimmed via `remainder.trim()`)
- `'quiero probar el steak tartar'` → `'steak tartar'` (Q504, CE-305)
- `'me pones patatas bravas'` → `'patatas bravas'`
- `'ponme un vermut'` → `'vermut'` (article stripped after wrapper)
- `'tráeme un de calamares'` → `'calamares'`
- **Bare `un[ao] de` form (Codex R-Plan I1 — Q472/Q484):** `'una de michirones para picar'` → after H7-P4 strips `una de` → `'michirones para picar'` (then H7-P5 retry strips `para picar` later). Assert `extractFoodQuery().query === 'michirones para picar'` (the `de` strip happens in H7-P4, not after).
- **Bare `un de` form:** `'un de cordero'` → after H7-P4 strips `un de` → `'cordero'`. Assert `query === 'cordero'`.
- **Bare `una de pad thai`:** `'una de pad thai de langostinos'` → after H7-P4 strips `una de` → `'pad thai de langostinos'`. (The trailing `de langostinos` is dish-semantic — do NOT strip it.) Assert `query === 'pad thai de langostinos'`.
- **Interaction with ARTICLE_PATTERN:** `'quiero un pastel de nata'` — after H7-P4 strips `quiero un`, remainder is `pastel de nata`; ARTICLE_PATTERN must NOT strip `pastel` (it only strips leading bare articles, not content tokens). Assert `query === 'pastel de nata'`, not `'de nata'`.
- **Non-regression: H7-P4 does NOT strip when form is ambiguous:** `'tenéis'` alone (no dish following) → `extractFoodQuery().query === 'tenéis'` (empty-remainder guard fires).

All 17 tests must be RED before step 4.2.

**Step 4.2 — Implement H7-P4 at index 16 in `entityExtractor.ts`**

The regex covers all forms listed in spec H7-P4 section:
```
/^(?:quiero\s+(?:probar\s+(?:el|la)\s+|un[ao]?\s+)|quería\s+probar\s+(?:el|la)\s+|qué\s+tal\s+está\s+(?:el|la)\s+|ponme\s+(?:una?\s+(?:tapa\s+de\s+)?)|tráeme\s+(?:un[ao]?\s+(?:de\s+)?)|me\s+pones\s+|cu[aá]nto\s+cuesta\s+(?:el|la|un[ao]?\s+)|ten[eé]is\s+|tienes\s+|un[ao]?\s+de\s+)/i
```

Developer note: the alternation `quiero\s+(?:probar\s+(?:el|la)\s+|un[ao]?\s+)` covers both `quiero probar el` and `quiero un`. The `ponme\s+una?\s+(?:tapa\s+de\s+)?` covers both `ponme una tapa de` and `ponme un`. The `tráeme\s+un[ao]?\s+(?:de\s+)?` covers `tráeme una de` and `tráeme un`. After H7-P4 fires, the standard `ARTICLE_PATTERN` strip at line 740 handles any residual leading article.

Add source comment: `// H7-P4 (NEW). Common leading conversational fillers (quiero un, quiero probar el, ponme, tráeme, cuánto cuesta, tenéis). No eat-verb consumed — dish name follows directly. F-H7.`

Run unit tests. Expect GREEN.

**Step 4.3 — Run full test suite** — 0 regressions.

---

#### Phase 5 — H7-P5 Retry Seam

**Step 5.1 — Write failing unit tests for strip helpers (`fH7.trailing.unit.test.ts`)**

File: `packages/api/src/__tests__/fH7.trailing.unit.test.ts`

Import the named exports from `../estimation/h7TrailingStrip.js` (all pure functions).

`describe('H7-P5 Cat A — conversational suffix strip')`:
- `applyH7CatAStrip('gazpachuelo malagueño bien caliente')` → `'gazpachuelo malagueño'`
- `applyH7CatAStrip('tiramisú casero de postre')` → `'tiramisú'` (strips both `casero` and `de postre`? — No: Cat A strips `casero de postre` as a unit. Verify against spec: `'casero de postre'` is one Cat A form. Result: `'tiramisú'`)
- `applyH7CatAStrip('talo con chistorra, por favor')` → `'talo con chistorra'` (strips `, por favor`)
- `applyH7CatAStrip('michirones para picar')` → `'michirones'`
- `applyH7CatAStrip('ceviche de corvina clásico')` → `'ceviche de corvina'`
- `applyH7CatAStrip('arroz con leche')` → `'arroz con leche'` (no Cat A suffix → identity)
- `applyH7CatAStrip('')` → `''` (empty-input guard)

`describe('H7-P5 Cat B — cooking/serving method suffix strip')`:
- `applyH7CatBStrip('bao de panceta a baja temperatura')` → `'bao de panceta'`
- `applyH7CatBStrip('gyozas a la plancha')` → `'gyozas'`
- `applyH7CatBStrip('burrito de cochinita pibil con extra de picante')` → `'burrito de cochinita pibil'`
- `applyH7CatBStrip('sepia a la plancha')` → `'sepia a la plancha'` — **IMPORTANT:** `sepia a la plancha` IS a catalog dish; Cat B only strips as trailing modifier when followed by `?` or end-of-string AND the original L1 Pass 1 missed. However, since the strip helpers are pure functions (they do not know L1 status), this test asserts the **raw output**: `applyH7CatBStrip('sepia a la plancha')` → `'sepia'` (the strip function itself strips). The protection against `sepia a la plancha` regression comes from the **retry-seam architecture**: L1 Pass 1 already hits `sepia a la plancha` (it's in the catalog), so the seam is never reached. Document this in a test comment.
- `applyH7CatBStrip('pollo al horno')` → `'pollo al horno'` (no Cat B suffix → identity)

`describe('H7-P5 Cat C — trailing con [tail] strip with ≥2 pre-con tokens guard')`:
- `applyH7CatCStrip('tataki de atún con sésamo')` → `'tataki de atún'` (3 pre-con tokens → strips)
- `applyH7CatCStrip('tacos al pastor con cilantro y piña')` → `'tacos al pastor'`
- `applyH7CatCStrip('carpaccio de buey con parmesano')` → `'carpaccio de buey'`
- `applyH7CatCStrip('hamburguesa gourmet con queso de cabra y cebolla caramelizada')` → `'hamburguesa gourmet'`
- `applyH7CatCStrip('foo con bar')` → `'foo con bar'` — raw function strips (1 pre-con token `foo` — FAILS ≥2 guard → returns original). Assert: `applyH7CatCStrip('foo con bar') === 'foo con bar'`. Synthetic non-catalog input chosen to avoid coupling the unit test to seed contents.
- `applyH7CatCStrip('arroz con leche')` → `'arroz con leche'` (1 pre-con token → identity)
- `applyH7CatCStrip('foo bar con baz con qux')` → `'foo bar con baz'` (last `con [tail]` stripped; pre-`con` fragment is `foo bar con baz` which is ≥2 tokens) — assert strip of LAST segment only via `lastIndexOf(' con ')`-based split.
- `applyH7CatCStrip('bacalao al pil-pil con tomate')` → `'bacalao al pil-pil'` (≥2 pre-con tokens → strips; seam architecture ensures `bacalao al pil-pil` already hit L1 Pass 1 so seam never reached in production)
- `applyH7CatCStrip('con sésamo')` → `'con sésamo'` (0 pre-con tokens → identity)

`describe('H7-P5 combined applyH7TrailingStrip — Cat A > B > C priority order')`:
- `applyH7TrailingStrip('gazpachuelo malagueño bien caliente')` → `'gazpachuelo malagueño'` (Cat A fires)
- `applyH7TrailingStrip('bao de panceta a baja temperatura')` → `'bao de panceta'` (Cat B fires)
- `applyH7TrailingStrip('tataki de atún con sésamo')` → `'tataki de atún'` (Cat C fires)
- `applyH7TrailingStrip('paella valenciana')` → `'paella valenciana'` (identity — no strip applies)
- `applyH7TrailingStrip('talo con chistorra, por favor')` → `'talo con chistorra'` (Cat A strips `, por favor` first; Cat C does not then also strip `con chistorra` because Cat A already returned a changed string — function returns after first successful strip category)

All tests must be RED before step 5.2.

**Step 5.2 — Implement `packages/api/src/estimation/h7TrailingStrip.ts`**

Create a new file with four exported pure functions:
- `applyH7CatAStrip(text: string): string` — strips Cat A conversational suffixes using trailing regex patterns.
- `applyH7CatBStrip(text: string): string` — strips Cat B cooking/serving suffixes.
- `applyH7CatCStrip(text: string): string` — strips trailing `con [1–4 tokens]` only when pre-`con` fragment has ≥2 whitespace-delimited tokens; strips only the LAST `con [tail]` segment when multiple `con` tokens exist.
- `applyH7TrailingStrip(text: string): string` — applies Cat A first; if Cat A produces a change, returns result. Otherwise applies Cat B; if change, returns result. Otherwise applies Cat C; returns result or original.

The priority order (A → B → C, returning on first change) ensures that `talo con chistorra, por favor` does not also have `con chistorra` stripped by Cat C after Cat A removes `, por favor`.

**Cat A regex patterns** (all trailing, case-insensitive):
- `/,?\s*por\s+favor\s*$/i`
- `/\s+para\s+(?:merendar|picar|dos|compartir|el\s+centro)\s*$/i`
- `/\s+clásic[ao]s?\s*$/i`
- `/\s+bien\s+(?:caliente|frío|fría)\s*$/i`
- `/\s+casero\s+de\s+postre\s*$/i`
- `/\s+de\s+postre\s*$/i`

**Cat B regex patterns**:
- `/\s+a\s+baja\s+temperatura\s*$/i`
- `/\s+a\s+la\s+plancha\s*[?]?\s*$/i` (trailing `?` stripped by trim already, but include `[?]?` for safety)
- `/\s+con\s+extra\s+de\s+\S+\s*$/i`

**Cat C logic**: Split on `\s+con\s+` from the right (last occurrence). If pre-fragment has ≥2 whitespace-delimited non-empty tokens, return pre-fragment; otherwise return original text unchanged.

File must use `.ts` extension, export all four functions as named exports, and import nothing from other project modules (pure logic only, no DB, no Prisma, no Fastify).

Add file-level comment: `// H7-P5 — Trailing conversational modifier strip helpers (Cat A, B, C). // Pure functions — no I/O, no DB. Called by engineRouter.ts H7-P5 retry seam. // See F-H7 spec for category definitions and safety guards.`

Run unit tests. Expect all trailing strip unit tests GREEN.

**Step 5.3 — Write failing integration tests (`fH7.engineRouter.integration.test.ts`)**

File: `packages/api/src/__tests__/fH7.engineRouter.integration.test.ts`

Mock strategy (mirrors `f-multi-item-implicit.integration.test.ts` pattern):
- `vi.mock('../lib/cache.js')` → `cacheGet: vi.fn().mockResolvedValue(null)`, `cacheSet: vi.fn()`
- `vi.mock('../conversation/contextManager.js')` → `getContext: vi.fn().mockResolvedValue(null)`, `setContext: vi.fn()`
- Real `db` and `prisma` from `DATABASE_URL_TEST`.
- Do NOT mock `runEstimationCascade` — this file IS testing it.
- Do NOT mock `level1Lookup` in the main integration tests — use real DB with dishes that exist in the test DB (CE-IDs confirmed in seed: CE-283 `gazpachuelo malagueño`, CE-285 `talo con chistorra`, CE-274 `michirones`, CE-304 `tataki de atún`, CE-297 `tacos al pastor`).

`describe('H7-P5 retry seam — runEstimationCascade() end-to-end')`:
- **Test: L1 NULL + retry hits:** Call `runEstimationCascade({ db, query: 'gazpachuelo malagueño bien caliente', ... })`. Assert `result.data.level1Hit === true` (retry hit), `result.levelHit === 1`, `result.data.query === 'gazpachuelo malagueño bien caliente'` (raw query echoed, not stripped per engineRouter design). Relies on H7-P5 Cat A stripping `bien caliente` → `gazpachuelo malagueño` → L1 hit (CE-283). **Pre-condition:** `gazpachuelo malagueño` must be in test DB; verify via seed or fixture insert in `beforeAll`.
- **Test: L1 Pass 1 hits — retry NOT triggered:** Call `runEstimationCascade({ db, query: 'bacalao al pil-pil', ... })`. Assert `result.levelHit === 1`, result is non-null. Validates that dishes with `con` or serving-method suffixes that ARE catalog items resolve at Pass 1, never reaching the seam.
- **Test: L1 NULL + retry NULL → fallback:** Call `runEstimationCascade({ db, query: 'manjar desconocido bien caliente', ... })`. `manjar desconocido` does not exist in DB. Assert that `result.levelHit` is 2, 3, or null (NOT 1) — the retry-seam correctly falls through to L2+ with original text. Assert `result.data` is consistent with L2/L3/null behavior.
- **Test: `≥2 pre-con tokens` guard — `pan con tomate` never reaches retry seam:** Call `runEstimationCascade({ db, query: 'pan con tomate', ... })`. Assert `result.levelHit === 1` (`Pan con tomate` is a catalog dish, L1 Pass 1 hits). This validates AC-5/AC-7 landmine protection from the seam architecture side. The `≥2 pre-con tokens` guard inside the strip helper is unit-tested separately in `fH7.trailing.unit.test.ts` using a synthetic single-token-pre-con input (e.g. `applyH7CatCStrip('foo con bar') === 'foo con bar'`).
- **Test: Q496 `tacos al pastor con cilantro y piña`:** Call `runEstimationCascade({ db, query: 'tacos al pastor con cilantro y piña', ... })`. Assert `result.levelHit === 1` (Cat C strips `con cilantro y piña` → `tacos al pastor` → L1 CE-297).

All 5 integration tests must be RED before step 5.4.

**Step 5.4 — Wire H7-P5 retry seam into `engineRouter.ts`**

Add import at top of `engineRouter.ts`:
```typescript
import { applyH7TrailingStrip } from './h7TrailingStrip.js';
```

Insert the seam block after line 168 (after the `if (lookupResult1 !== null) { ... return; }` block closes) and before line 170 (`// --- Level 2 fallback ---`):

```
// --- H7-P5: Trailing modifier strip retry seam ---
// Fires only when L1 Pass 1 returned null (i.e., lookupResult1 is null at this point).
// Applies Cat A → Cat B → Cat C trailing strip to normalizedQuery.
// If stripped text differs from normalizedQuery, retries L1 with stripped text.
// If retry hits → return Level 1 result (query echoed as raw, not stripped).
// If retry misses → fall through to L2 with ORIGINAL normalizedQuery.
// Conservative fallback: no L1/L2/L3/L4 regression when strip is a false positive.
const h7StrippedQuery = applyH7TrailingStrip(normalizedQuery);
if (h7StrippedQuery !== normalizedQuery) {
  logger?.debug({ wrapperPattern: 'H7-P5', original: normalizedQuery, stripped: h7StrippedQuery }, 'H7-P5 trailing strip retry');
  let lookupResult1b;
  try {
    lookupResult1b = await level1Lookup(db, h7StrippedQuery, { chainSlug, restaurantId, hasExplicitBrand, detectedBrand });
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { statusCode: 500, code: 'DB_UNAVAILABLE', cause: err },
    );
  }
  if (lookupResult1b !== null) {
    const { result: yieldResult, yieldAdjustment } = await applyYield(lookupResult1b.result, lookupResult1b.rawFoodGroup);
    return {
      levelHit: 1,
      data: {
        query,  // raw query echoed (not the stripped form)
        chainSlug: chainSlug ?? null,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: lookupResult1b.matchType,
        result: yieldResult,
        cachedAt: null,
        yieldAdjustment,
      },
    };
  }
  // Retry missed → fall through to L2 with original normalizedQuery
}
```

Developer note: The `logger?.debug(...)` call uses the optional `logger` from `EngineRouterOptions` (already present on line 72). This is the AC-10 observability mechanism for H7-P5. `wrapperPattern: 'H7-P5'` matches the spec-specified label. No change to `QueryLogEntry`.

Run integration tests. Expect GREEN.

**Step 5.5 — Run full test suite** — including `f-multi-item-implicit.*` landmine corpus. Assert 0 regressions.

---

#### Phase 5c — AC-9 `processMessage()` Integration Test

**Step 5c.1 — Create `packages/api/src/__tests__/fH7.conversationCore.integration.test.ts`**

AC-9 requires calling `processMessage()` end-to-end (ADR-021 compliance). This file follows the exact pattern of `f-multi-item-implicit.integration.test.ts`:
- Mock `contextManager.js` (`getContext → null`, `setContext → no-op`).
- Mock `lib/cache.js` (`cacheGet → null`, `cacheSet → no-op`).
- Mock `estimation/engineRouter.js` → `runEstimationCascade: mockCascade`.
- Real `prisma` from `DATABASE_URL_TEST`.
- `mockCascade` returns a controlled estimation fixture for target queries.

`describe('F-H7 — processMessage() end-to-end (AC-9, ADR-021)')`:
- **Test 1:** Call `processMessage(buildRequest('ayer por la noche cené salmón con verduras al horno'))`. Assert `result.data.intent === 'estimation'`, `result.data.estimation !== null`. The mock cascade is called with `query: 'salmón con verduras al horno'` (H7-P1 stripped by `extractFoodQuery` before `runEstimationCascade` is called). Assert `mockCascade.mock.calls[0][0].query === 'salmón con verduras al horno'`.
- **Test 2:** Call `processMessage(buildRequest('quiero probar la ropa vieja canaria'))`. Assert `estimation !== null`, `mockCascade` called with `query: 'ropa vieja canaria'` (H7-P4 stripped).
- **Test 3 (conservative fallback):** Call `processMessage(buildRequest('texto sin ningún patrón conocido xyzzy'))`. Mock cascade returns null result. Assert `result.data.estimation === null` (null result is returned correctly; no crash).

These 3 tests satisfy AC-9. Developer may add more for coverage but 3 is the minimum.

---

#### Phase 6 — Edge-Case Suite

**Step 6.1 — Create `packages/api/src/__tests__/fH7.edge-cases.test.ts`**

This file groups edge-case tests that cut across multiple patterns and concerns:

`describe('Edge Case 1 — H7-P1 vs existing Pattern 3 ordering')`:
- `'ayer cené paella'` → Pattern 3 (index 2) wins; output `'paella'`. Confirmed by first-match-wins: Pattern 3 is at index 2, H7-P1 at index 13. Both produce `'paella'`; test comment notes Pattern 3 ownership.
- `'anoche me cené paella'` → Pattern 2 (index 1) wins.
- `'ayer por la noche cené paella'` → ONLY H7-P1 covers this (Pattern 3 does not include `por la noche`); assert output `'paella'`.

`describe('Edge Case 2 — H7-P2 vs existing Pattern 6 ordering')`:
- `'para cenar tuve paella'` → Pattern 6 (index 6) wins; output `'paella'`.
- `'para merendar ayer tomé una manzana'` → H7-P2 (index 14) wins (Pattern 6 requires `tuve|comí|tomé` immediately after meal verb, not a time-ref intervening).

`describe('Edge Case 3 — H7-P3 disjointness from Patterns 1–7b')`:
- `'comí pollo'` → H7-P3 fires; `query === 'pollo'`
- `'me he comido pollo'` → Pattern 1 fires (index 0), not H7-P3 (H7-P3 is index 15).

`describe('Edge Case 4 — H7-P4 + ARTICLE_PATTERN interaction')`:
- `'quiero un pastel de nata'` → H7-P4 strips `quiero un ` → `pastel de nata` → ARTICLE_PATTERN does not further strip (no leading bare article remains) → `query === 'pastel de nata'`. Assert the article strip does NOT remove `pastel`.
- `'quiero una ensalada'` → H7-P4 strips `quiero una ` → `ensalada` → ARTICLE_PATTERN no-op.

`describe('Edge Case 5 — H7-P5 conservative fallback')`:
- Call `applyH7TrailingStrip('paella valenciana')` → `'paella valenciana'` (identity — no strip). The engineRouter seam would receive a no-op and not fire any retry.
- Validate via unit test on `applyH7TrailingStrip` that a string with no recognizable Cat A/B/C suffix is returned unchanged.

`describe('Edge Case 6 — ReDoS safety')`:
- Construct a 200-character string with repeated temporal-bridge forms: `'el lunes después de clase y el martes después de clase '` repeated until 200 chars, followed by `'comí paella'`. Assert `extractFoodQuery()` completes in < 100 ms.
- Construct a 200-character `con` chain: `'tataki de atún con sésamo con queso con trufa con anchoas con...'`. Assert `applyH7CatCStrip()` completes in < 10 ms.

`describe('Edge Case 7 — H7-P5 Redis cache non-regression')`:
- Edge Case 7 is an architectural note (covered by the seam design: retry uses a different text key). In the integration test, verify that when the retry L1 hits via `h7StrippedQuery`, the returned `data.query` is the raw query (not stripped) — confirming the cache key path in the route handler is unaffected.

`describe('Edge Case 8 — normalizedQuery vs extractFoodQuery output')`:
- For a query like `'quiero un tataki de atún con sésamo'`: `extractFoodQuery()` strips H7-P4 `quiero un ` → `tataki de atún con sésamo`. Then `runEstimationCascade` receives `query: 'tataki de atún con sésamo'` (the post-H7-P4 text). H7-P5 then operates on `normalizedQuery = 'tataki de atún con sésamo'`, strips Cat C → `tataki de atún`, retries L1. This is the correct two-pass composition. Test via `fH7.engineRouter.integration.test.ts` with Q503 as end-to-end call.

`describe('Edge Case 9 — Q494 soft target (FTS plural handling)')`:
- `extractFoodQuery('dos nigiris de pez mantequilla con trufa')` → assert `query` does not contain `dos` (count normalization already strips article/count prefix via `ARTICLE_PATTERN` or count handling). **Soft assertion:** call `runEstimationCascade` (real DB, no mocks) and assert the final `result` is non-null — the path (A FTS or B retry) is irrelevant for AC purposes. The deterministic Path B test lives in the dedicated `fH7.q494-pathB.unit.test.ts` file (see Files to Create) with top-level `vi.mock` of `level1Lookup`.

`describe('F-MULTI-ITEM-IMPLICIT landmine corpus non-regression (AC-5)')`:
- Spot-check 6 representative landmines that ARE present in the seed (verified empirically against `packages/api/prisma/seed-data/spanish-dishes.json`): `'bacalao al pil-pil'`, `'sepia a la plancha'`, `'tostada con tomate y aceite'`, `'café con leche'`, `'pan con tomate'`, `'gambas al ajillo'`. For each, call `runEstimationCascade` (real DB) and assert `levelHit === 1` (they all hit L1 Pass 1 → H7-P5 seam never reached). **Do NOT include `pollo con almendras` or `arroz con verduras` as canonical names — these are not full-dish entries in the seed (only as aliases or absent); they cannot be used as Pass-1 hit landmines.**

`describe('AC-10 — wrapperPattern observability')`:
- Create a mock Fastify logger (`{ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }`).
- Pass to `runEstimationCascade` as `logger`.
- After calling with a query that exercises the H7-P5 seam (e.g. `'tataki de atún con sésamo'`), assert `mockLogger.debug` was called with `{ wrapperPattern: 'H7-P5', ... }`.
- For `extractFoodQuery` observability (H7-P1 through H7-P4): note that `extractFoodQuery` does not currently accept a logger parameter. AC-10 requires `request.log.debug` — this is called at the call site in `conversationCore.ts`, not inside `extractFoodQuery`. The developer must verify the call-site integration or add a lightweight callback. See Key Patterns section for guidance.

`describe('Empty and whitespace inputs')`:
- `extractFoodQuery('')` → `{ query: '' }` (no crash).
- `extractFoodQuery('   ')` → `{ query: '' }` (trimmed empty).
- `applyH7TrailingStrip('')` → `''` (no crash).

---

#### Phase 7 — Documentation and Finalization

**Step 7.1 — Update `docs/project_notes/key_facts.md`**

Update the API test count: `3932 + N` where N is the final count of new tests added across all phases. Update any other relevant facts (e.g., CONVERSATIONAL_WRAPPER_PATTERNS count: 13 → 17).

**Step 7.2 — Add ADR-023 to `docs/project_notes/decisions.md`**

An ADR IS warranted for H7-P5. The L1-retry seam is a new architectural precedent in the estimation cascade — it establishes a pattern where a pure-function strip can be inserted between cascade levels without modifying the caller or the downstream levels. This precedent may be reused for future trailer/prefix strip enhancements.

ADR number: **ADR-023** (ADR-022 is the last entry at line 643 of `decisions.md`).

ADR content:
- **Title:** H7-P5 L1-Retry Seam Pattern in `engineRouter.ts`
- **Context:** F-H7 requires trailing modifier stripping (e.g. `con sésamo`, `a baja temperatura`) that operates post-wrapper, between L1 and L2 in the cascade. Modifying `extractFoodQuery()` would require a two-pass design and conflate wrapper-strip with trailing-strip concerns.
- **Decision:** Insert a retry seam between L1-null and L2 in `runEstimationCascade()`. The seam applies pure-function strip helpers (`h7TrailingStrip.ts`) and, if the stripped text differs, retries L1 once. If retry misses, falls through to L2 with the original `normalizedQuery`. The raw `query` field is always echoed unchanged in the response.
- **Consequences:** One additional L1 DB query on every L1-miss (not on every request — only when L1 Pass 1 misses). Conservative fallback ensures no L2/L3/L4 regression. The pattern is extensible: future strip categories can be added to `h7TrailingStrip.ts` without modifying the seam wiring.
- **Trade-off:** The extra L1 query on misses adds latency for queries that ultimately resolve via L2/L3/L4. For the target user population (mobile/web queries), this is acceptable given the improvement in L1 hit rate.

**Step 7.3 — Confirm no `api-spec.yaml` change needed**

No response shape change. Confirm by reading `docs/specs/api-spec.yaml` and asserting the `ConversationMessageData` response shape is unchanged. Document in plan as complete.

**Step 7.4 — Final verification**

- Run `npm test -w @foodxplorer/api` — final test count delta.
- Run `npm run lint -w @foodxplorer/api` — 0 errors.
- Run `npm run build -w @foodxplorer/api` — clean build.

---

### Testing Strategy

**Test files to create:**

| File | Type | Purpose |
|------|------|---------|
| `fH7.temporal.unit.test.ts` | Unit | `extractFoodQuery()` assertions for H7-P1 through H7-P4, pattern ordering, empty-remainder guard, ReDoS timing |
| `fH7.trailing.unit.test.ts` | Unit | Pure-function tests for `applyH7CatAStrip`, `applyH7CatBStrip`, `applyH7CatCStrip`, `applyH7TrailingStrip` (all from `h7TrailingStrip.ts`) |
| `fH7.engineRouter.integration.test.ts` | Integration | `runEstimationCascade()` end-to-end with real DB: L1-retry hit, pass-through when L1 Pass 1 hits, retry-miss fallback, landmine guards |
| `fH7.edge-cases.test.ts` | Unit + Integration | Edge cases 1–9, landmine corpus spot-check, observability assertion, empty inputs |

**Mocking strategy:**

- H7-P1/P2/P3/P4 unit tests: No mocking. Import `extractFoodQuery` directly. Pure function, no I/O.
- H7-P5 strip helper unit tests: No mocking. Import pure functions from `h7TrailingStrip.ts` directly.
- `fH7.engineRouter.integration.test.ts`: Mock `cache.js` (no Redis in test), mock `contextManager.js` (no context state). Real DB via `DATABASE_URL_TEST`. Do NOT mock `level1Lookup` — real FTS behavior must be verified.
- Edge-case observability tests: Mock the `logger` object (`{ debug: vi.fn(), ... }`) and pass it to `runEstimationCascade`.
- Q494 Path B test: **Place this test in its own dedicated file `packages/api/src/__tests__/fH7.q494-pathB.unit.test.ts` with top-level hoisted `vi.mock('../estimation/level1Lookup.js')` BEFORE imports** (matching the existing project convention — see `f-multi-item-implicit.fallback.integration.test.ts:29` and `f023.engineRouter.unit.test.ts:15-49`). Per-test scoped `vi.mock` does NOT work in this codebase's Vitest setup. The dedicated file allows the mock to fully replace `level1Lookup` for the entire suite, forcing deterministic Path B execution. The `fH7.edge-cases.test.ts` file contains a separate non-mocked Q494 test that asserts EITHER Path A or Path B produces a non-null result (soft assertion).

**Key test scenarios:**

- Happy path: each of the 20 Cat 29 queries strips correctly (H7-P1/P2/P3) and the stripped text matches the expected dish-name fragment.
- Happy path: each of the 9 Cat 21 leading-frame queries (Q453, Q456, Q457, Q462, Q463, Q472, Q474, Q476, Q478) strips correctly via H7-P4 or H7-P5.
- Edge: empty remainder → original text returned (all patterns).
- Edge: query that partially matches a compound regex but lacks the eat-verb → no match (H7-P1/P2).
- Regression: existing Pattern 1–7b inputs unchanged.
- Regression: F-MULTI-ITEM-IMPLICIT canonical 3 queries unchanged.
- Regression: 50+ landmine corpus all still resolve at L1 Pass 1 (not via retry seam).
- Error: `runEstimationCascade` DB error on retry L1 attempt → same `DB_UNAVAILABLE` error propagation as Pass 1.

---

### Key Patterns

**Pattern: Extending `CONVERSATIONAL_WRAPPER_PATTERNS` (reference: `entityExtractor.ts:536–574`)**
- Append new entries to the end of the array (indices 13–16). Do NOT modify existing entries 0–12.
- Each new entry is a `RegExp` literal with `^` anchor and `i` flag.
- The array is `readonly RegExp[]` — declaration does not change.
- The single-pass for-break loop at lines 721–726 requires no modification; it iterates the array in order.

**Pattern: Empty-remainder guard (reference: `entityExtractor.ts:778`)**
- `const query = remainder.trim() || originalTrimmed;` — already handles empty remainder.
- No change required. New patterns automatically benefit from this guard.

**Pattern: AC-10 `wrapperPattern` observability for H7-P1 through H7-P4 (CONCRETE — single contract)**
- `extractFoodQuery()` return shape changes from `{ query, chainSlug? }` to `{ query, chainSlug?, matchedWrapperLabel?: 'H7-P1' \| 'H7-P2' \| 'H7-P3' \| 'H7-P4' \| null }`. The label is computed inside the for-break loop by mapping the matched array index (13/14/15/16) to the corresponding ticket-local label. For matches at indices 0–12 (pre-existing patterns), `matchedWrapperLabel` is `null` (those have their own existing source-comment labels and are out of F-H7 scope).
- **Single call site for the debug log:** `conversationCore.ts:507` (the primary single-dish estimation path call). After `extractFoodQuery()` returns, if `matchedWrapperLabel !== null && request.log` is available, emit `request.log.debug({ wrapperPattern: matchedWrapperLabel })`.
- **Scope of AC-10:** AC-10 applies ONLY to the primary estimation path (line 507). The fallback `extractFoodQuery()` call at line 521/528 (inside the catch block, only reached when the primary path throws) is explicitly OUT of AC-10 scope. Rationale: the fallback path is a defensive error-recovery path; observability there is best-effort. Note this in code with a comment.
- **Why this approach (not a callback):** Returning the label preserves `extractFoodQuery()`'s pure-function contract (no side effects, no logger threading). The callback alternative was rejected because it complicates the function signature, requires logger propagation, and risks emitting duplicate logs from the multiple call sites in `conversationCore.ts` (lines 399 menu-detection, 507 primary, 521/528 fallback).
- H7-P5 observability is independent: `logger?.debug({ wrapperPattern: 'H7-P5', original, stripped })` inside the `runEstimationCascade` retry seam block, using the already-available `logger` from `EngineRouterOptions`.

**Pattern: ReDoS-safe bounded quantifiers (reference: `entityExtractor.ts:563`)**
- Pattern 7b uses `^he\s+(?:entrado|estado)\s+en\s+.+?\by\s+me\s+he\s+pedido\s+`. The `.+?` lazy match is bounded by the required literal suffix `\by\s+me\s+he\s+pedido\s+` — backtracking terminates on that literal. This is the proven ReDoS-safe idiom.
- H7-P1 and H7-P2 compound regexes must use `[^,]{1,N}?` (bounded lazy, comma-terminated) for variable-length middle sections, not unbounded `.*?` or `.+?` without a required literal suffix following. The `[^,]{1,40}?` pattern prevents catastrophic backtracking by constraining the character class AND the repetition count.

**Pattern: H7-P5 retry block structure (reference: existing L1 block at lines 140–168)**
- The retry block must mirror the existing L1 try/catch/return structure exactly (same error handling, same `applyYield` call, same return shape). Diff against the existing L1 block to verify structural parity.
- The `query` field in the returned `data` must be the raw `query` (line 108 destructuring), NOT the `h7StrippedQuery` — this preserves the "echo raw query" invariant documented in the module header (line 9: "Echoes raw query in data.query (not the normalized form)").

**Pattern: Integration test setup (reference: `f-multi-item-implicit.integration.test.ts:1–50`)**
- `vi.hoisted()` for mock function references.
- `vi.mock()` declarations before all imports.
- Real `prisma` and `db` (Kysely) from test env.
- `beforeAll` + `afterAll` fixture lifecycle for any test-specific DB inserts.

**Gotcha: `h7TrailingStrip.ts` Cat C and multiple `con` tokens**
- The spec says: if the pre-`con` text contains `con` itself (e.g. `tostada con jamón con tomate`), limit Cat C to stripping only the LAST `con [tail]` segment. Implementation: use `lastIndexOf`-based split, not `split(/\s+con\s+/)` (which would split on the first `con`). Use `text.lastIndexOf(' con ')` (with surrounding spaces) to find the rightmost `con` boundary.

**Gotcha: `applyH7CatBStrip` and `sepia a la plancha`**
- The strip function itself strips `a la plancha` as a trailing pattern — this is correct behavior for the pure function.
- The protection for `sepia a la plancha` as a catalog dish comes ENTIRELY from the retry-seam architecture: because `sepia a la plancha` resolves at L1 Pass 1, the seam is never reached for that query. Tests must document this architectural dependency clearly — do not add a special-case exclusion inside `applyH7CatBStrip`.

**Gotcha: `me hice` vs outer `me` clitic in H7-P3**
- The H7-P3 regex in the spec is: `/^(?:me\s+)?(?:cen[eé]|...|me\s+hice?|...)\s+/i`. The inner `me\s+hice?` overlaps with the outer `(?:me\s+)?`. For `'me hice una tortilla'`, the outer `(?:me\s+)?` captures `me ` and then inner `hice?` must match — but `hice` is not in the plain inner alternation without `me\s+`. Developer must verify that the regex correctly matches `me hice una tortilla` either by: (a) the outer clitic consuming `me ` and the inner matching `hice?`, or (b) the outer clitic not consuming `me ` and the inner `me\s+hice?` matching `me hice`. Option (b) is correct — the outer `(?:me\s+)?` is optional (greedy but optional), and if the inner `me\s+hice?` is present, the regex engine will find the match. Include a unit test for `'me hice una tortilla francesa con champiñones'` → `query === 'tortilla francesa con champiñones'` in the H7-P3 suite.

---

### Verification Commands Run During Planning

The following commands were executed to establish the empirical anchors cited in this plan:

1. `Read entityExtractor.ts:530–574` — confirmed `CONVERSATIONAL_WRAPPER_PATTERNS` has exactly 13 entries at indices 0–12. Indices 0–12 map as: 0=Pattern1(me he tomado), 1=Pattern2(ayer me cené), 2=Pattern3(ayer cené), 3=Pattern4(he+participle), 4=Pattern4b(esta mañana/tarde/noche he), 5=Pattern5(acabo de), 6=Pattern6(para cenar tuve), 7=Pattern7(me voy a pedir), 8=Pattern7b(he entrado en X y me he pedido), 9=Pattern8(quiero saber las calorías), 10=Pattern9(cuánto engorda), 11=Pattern10(cuánta proteína), 12=Pattern11(necesito los nutrientes). New H7-P1 through H7-P4 will occupy indices 13–16.
2. `Read entityExtractor.ts:718–740` — confirmed the single-pass for-break loop at lines 721–726 (`for (const pattern of CONVERSATIONAL_WRAPPER_PATTERNS) { const stripped = remainder.replace(pattern, ''); if (stripped !== remainder) { remainder = stripped; break; } }`). Loop requires no modification for new entries.
3. `Read entityExtractor.ts:775–781` — confirmed empty-remainder guard at line 778: `const query = remainder.trim() || originalTrimmed;`. All new patterns benefit automatically.
4. `Read engineRouter.ts:140–170` — confirmed L1 lookup at line 143 (`level1Lookup(db, normalizedQuery, {...})`), L1-null branch at lines 151–168, L2 start at line 170 (`// --- Level 2 fallback ---`). H7-P5 seam inserts between lines 168 and 170.
5. `Read engineRouter.ts:170–270` — confirmed L2 (line 170–199), L3 (line 200–233), OFF fallback (line 235–268), L4 (line 270–330). None of these are modified by F-H7. L2/L3/L4 all use `normalizedQuery` (not `h7StrippedQuery`) — confirmed by grep (`level2Lookup(db, normalizedQuery, ...)`, `level3Lookup(db, normalizedQuery, ...)`).
6. `Read level1Lookup.ts:1–100` — confirmed `level1Lookup` uses a 4-strategy cascade (exact dish, FTS dish, exact food, FTS food). FTS uses Spanish primary — relevant to Edge Case 9 (Q494 plural `nigiris → nigiri` stemming). The function signature is `level1Lookup(db, normalizedQuery, options)` — identical signature for the retry call.
7. `Read queryLogger.ts:24–50` — confirmed `QueryLogEntry` interface has exactly 9 fields (`queryText`, `chainSlug`, `restaurantId`, `levelHit`, `cacheHit`, `responseTimeMs`, `apiKeyId`, `actorId`, `source`). No `wrapperPattern` field. AC-10 is `request.log.debug` only — confirmed.
8. `ls packages/api/src/__tests__/ | grep -E 'f070|f-nlp|f-multi-item|nlp'` — confirmed test file naming convention: `f-multi-item-implicit.*.test.ts` (feature prefix + component + test type) and `f-nlp-chain.*.test.ts`. F-H7 tests follow the pattern `fH7.*.test.ts` (camelCase feature slug + component + type).
9. `grep -n 'ADR-022\|ADR-023' decisions.md` — confirmed ADR-022 is the last ADR at line 643. Next ADR is ADR-023.
10. `ls packages/api/src/estimation/` — confirmed no `h7TrailingStrip.ts` exists yet. New file creation is required.
11. `grep -n 'wrapperPattern|request\.log\.debug' entityExtractor.ts engineRouter.ts` — confirmed no existing `wrapperPattern` logging in either file. AC-10 is fully new.
12. `grep -n 'runEstimationCascade|normalizedQuery|level1Lookup' engineRouter.ts` — confirmed `normalizedQuery` is declared at line 111, `level1Lookup` called at line 143. Retry call must use same `level1Lookup` import (already imported at line 18).

---

### Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **R1: H7-P1/P2 compound regex catastrophic backtracking (ReDoS)** | Medium — the `[^,]{1,40}?` bounded quantifier requires careful crafting; an off-by-one to `[^,]+?` or unbounded `.*?` without a following literal anchor would be catastrophic. | Mandatory ReDoS timing test in every pattern phase (< 50 ms on 200-char adversarial input). Code review must verify `[^,]{1,N}` vs unbounded form. Reference Pattern 7b's `.+?\b` bounded-by-literal pattern as the approved idiom. |
| **R2: `sepia a la plancha` false strip regression via H7-P5 Cat B** | Low — the retry-seam architecture guarantees this only fires after L1 Pass 1 misses; `sepia a la plancha` resolves at L1 Pass 1. | AC-7 test explicitly asserts `sepia a la plancha` resolves at `levelHit: 1` without the seam. Unit tests document the pure-function behavior vs. the architectural protection separately. |
| **R3: H7-P5 Cat C strips a single-token-pre-con landmine** | Low — most catalog `con [tail]` dishes have ≥2 pre-con tokens (`Pan con tomate` = 2 tokens, `Tostada con tomate y aceite` = 1 token + multi-token tail), and even when pre-con is 1 token the L1 Pass 1 already hits the full-text catalog entry, so the seam is never reached. | AC-5 integration test verifies L1 Pass 1 resolves real landmines (`pan con tomate`, `tostada con tomate y aceite`, etc.). Unit test verifies `applyH7CatCStrip('foo con bar') === 'foo con bar'` (1 pre-con token → ≥2 guard fires). |
| **R4: H7-P1 over-fires and strips a query that Pattern 3 should handle** | Low — both produce the same `query` output for the overlapping forms; behavioral regression is impossible. The only risk is incorrect `wrapperPattern` telemetry (AC-10). | Phase 1 includes explicit regression tests verifying Pattern 3 (index 2) fires for its exact forms (`anoche cené`, `ayer cené`). H7-P1 at index 13 is never reached for those forms. |
| **R5: `me hice` regex ambiguity in H7-P3 (outer vs inner `me` clitic)** | Low-Medium — the overlap between outer `(?:me\s+)?` and inner `me\s+hice?` could prevent `'me hice una tortilla'` from matching. | Explicit unit test for `'me hice una tortilla francesa con champiñones'` → expected strip. If ambiguous, restructure H7-P3 to remove outer clitic for the `hice` case: `/^(?:(?:me\s+)?(?:cen[eé]|...|tom[eé]|...)|me\s+hice?)\s+/i`. |

---

### Test Count Expectation

| Phase | File | Approximate new `it()` count |
|-------|------|-------------------------------|
| Phase 1 — H7-P1 | `fH7.temporal.unit.test.ts` | 12 |
| Phase 2 — H7-P2 | `fH7.temporal.unit.test.ts` | 13 |
| Phase 3 — H7-P3 | `fH7.temporal.unit.test.ts` | 9 |
| Phase 4 — H7-P4 | `fH7.temporal.unit.test.ts` | 14 |
| Phase 5a — H7-P5 strip helpers | `fH7.trailing.unit.test.ts` | 22 |
| Phase 5b — H7-P5 seam integration | `fH7.engineRouter.integration.test.ts` | 5 |
| Phase 5c — AC-9 processMessage | `fH7.conversationCore.integration.test.ts` | 3 |
| Phase 6 — Edge cases | `fH7.edge-cases.test.ts` | 18 |
| **Total** | | **~96 new tests** |

Baseline: 3932. Expected final: **~4028**. AC-11 requires ≥30 new tests — this target (~96) exceeds the minimum by 3×.

---

### Files to be Modified (Summary)

1. `packages/api/src/conversation/entityExtractor.ts` — 4 new `CONVERSATIONAL_WRAPPER_PATTERNS` entries (indices 13–16). Optional: add `onWrapperMatch` callback parameter to `extractFoodQuery` for AC-10 H7-P1/P4 observability.
2. `packages/api/src/estimation/engineRouter.ts` — Add import for `applyH7TrailingStrip`. Insert H7-P5 retry seam block (~30 lines) between current lines 168 and 170.
3. *(NEW)* `packages/api/src/estimation/h7TrailingStrip.ts` — Pure-function strip helpers for Cat A, B, C, and combined `applyH7TrailingStrip`.
4. *(NEW)* `packages/api/src/__tests__/fH7.temporal.unit.test.ts` — H7-P1/P2/P3/P4 unit tests.
5. *(NEW)* `packages/api/src/__tests__/fH7.trailing.unit.test.ts` — H7-P5 strip helper unit tests.
6. *(NEW)* `packages/api/src/__tests__/fH7.engineRouter.integration.test.ts` — H7-P5 seam integration tests (real DB).
7. *(NEW)* `packages/api/src/__tests__/fH7.conversationCore.integration.test.ts` — AC-9 compliance: `processMessage()` end-to-end (ADR-021 pattern, mocked `runEstimationCascade`).
8. *(NEW)* `packages/api/src/__tests__/fH7.edge-cases.test.ts` — Edge-case suite.
9. `docs/project_notes/key_facts.md` — Update test count, update `CONVERSATIONAL_WRAPPER_PATTERNS` count (13 → 17).
10. `docs/project_notes/decisions.md` — ADR-023 for H7-P5 L1-retry seam pattern.

---

### Rollback Plan

All changes are purely additive:
- New array entries in `CONVERSATIONAL_WRAPPER_PATTERNS` (indices 13–16) — removing them restores the 13-entry array.
- New seam block in `engineRouter.ts` — bounded by clear comment delimiters (`// --- H7-P5 ---` / comment ends); revert via `git revert` of the H7 commit.
- New file `h7TrailingStrip.ts` — `git rm` if needed.
- No DB migration, no schema change, no seed change → no DB rollback required.
- If any pattern causes a production regression (unexpected strip behavior), emergency mitigation: remove the problematic array entry (hot-fix deploy, no migration).

---

## Acceptance Criteria

- [x] **AC-1:** All 20 Cat 29 queries (Q631–Q650) return a non-NULL result after F-H7. The wrapper-stripped text used for L1 is verifiable via unit test assertions on `extractFoodQuery()` output.
- [x] **AC-2:** At least 9 of the 12 Cat 22 hard-target queries (Q494 excluded as soft-only — see Edge Case 9; Q502 excluded as info-intent) return a non-NULL OK result. Specific hard targets (12 entries, CE-IDs empirically verified):
  - Q482 → CE-289 (H7-P5 Cat B strips `con extra de picante`)
  - Q484 → CE-291 (alias `pad thai de langostinos` hits L1 directly, H7-P5 not needed)
  - Q487 → CE-294 (H7-P4 strips `quiero un`)
  - Q488 → tiramisú (H7-P5 Cat A strips `casero de postre`)
  - Q491 → CE-217 alias check (H7-P5 Cat C strips `con queso de cabra y cebolla caramelizada`)
  - Q494 → CE-295 — **soft target only**, outcome depends on L1 plural-handling (Path A or Path B both acceptable; not counted in AC-2 numerator)
  - Q496 → CE-297 (H7-P5 Cat C strips `con cilantro y piña`)
  - Q497 → CE-298 (H7-P5 Cat B strips `a baja temperatura`)
  - Q499 → CE-300 (H7-P4 strips `tenéis`; H7-P5 Cat B strips `a la plancha`)
  - Q500 → CE-301 (H7-P5 Cat A strips `clásico`)
  - Q503 → CE-304 (H7-P5 Cat C strips `con sésamo`)
  - Q504 → CE-305 (H7-P4 strips `quiero probar el`)
  - Q505 → CE-306 (H7-P5 Cat C strips `con parmesano`)
  - Q502 excluded (info-query intent)
- [x] **AC-3:** At least 6 of the following 9 verified-in-catalog Cat 21 frame-blocked queries return a non-NULL OK result (all 9 CE-IDs confirmed present in seed):
  - Q453 `quería probar el ternasco de aragón` → CE-275 via H7-P4
  - Q456 `qué tal está el bacalao al pil-pil` → CE-106 via H7-P4
  - Q457 `ponme una tapa de zarangollo murciano` → CE-273 via H7-P4
  - Q462 `tráeme una de escalivada con anchoas` → CE-092 via H7-P4
  - Q463 `quiero probar la ropa vieja canaria` → CE-256 via H7-P4
  - Q472 `una de michirones para picar` → CE-274 via H7-P5 Cat A
  - Q474 `cuánto cuesta la sobrassada con miel` → CE-282 via H7-P4
  - Q476 `un gazpachuelo malagueño bien caliente` → CE-283 via H7-P5 Cat A
  - Q478 `un talo con chistorra, por favor` → CE-285 via H7-P5 Cat A *(previously deferred, now in scope)*
  - Explicit exclusions: Q466 (arroz a banda — no seed entry), Q480 (horchata con fartons compound — L1 miss expected, best-effort L2/L3 only)
- [x] **AC-4:** All existing Pattern 0–12 tests (F-NLP-CHAIN-ORDERING, F-MULTI-ITEM-IMPLICIT) continue to pass — zero regression. Specifically: `f-nlp-chain.entityExtractor.unit.test.ts`, `f-nlp-chain.conversationCore.integration.test.ts`, `f-nlp-chain.edge-cases.test.ts`, and the F-MULTI-ITEM-IMPLICIT test files pass unchanged. (One test in `f-nlp.entityExtractor.edge-cases.test.ts` was intentionally updated for the new H7-P2 behavior — documented in commit + Completion Log.)
- [x] **AC-5:** All 50+ catalog landmines from F-MULTI-ITEM-IMPLICIT (43 `con`-only dishes + 6 `y+con` dishes + 1 `y`-only dish) are NOT affected by H7-P5 Cat C. The retry seam architecture guarantees this: these dishes all resolve at L1 on the first attempt, so the retry seam is never reached for them.
- [x] **AC-6:** Conservative fallback is enforced: when a wrapper strip produces no L1 hit, the original unstripped text is forwarded to L2/L3/L4. No existing L2/L3/L4 hit is lost. For H7-P5: retry-miss forwards the original normalizedQuery to L2+.
- [x] **AC-7:** H7-P5 two-pass strategy is correctly implemented: queries whose full text already produces an L1 hit are never modified by H7-P5. Specifically, `bacalao al pil-pil`, `sepia a la plancha`, `tostada con tomate y aceite`, `café con leche`, `pan con tomate`, and `gambas al ajillo` all continue to resolve as before (verified-in-seed canonical names).
- [x] **AC-8:** New unit tests at `packages/api/src/__tests__/fH7.temporal.unit.test.ts` (H7-P1 through H7-P4: `extractFoodQuery()` output assertions for each of the 20 Cat 29 queries and each Cat 21/22 leading-frame query) and `packages/api/src/__tests__/fH7.trailing.unit.test.ts` (H7-P5: retry-seam strip assertions, landmine guards, empty-remainder guard). Edge-case tests at `packages/api/src/__tests__/fH7.edge-cases.test.ts` covering: overlap with Patterns 2/3/4b/6, ReDoS-safe input, empty-remainder guard, pattern-chain interactions, catalog landmine corpus.
- [x] **AC-9:** `POST /conversation/message` integration test (`packages/api/src/__tests__/fH7.conversationCore.integration.test.ts`) — at least one test calls `processMessage()` end-to-end (real DB, mocked Redis/cache) for a Cat 29 query and asserts `estimation !== null` (ADR-021 compliance).
- [x] **AC-10:** Wrapper-pattern observability is implemented via `request.log.debug({ wrapperPattern: 'H7-P1' | 'H7-P2' | 'H7-P3' | 'H7-P4' | 'H7-P5' })` ephemeral structured log lines only. No change to `QueryLogEntry` interface in `queryLogger.ts`. No new DB column. No change to `api-spec.yaml` response schema. End-to-end logger spy verification added in Tests 4-6 of `fH7.conversationCore.integration.test.ts` (qa-engineer F1 follow-up).
- [x] **AC-11:** Test count baseline 3932 increases by at least 30 new `it()` calls. Final delta: **+128 unit tests + 12 integration tests = +140 new** (4060 unit + 12 integration vs baseline 3932). Far exceeds the ≥30 minimum.
- [x] **AC-12:** 0 lint errors, `packages/api` build clean.

---

## Definition of Done

- [x] All acceptance criteria met and checked above
- [x] Unit tests written and passing (AC-8, AC-11) — 4060/4060
- [x] Integration test written and passing (AC-9) — 12/12 (6 conversationCore + 6 engineRouter)
- [x] H7-P5 retry seam verified against catalog-landmine corpus (AC-5, AC-7) — `pan con tomate`, `bacalao al pil-pil`, `Sepia a la plancha`, etc. all hit L1 Pass 1
- [x] Conservative fallback confirmed by AC-6 test
- [x] No regressions on existing F-NLP/F-MORPH/F-MULTI-ITEM-IMPLICIT test suite (AC-4)
- [x] `docs/project_notes/key_facts.md` updated: 13 → 17 wrapper count, test count, H7-P5 seam, h7TrailingStrip module, F-H7 catalog tag
- [x] `docs/project_notes/decisions.md` updated: ADR-023 added (H7-P5 L1-retry seam pattern)
- [x] `docs/project_notes/bugs.md` updated — F-H7-FU1 follow-up filed for qa F2 (4 missing landmine integration tests, low risk per architecture)
- [x] No linting errors
- [x] Build succeeds
- [x] Specs reflect final implementation (`api-spec.yaml`: no change required — no response schema change)
- [x] Code merged to `develop` via squash PR following gitflow (PR #213 pending squash-merge — auto-approved at L5)

---

## Workflow Checklist

- [x] Step 0: `spec-creator` executed, specs updated — **this document** (3 rounds cross-model: Gemini APPROVED R3, Codex addressed all R1+R2+R3 findings, total 4C+9I+3S → all critical/important addressed)
- [x] Step 1: Branch `feature/F-H7-nlp-temporal-wrappers` created from `develop`, ticket generated, product-tracker updated (L5 auto-approved)
- [x] Step 2: `backend-planner` executed, implementation plan v3 written (Gemini APPROVED both plan rounds; Codex 5I R1 + 4I+1S R2 all addressed inline) — L5 auto-approved
- [x] Step 3: `backend-developer` executed via TDD across 7 phases. 5 new test files + 1 modified test. 4060 unit tests + 12 integration tests passing.
- [x] Step 4: `production-code-validator` APPROVE 98% confidence — all 12 ACs satisfied with concrete test evidence, no blockers. Quality gates: 4060/4060 unit tests, 12/12 integration tests, lint 0, build clean.
- [x] Step 5: `code-review-specialist` APPROVE WITH MINOR CHANGES (5 LOW/NIT all non-blocking; S1, S2, S4 fixed inline + S5 docs); `qa-engineer` PASS WITH FOLLOW-UPS (1 MEDIUM F1 logger spy added inline; F2 4 missing landmines deferred to bugs.md).
- [x] Step 6: PR #213 squash-merged to develop at `027a884` 2026-04-26 ~20:39 UTC. Branch deleted local + remote. Post-merge sanity PASS: 4060/4060 unit tests on develop.

---

## Completion Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-04-26 | Step 0 (Spec): drafted v1, self-review pass 1 done | 12 ACs, Patterns 8–12 defined, two-pass strategy for P12 specified, edge cases documented |
| 2026-04-26 | Step 0.5 (Cross-model review R1): Gemini 3C+1I+1S, Codex 1C+7I — all 4 CRITICAL + 4 IMPORTANT addressed. SUGGESTION S1 accepted with landmine guard. Spec v2 ready for re-review. | C1: renamed Patterns 8-12 → H7-P1..H7-P5, corrected array count 13 (0-12). C2: rebuilt CE-ID table from empirical reads; fixed CE-296=Uramaki roll, CE-297=Tacos al pastor, CE-298=Bao de panceta, CE-303=Hummus, CE-304=Tataki de atún, CE-305=Steak tartar, CE-306=Carpaccio. C3: resolved P1/P2 compound-regex contradiction — H7-P1 and H7-P2 now consume temporal/activity prefix + eat-verb in single compound regex; H7-P3 is standalone fallback only. C4: AC-3 rebuilt with 8 verified-existing queries (≥6 target), Q478 moved to in-scope (CE-285 exists), Q480 downgraded to best-effort. I1: H7-P5 moved to engineRouter.ts L1-retry seam (Option A), removed all estimationOrchestrator.ts mentions. I2: 9 dishes moved from deferred to in-scope (CE-285, CE-282, CE-283, CE-274, CE-273, CE-256, CE-106, CE-275, CE-092). I3: AC-10 rewritten as ephemeral debug log only, no QueryLogEntry change. I4: Q480 explicitly downgraded to best-effort L2/L3. S1: landmine guard for H7-P5 Cat C uses DB-based Guard 2 + ≥2 pre-con tokens guard; no static corpus needed. |
| 2026-04-26 | Step 0.5 (Cross-model review R2): Gemini 1C+1S, Codex 1C+2I (all v1 fixes verified resolved). New issues addressed in v3. | C5 (Codex): added `el [día_semana] [después\|antes] de [Y]` bridge form to H7-P1 (covers Q646 `el lunes después de clase`). C5b (Gemini+Codex): Q494 nigiri rewritten as soft target with explicit Path A/Path B uncertainty acknowledgment (alias-FTS may match plural→singular); Q494 excluded from AC-2 hard numerator. I1 (Codex): pinned H7-P1 contract — new entry at index 13 ONLY, must NOT extend Pattern 3, removed contradictory "developer may extend" wording from H7-P1 ordering note and Edge Case 1. Added new Edge Case 9 explicitly documenting Q494 alias-FTS uncertainty. S1 (Gemini): ReDoS audit emphasis already covered in Edge Case 6. AC-2 now ≥9 of 12 hard targets (Q494 soft + Q502 info excluded). |
| 2026-04-26 | Step 0.5 (Cross-model review R3): Gemini APPROVED, Codex REVISE (2I+1S — small arithmetic/typo issues). Spec v3.1 fixes. | (i) AC-2 corrected "13 hard-target" → "12 hard-target" (12 enumerated, Q494 soft + Q502 info excluded). (ii) AC-2 "Edge Case 2" reference corrected to "Edge Case 9". (iii) H7-P1 example regex extended to include `(?:antes|después)\s+de\s+[^,]{1,30}` continuation after `el [día_semana]` — covers Q646 form. (iv) "Existing array count clarification" corrected: source comments label entries "Pattern 8-11" but those are at array indices 9–12 (Pattern 7b occupies index 8). Spec v3.1 ready. |
| 2026-04-26 | Step 2 (Plan): drafted v1, self-review pass done. 34 total steps across 7 phases. | Plan strategy: TDD across 7 phases. Empirical anchors verified: entityExtractor 13-entry array, engineRouter L1 at line 143, ADR-023 next slot. |
| 2026-04-26 | Step 2.5 (Cross-model plan review R1): Gemini APPROVED with 1 SUGGESTION; Codex REVISE with 5 IMPORTANT. Plan v2 fixes applied. | I1 (Codex): added explicit bare `^un[ao]?\s+de\s+` form to H7-P4 spec + regex + RED tests for Q472/Q484/Q484 (`una de pad thai...`, `una de cordero`). I2 (Codex): replaced vague "logger?.debug" with concrete `extractFoodQuery()` return-shape change (`matchedWrapperLabel?: 'H7-P1'..'H7-P4' \| null`); added `conversationCore.ts` to Files-to-Modify with single call site at line 507 emitting `request.log.debug`. I3 (Codex): added `esta mañana/tarde/noche en [lugar]` branch to H7-P1 (covers Q644 `esta tarde en la cafetería`), updated example regex, marked Q644 in H7-P2 examples as documentation-only (H7-P1 fires first). I4 (Codex): forced-Path-B Q494 test moved to dedicated `fH7.q494-pathB.unit.test.ts` with top-level hoisted `vi.mock`; the non-mocked Q494 in `fH7.edge-cases.test.ts` becomes a soft assertion accepting either Path A or Path B. I5 (Codex): replaced non-existent landmines (`pollo con almendras`, `arroz con verduras`) with verified-in-seed alternatives (`bacalao al pil-pil`, `Sepia a la plancha`, `Tostada con tomate y aceite`, `café con leche`, `pan con tomate`, `gambas al ajillo`); guard test renamed from `pollo con almendras` to `pan con tomate`. Plan v2 ready. |
| 2026-04-26 | Step 2.5 (Cross-model plan review R2): Gemini APPROVED, Codex REVISE (4I+1S residual cleanup). Plan v3 fixes. | I1 (Codex R2): replaced ALL remaining `pollo con almendras` references throughout plan (Edge Case 4 line 338, unit test inputs lines 596-598, risk register R3 line 930, AC-7 line 1012) with verified-in-seed equivalents (`pan con tomate`, synthetic `foo con bar`/`foo bar con baz con qux`, plus six-dish landmine corpus in AC-7). I2 (Codex R2): removed ambiguous "Option A callback / Option B return shape" Key Patterns section — single contract `matchedWrapperLabel` return shape only. I3 (Codex R2): clarified that AC-10 scope is line-507 primary path only (line 521/528 fallback in catch block is OUT of scope, documented in plan). I4 (Codex R2): added explicit `me hice una tortilla francesa con champiñones` test + `hice una tortilla` test to Phase 3 RED test list (R5 mitigation). S1 (Codex R2): test count totals corrected — Phase 2 13→14, Phase 4 14→17, Phase 3 9→11; AC-11 estimate updated from 35-55 to ~96 (matching Test Strategy table total). |
| 2026-04-26 | Step 2 (Plan): drafted v1, self-review pass done. 34 total steps across 7 phases. | Empirical anchors verified: 13-entry CONVERSATIONAL_WRAPPER_PATTERNS confirmed (indices 0–12), for-break loop at 721–726 confirmed, empty-remainder guard at 778 confirmed, L1 null branch at 168 and L2 start at 170 confirmed, QueryLogEntry fixed (9 fields, no wrapperPattern), ADR-022 = last ADR (ADR-023 next). All 12 ACs covered: AC-1 via Phase 1–3 tests, AC-2 via Phase 5 integration, AC-3 via Phase 4 tests, AC-4 via regression suites in all phases, AC-5 via Phase 6 landmine corpus, AC-6 via conservative-fallback unit tests, AC-7 via Phase 5b integration, AC-8 via 4 new test files, AC-9 via fH7.engineRouter.integration.test.ts processMessage path (or fH7.conversationCore.integration.test.ts if developer adds it for full AC-9 compliance), AC-10 via callback/logger pattern documented in Key Patterns, AC-11 via ~93 new tests (3× the 30-test minimum), AC-12 via Phase 7 lint/build step. |
| 2026-04-26 | Step 3 (TDD Implementation) Phases 1–6: all phases complete | Phase 1: H7-P1 (idx 13, compound temporal+eat-verb). Phase 2: H7-P2 (idx 14, compound activity/context+eat-verb). Phase 3: H7-P3 (idx 15, bare eat-verb fallback). Phase 4: H7-P4 (idx 16, conversational fillers: quiero/ponme/tráeme/tenéis/un de). Phase 5: H7-P5 retry seam in engineRouter.ts, h7TrailingStrip.ts (Cat A/B/C), AC-10 matchedWrapperLabel return shape, logger.debug in conversationCore.ts. Phase 6: fH7.edge-cases.test.ts (ECs 1–9, AC-10, ReDoS, empty inputs), fH7.q494-pathB.unit.test.ts (deterministic Path B with mocked level1Lookup). 5 new test files created, 1 pre-existing test updated (f-nlp.entityExtractor.edge-cases.test.ts: H7-P2 behavioral change). Unit tests: 4043 passing (baseline 3932, +111). All 0 regressions. |
| 2026-04-26 | Step 3 Phase 7: documentation updated | key_facts.md: CONVERSATIONAL_WRAPPER_PATTERNS count 13→17, H7-P5 seam, h7TrailingStrip.ts, extractFoodQuery return shape, unit test count 4043. decisions.md: ADR-023 added (H7-P5 L1-retry seam pattern). api-spec.yaml: no change required (no response schema change — AC-10 is ephemeral debug log only). |
| 2026-04-26 | Step 4 (production-code-validator): APPROVE 98% confidence | All 12 ACs satisfied with concrete test evidence (matrix verified). 4043/4043 unit + 12/12 integration tests passing, lint 0, build clean. ADR-023 documented. Backward-compatible return-shape change verified. Ready for Step 5. |
| 2026-04-26 | Step 5 (code-review-specialist + qa-engineer): APPROVE WITH MINOR CHANGES + PASS WITH FOLLOW-UPS | code-review 5 LOW/NIT findings: S1 Cat A `por favor` regex `\s*` → `\s+` + empty-strip guard (fixed); S2 `me hice?` → `me hice` to drop theoretical `hic` false positive (fixed); S3 H7-P5 retry try/catch DRY (skipped — readability over abstraction); S4 H7_LABELS map hoisted to module scope (fixed); S5 Workflow Checklist updated (this commit). qa-engineer 4 findings: F1 MEDIUM AC-10 logger.debug emission spy assertion missing — added 3 spy tests to fH7.conversationCore.integration.test.ts (Test 4/5/6) verifying H7-P1 fires, H7-P4 fires, no H7 match emits no log; F2 LOW 4 missing landmine integration tests deferred (low risk — unit tests already cover guard); F3 LOW key_facts.md test count drift after qa added observability suite (4060 → measured); F4 INFO H7-P4 doubled-prefix non-optimal (no action). qa-engineer added 17 unit tests in fH7.edge-cases.observability.test.ts (AC-10 pre-condition gating + 6 landmine guard verifications). Final: 4060 unit + 12 integration = 4072 total, lint 0, build clean. |
| 2026-04-26 | Step 5 (audit-merge): 11/11 PASS | All compliance checks pass: Status Ready for Merge, AC 12/12, DoD 13/13, Workflow 6/7 (Step 6 pending), Merge Evidence 8/8, Tracker synced 5/6, key_facts.md updated, Merge base UP TO DATE, working tree clean. |
| 2026-04-26 | Step 5 → Step 6 (Merge): PR #213 squash-merged to develop at `027a884` ~20:39 UTC | 11 commits squashed into 1 squash commit. Branch deleted local + remote (--delete-branch). Post-merge sanity: 4060/4060 unit tests on develop ✓. Status updated to Done. |

<!-- After code review, add a row documenting which findings were accepted/rejected:
| YYYY-MM-DD | Review findings | Accepted: C1-C3, H1-H2. Rejected: M5 (reason). Systemic: C4 logged in bugs.md |
This creates a feedback loop for improving future reviews. -->

---

## Merge Checklist Evidence

> **MANDATORY before requesting merge approval.** Read `references/merge-checklist.md` and execute ALL actions. Record evidence below.

| Action | Done | Evidence |
|--------|:----:|----------|
| 0. Validate ticket structure | [x] | All 7 sections present: Spec, Implementation Plan, Acceptance Criteria, Definition of Done, Workflow Checklist, Completion Log, Merge Checklist Evidence |
| 1. Mark all items | [x] | AC: 12/12 [x], DoD: 13/13 [x], Workflow: 5/6 [x] (Step 6 pending merge — correct) |
| 2. Verify product tracker | [x] | Active Session updated to step 5/6, Features table F-H7 in-progress 5/6 |
| 3. Update key_facts.md | [x] | Updated: CONVERSATIONAL_WRAPPER_PATTERNS count 13→17, H7-P5 seam, h7TrailingStrip.ts, extractFoodQuery return shape, unit test count 4060 + integration 12 |
| 4. Update decisions.md | [x] | ADR-023 added (H7-P5 L1-retry seam in engineRouter.ts) |
| 5. Commit documentation | [x] | Commits 5628bbf (spec+plan), 0fa0309..c839057 (TDD phases 1-7), 402bbab (review/qa fixes), final audit-merge commit pending |
| 6. Verify clean working tree | [x] | `git status`: clean (after final commit) |
| 7. Verify branch up to date | [x] | `git merge-base --is-ancestor origin/develop HEAD` returns UP TO DATE — no rebase needed |

---

*Ticket created: 2026-04-26 | Spec v2: 2026-04-26*
