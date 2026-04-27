# Bot User Manual Audit — Cross-Model Review (Consolidated)

**Date:** 2026-03-29
**Auditors:** Claude Opus 4.6 (code cross-reference), Gemini 2.5 Pro, Codex GPT-5.4
**File audited:** `docs/user-manual-bot.md`
**Code cross-referenced:** All bot handlers, formatters, NL parser, comparison parser, context detector, chain resolver, portion modifier, conversation state, callback queries, file upload handlers

---

## Executive Summary

Three independent AI models audited the bot user manual against the full source code in `packages/bot/`. The manual covers all 12 commands and the core flows, but has **2 critical factual errors** (context section), **1 code bug** (now fixed), **8 important gaps** in undocumented or incorrectly documented features, and **6 suggestions** for completeness. Cross-model consensus was strong — the context section (Section 8) was flagged by all 3 models as the most problematic area.

**Status after F050:** 2 of 18 findings fixed. 16 remaining for F049.

---

## CRITICAL Issues

| # | Issue | Detected by | Status |
|---|-------|:-----------:|--------|
| C1 | **Context fallback example is false.** Section 8 shows that asking `whopper` with McDonald's context "busca globalmente". In reality, `/estimar`, `/comparar` and NL inject `chainSlug` as a filter — the API searches only within that chain and returns "no data" if the dish doesn't exist there. There is no global fallback. | Codex | **Pending F049** |
| C2 | **"Each message resets the timer" is false.** Section 8 says the context timer resets with every message. In reality, the Redis TTL is only refreshed when state is *written* (`setState`/`setStateStrict` call `redis.setex`). Reading context, estimating, or comparing do NOT refresh the TTL. The context expires 2 hours after the last *write* (set/clear context), not after the last message. | Codex | **Pending F049** |
| C3 | **`¿` not stripped in `extractFoodQuery`.** `¿cuántas calorías tiene un big mac?` bypasses all prefix patterns because `extractFoodQuery` doesn't strip leading `¿¡` like `extractComparisonQuery` and `detectContextSet` do. | Gemini | **Fixed in F050** (BUG-AUDIT-01, SHA d243c1e) |

---

## IMPORTANT Issues

| # | Issue | Detected by | Status |
|---|-------|:-----------:|--------|
| I1 | **`/contexto <cadena>` not documented.** The command also accepts a chain name or slug to set context directly (with fuzzy resolution + ambiguity detection). Manual only documents `/contexto` (view) and `/contexto borrar` (clear). | Claude, Gemini, Codex | **Pending F049** |
| I2 | **Context does NOT work with `/receta`.** Section 8 lists `/receta` as context-compatible. Code shows `receta.ts` never reads `botState.chainContext`. Context only applies to `/estimar`, `/comparar`, and NL handler. | Codex | **Pending F049** |
| I3 | **`/start` help missing 3 commands.** Help text did not include `/comparar`, `/contexto`, or `/restaurante`. | Claude, Codex | **Fixed in F050** (SHA d243c1e) |
| I4 | **Context NL detection is stricter than documented.** Section 8 says "Escribe frases como" implying flexible detection. Reality: only the exact pattern `estoy en [el/la/los/las] <chain>` matches (regex `CONTEXT_SET_REGEX`), max 50 chars, no commas, no newlines. | Codex | **Pending F049** |
| I5 | **Error messages table (Section 14) very incomplete.** Missing: recipe-specific errors (`RECIPE_UNRESOLVABLE`, `FREE_FORM_PARSE_FAILED`), photo analysis errors (`MENU_ANALYSIS_FAILED`, `INVALID_IMAGE`, `OCR_FAILED`, `VISION_API_UNAVAILABLE`), rate limit messages, restaurant not selected, file too large, photo expired, download error. | Gemini, Codex | **Pending F049** |
| I6 | **Unauthorized chats receive silence on photo/document upload.** Manual mentions "chat permitido" but doesn't explain what happens for unauthorized chats: they get zero response (no error message). | Codex | **Pending F049** |
| I7 | **Menu analysis section incomplete.** Missing: partial results on timeout, individual dishes "sin datos", failed identification message, and that the menu listing only shows 4 nutrients (not the full set). | Codex | **Pending F049** |
| I8 | **Comparison tie indicator not documented.** When both dishes have the same value in the focused nutrient, `formatComparison` shows `—` (dash) instead of `✅`. Not mentioned in Section 4. | Gemini | **Pending F049** |
| I9 | **Restaurant creation from `/restaurante` not documented.** When `/restaurante <name>` returns 0 search results, the bot shows a "Crear restaurante" inline keyboard button. Users can create restaurants directly. Section 9 doesn't mention this. | Claude | **Pending F049** |

---

## SUGGESTIONS

| # | Issue | Detected by | Status |
|---|-------|:-----------:|--------|
| S1 | **Portion modifiers in plural not mentioned.** The parser accepts `dobles`, `grandes`, `minis`, `triples`, `raciones dobles`, `medias raciones`, etc. Table in Section 7 only shows singular forms. | Gemini, Codex | **Pending F049** |
| S2 | **Ambiguous chain resolution not documented.** When context set matches multiple chains, the bot responds "Encontré varias cadenas... usa el slug exacto". Section 8 doesn't mention this. | Gemini | **Pending F049** |
| S3 | **Recipe truncation not documented.** When recipe output exceeds Telegram's 4000-char limit, `recipeFormatter.ts` truncates the ingredient list and appends "...y X ingredientes más". | Gemini, Codex | **Pending F049** |
| S4 | **Recipe output format not fully documented.** `/receta` response includes per-ingredient breakdown, unresolved ingredients list, overall confidence level, and smart truncation. Section 5 only shows input examples. | Codex | **Pending F049** |
| S5 | **Catalog command output not fully documented.** `/buscar`, `/restaurantes`, `/cadenas` show additional fields (ID, country, dish count, "Mostrando X de Y" pagination, "Lista recortada" truncation) not mentioned in the manual. | Codex | **Pending F049** |
| S6 | **Comparison nutrient focus row placement not documented.** When a nutrient focus is specified (e.g., "qué tiene más proteínas"), that nutrient row appears first in the table with a `(foco)` label. Section 4 doesn't mention this. | Codex | **Pending F049** |

---

## Summary by Section

| Manual Section | Findings | Severity |
|----------------|:--------:|----------|
| Section 2 — /estimar | 0 | Clean |
| Section 3 — /buscar | 1 | S5 (output format) |
| Section 4 — /comparar | 2 | I8 (tie indicator), S6 (focus row) |
| Section 5 — /receta | 2 | S3 (truncation), S4 (output format) |
| Section 6 — NL | 0 | Clean (C3 was code bug, fixed in F050) |
| Section 7 — Portions | 1 | S1 (plurals) |
| Section 8 — Context | 5 | C1 (fallback lie), C2 (TTL lie), I1 (/contexto set), I2 (/receta claim), I4 (strict pattern) |
| Section 9 — Restaurants | 2 | I9 (creation), S5 (output format) |
| Section 10 — Menu analysis | 2 | I6 (silent unauthorized), I7 (partial results) |
| Section 11 — Admin upload | 0 | Clean |
| Section 14 — Errors | 1 | I5 (incomplete table) |
| Section 15 — Reference | 0 | Clean (I3 fixed in F050) |

---

## Cross-Model Agreement

| Finding | Claude | Gemini | Codex | Consensus |
|---------|:------:|:------:|:-----:|:---------:|
| C1 — Context fallback lie | | | x | Single (but verified in code) |
| C2 — TTL refresh lie | | | x | Single (but verified in code) |
| C3 — ¿ stripping bug | | x | | Single (verified, fixed in F050) |
| I1 — /contexto set | x | x | x | **All 3** |
| I2 — /receta context | | | x | Single (verified in code) |
| I3 — /start help | x | | x | Two models (fixed in F050) |
| I4 — Strict NL detection | | | x | Single (verified in code) |
| I5 — Error table | x | x | x | **All 3** |
| I6 — Silent unauthorized | | | x | Single (verified in code) |
| I7 — Menu analysis gaps | | | x | Single (verified in code) |
| I8 — Tie indicator | | x | | Single |
| I9 — Restaurant creation | x | | | Single |
| S1 — Plural modifiers | | x | x | Two models |
| S2 — Ambiguous chain | | x | | Single |
| S3 — Recipe truncation | | x | x | Two models |
| S4 — Recipe output | | | x | Single |
| S5 — Catalog output | | | x | Single |
| S6 — Focus row | | | x | Single |

---

## Action Items for F049

**Priority 1 — Fix critical factual errors (C1, C2):**
- Rewrite context example: remove "busca globalmente" claim, document that context filters within the active chain
- Correct TTL explanation: expires 2 hours after last context set/clear, not after last message

**Priority 2 — Document missing features (I1, I2, I4, I5, I6, I7, I8, I9):**
- Add `/contexto <cadena>` usage to Section 8 + Section 15
- Remove `/receta` from context-compatible list
- Tighten NL context detection description with valid/invalid examples
- Expand error table (Section 14) with feature-specific errors
- Document silent behavior for unauthorized chats
- Document partial results, failed identification in menu analysis
- Document tie indicator in comparisons
- Document restaurant creation in Section 9

**Priority 3 — Improve completeness (S1-S6):**
- Add plural forms to portion modifiers table
- Document ambiguous chain response
- Document recipe truncation and full output format
- Document catalog command output details
- Document comparison focus row placement

---

*Audit completed: 2026-03-29. 18 findings total: 3 CRITICAL (1 fixed), 9 IMPORTANT (2 fixed), 6 SUGGESTION.*
