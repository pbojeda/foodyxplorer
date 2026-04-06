# Context Recovery — nutriXplorer (foodXPlorer) — 2026-04-06 (Bot Manual Audit Session)

## Project State

- **Branch:** develop (clean working tree)
- **Last commit:** 18d0a63 — docs: add comprehensive context prompt for Phase A0+A1 complete + docs updated
- **SDD DevFlow version:** 0.13.2
- **Autonomy Level:** L2 (Trusted)
- **Branching:** gitflow — develop (integration) + main (production)
- **develop ahead of main by 2 commits** (documentation updates only)

## Session Goal

**THIS SESSION IS NOT FOR IMPLEMENTING FEATURES.** The sole purpose is:

1. **Audit the bot user manual** (`docs/user-manual-bot.md`, 716 lines, Spanish) against the actual codebase
2. **Cross-model review** with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
3. **Fix all errors** found — in the manual AND in the code if issues are discovered
4. **Enhance the manual** with more examples, edge cases, detailed usage sections

After this session, a separate session will generate the API manual (English, for external developers).

## CRITICAL: What to Read First

1. **The manual itself:** `docs/user-manual-bot.md` (716 lines, 19 sections)
2. **The detailed capabilities report** generated in the previous session — see section below
3. **Bot source code** to verify every claim in the manual

## Current Manual Structure (19 sections)

| # | Section | Lines | Status |
|---|---------|-------|--------|
| 1 | Primeros pasos | 32-40 | Basic, may need expansion |
| 2 | Estimar calorias | 42-82 | Good, needs yield/cooking info |
| 3 | Buscar platos | 85-103 | Minimal, missing details |
| 4 | Comparar dos platos | 106-175 | Detailed, verify accuracy |
| 5 | Calcular una receta | 178-228 | Good, missing cooking state params |
| 6 | Lenguaje natural | 231-276 | Good, verify all prefix patterns |
| 7 | Modificadores de porcion | 279-300 | Good, verify all modifiers |
| 8 | Contexto conversacional | 303-370 | Detailed, verify TTL claims |
| 9 | Restaurantes y cadenas | 372-418 | OK, missing cocina-espanola |
| 10 | Analizar fotos de menus | 420-456 | Good, verify flow |
| 11 | Subir datos (admin) | 459-483 | OK |
| 12 | Info del bot | 486-500 | Minimal |
| 13 | Limites de uso | 502-514 | CRITICAL — missing voice limits, missing estimation limits |
| 14 | Mensajes de error | 516-569 | Missing voice errors, menu errors |
| 15 | Referencia rapida | 571-589 | Missing /ayuda alias? |
| 16 | Mensajes de voz | 592-619 | NEW (F075), needs deeper review |
| 17 | Menu del dia | 622-659 | NEW (F076), needs deeper review |
| 18 | Cocina espanola | 662-693 | NEW (F073/F078), needs deeper review |
| 19 | Bebidas alcoholicas | 695-716 | NEW (F077), very minimal |

## Known Issues to Investigate

### Potential Errors in Manual

1. **Section 16 (Voice): Duration limit inconsistency.** Manual says "30 segundos" but code has `> 120 seconds` as hard guard in voice.ts. The API audio endpoint accepts up to 120s. The bot apiClient uses `VOICE_TIMEOUT_MS = 30_000` (30s timeout for API call, not audio duration). **Investigate: what is the actual duration limit?**

2. **Section 13 (Limits): Missing estimation rate limit.** Manual doesn't mention the 50/day per actor limit for estimations. This applies to GET /estimate + POST /conversation/message + POST /conversation/audio (shared bucket). **Must be documented.**

3. **Section 16 (Voice): "50 mensajes de voz por dia" claim.** Verify this against actual rate limiting code. Is it voice-specific or shared with text estimation?

4. **Section 17 (Menu): "Maximo 8 platos" claim.** Verify against `MAX_MENU_ITEMS` constant in menuDetector.ts.

5. **Section 4 (Comparison): Winner logic for proteins/fiber.** Manual says "valor mas alto wins" for proteins. Verify this against comparisonFormatter.ts — the code review noted that the NUTRIENT_ROWS mapping determines winners.

6. **Section 2 (Estimate): Missing cooking state parameters.** F072 added cookingState and cookingMethod to GET /estimate. The manual doesn't mention these at all. Users can improve accuracy by specifying "cooked"/"raw" but don't know about it.

7. **Section 8 (Context): TTL claim "2 horas desde la ultima interaccion".** Verify against Redis TTL and renewal logic. F054 fixed an issue where unrelated writes refreshed TTL — was the fix complete?

8. **Section 19 (Alcohol): Very minimal.** Only 3 examples, no explanation of what beverages are available, no mention of the 26 beverages in cocina-espanola.

9. **Sections 16-19 are at the END of the manual.** New features (voice, menu, cocina espanola) are the most differentiating but appear after the reference table. Consider reordering or adding cross-references earlier.

### Potential Code Issues to Investigate

10. **Voice handler duration check:** voice.ts checks `> 120 seconds` but the manual says 30s. Is there a mismatch between what the code allows and what the manual promises?

11. **Menu /menu command fallthrough:** If menu detection finds < 2 items, it falls through to single estimation. Is this documented?

12. **Comparison formatter missing alcohol (tech debt #13):** comparisonFormatter.ts NUTRIENT_ROWS doesn't include alcohol. If you compare "cerveza vs vino tinto", alcohol won't appear in the comparison table. Is this documented as a limitation?

13. **Recipe formatter missing alcohol (tech debt #14):** recipeFormatter.ts doesn't show alcohol in totals. If you calculate a recipe with beer, alcohol won't appear.

14. **Error messages accuracy:** Do the error messages in section 14 match the EXACT strings in the code? Previous audits (F049) found discrepancies.

## Capabilities Report (from previous session)

### Bot Formatters — Exact Output Formats

**Estimation result format:**
```
*{displayName}*
🔥 Calorías: {calories} kcal
🥩 Proteínas: {proteins} g
🍞 Carbohidratos: {carbohydrates} g
🧈 Grasas: {fats} g
🌾 Fibra: {fiber} g              ← only if > 0
🫙 Grasas saturadas: {sat} g     ← only if > 0
🧂 Sodio: {sodium} mg            ← only if > 0
🧂 Sal: {salt} g                 ← only if > 0
🍺 Alcohol: {alcohol} g          ← only if > 0 (F077)
Porción: {portionGrams} g
Cadena: {chainSlug}
_Confianza: {alta|media|baja}_
```

Portion modifier line (only when multiplier != 1.0):
```
Porción: {label} (x{multiplier}) — {portionGrams} g
```
Labels: 0.5='media', 0.7='pequeña', 1.5='grande', 2.0='doble', 3.0='triple'

**Menu format:**
```
*Menú del día*
🍽 *{name}* — 🔥 {cal} kcal | 🥩 {prot} g | 🍞 {carbs} g | 🧈 {fats} g
❓ {query}: _no encontrado_
──────────────────
*Total* — 🔥 {totalCal} kcal | 🥩 {totalProt} g | 🍞 {totalCarbs} g | 🧈 {totalFats} g
_{matchedCount}/{itemCount} platos encontrados_
_Confianza: {lowest confidence}_
```

**Comparison format:** Code-block table with emoji columns, ✅ winner indicator, `—` for ties.

### Entity Extraction — All Patterns

**PREFIX_PATTERNS (8 patterns, stripped from NL input):**
1. `cuántas calorías tiene[n] X`
2. `cuántas calorías hay en X`
3. `cuántas calorías X`
4. `qué lleva/contiene/tiene X`
5. `dame/dime la información/info/calorías de X`
6. `información [nutricional] de X`
7. `calorías de[l] [una] X`
8. `[buscar] calorías de[l] [una] X`

**SERVING_FORMAT_PATTERNS (5 patterns, stripped F078):**
1. `tapa(s) de X`
2. `pintxo(s) de X`
3. `pincho(s) de X`
4. `raciones de X`
5. `ración/racion de X`

**ARTICLE_PATTERN:** un/una/el/la/los/las/del/al

**COMPARISON_SEPARATORS (6, ordered by priority):**
Strong (first occurrence): `versus`, `contra`, `vs`
Weak (last occurrence): `o`, `y`, `con`

**COMPARISON PREFIX_PATTERNS:**
- `qué tiene más {nutriente}, X vs Y`
- `qué tiene menos {nutriente}, X vs Y`
- `qué engorda más, X vs Y` (fixed focus: calorías)
- `qué es más sano, X vs Y` (no focus)
- `compara[r] X vs Y` (no focus)

**NUTRIENT_TOKEN_MAP:** calorías, proteínas, grasas, hidratos, carbohidratos, fibra, sodio, sal

**MENU_PATTERNS (5, ordered longest-first):**
1. `[hoy] [he comido] de menú del día: X`
2. `[hoy] [he comido] de menú: X`
3. `menú del día: X`
4. `mi menú: X`
5. `menú: X`

Split: comma primary → `y`/`más` fallback for 2 items. Max 8 items. Noise filter: prices, euro symbols.

### Voice Handler — Guards

- Duration: `> 120 seconds` → immediate error (no download)
- File size: `> 10 MB` → error
- MIME: `audio/ogg` (hardcoded in sendAudio call)
- API timeout: `VOICE_TIMEOUT_MS = 30_000` (30s)
- Hallucination filter: 8 hardcoded Whisper artifacts

### Rate Limits (from code)

| What | Limit | Period | Shared bucket? |
|------|-------|--------|---------------|
| GET /estimate | 50 | per day per actor | Yes (with conversation) |
| POST /conversation/message | 50 | per day per actor | Yes |
| POST /conversation/audio | 50 | per day per actor | Yes |
| POST /analyze/menu | 10 | per hour per API key | Admin exempt |
| /receta (bot) | 5 | per hour per user | No |
| POST /waitlist | 5 | per 15min per IP | No |

### Data Available

- **14 chains** + 1 virtual (cocina-espanola) = ~1900 dishes
- **250 Spanish canonical dishes** (46 BEDCA official + 204 recipe-estimated)
- **534 base foods** (514 USDA + 20 BEDCA placeholder)
- **15 nutrients** tracked: calories, proteins, carbs, sugars, fats, saturatedFats, fiber, salt, sodium, transFats, cholesterol, potassium, monoFats, polyFats, alcohol
- **60 cooking profiles** with yield factors

### Technical Debt Affecting Bot

- #1: Code duplication between bot and API (pure functions)
- #2: voice.ts and naturalLanguage.ts share same intent→format switch
- #13: Comparison formatter missing alcohol
- #14: Recipe formatter missing alcohol

## Key Source Files for Verification

| File | What to verify |
|------|---------------|
| `packages/bot/src/bot.ts` | All registered commands and handlers |
| `packages/bot/src/handlers/naturalLanguage.ts` | NL dispatch, prefix stripping, 500 char limit |
| `packages/bot/src/handlers/voice.ts` | Duration/size guards, error messages |
| `packages/bot/src/handlers/fileUpload.ts` | Photo/document flow, ALLOWED_CHAT_IDS |
| `packages/bot/src/commands/menu.ts` | /menu command logic |
| `packages/bot/src/formatters/estimateFormatter.ts` | Exact output format, conditional nutrients |
| `packages/bot/src/formatters/menuFormatter.ts` | Menu output format |
| `packages/bot/src/formatters/comparisonFormatter.ts` | Comparison table, winner logic |
| `packages/bot/src/apiClient.ts` | API client methods, timeouts |
| `packages/api/src/conversation/entityExtractor.ts` | All patterns, extraction logic |
| `packages/api/src/conversation/menuDetector.ts` | Menu detection patterns, MAX_MENU_ITEMS |
| `packages/api/src/conversation/conversationCore.ts` | 5-step pipeline, intent detection order |
| `packages/api/src/plugins/actorRateLimit.ts` | Rate limit implementation |
| `packages/api/src/routes/conversation.ts` | Route-level rate limits, logging |

## Audit Process

### Phase 1: Systematic Verification
For EACH section of the manual (1-19):
1. Read the manual section
2. Read the corresponding source code
3. Verify: every claim, every example, every error message, every limit
4. Document: errors found, missing information, improvement suggestions

### Phase 2: Cross-Model Review
1. Prepare consolidated findings
2. Send to Gemini CLI for independent review
3. Send to Codex CLI for independent review
4. Consolidate feedback from both

### Phase 3: Apply Fixes
1. Fix manual errors
2. Fix code issues if found
3. Add missing sections/examples
4. Improve existing sections with more detail

### Phase 4: Final Validation
1. Re-read the complete updated manual
2. Verify all changes against code one more time
3. Commit with detailed message

## User Preferences

- Senior developer — pragmatic YAGNI, no over-engineering
- Communication in Spanish, all code/docs/commits in English
- Bot manual stays in Spanish
- API manual (separate session) will be in English for external developers
- Cross-model reviews with Gemini CLI (`gemini`) and Codex CLI (`codex exec -`)
- After completion, wants a detailed summary of all changes made

## Workflow

- This is NOT an SDD feature — no ticket, no branch, no PR needed
- Work directly on develop branch
- Commit documentation changes as they're made
- No implementation work — only documentation + verification

---
Generated: 2026-04-06. Purpose: Bot manual audit session after /compact.
