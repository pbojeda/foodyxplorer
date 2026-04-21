# QA Improvement Sprint — Ticket Grouping Plan

Based on the 350-query QA battery (2026-04-21), 9 problems identified.
Grouped into 5 tickets by shared code area.

---

## Ticket 1: BUG-PROD-012 — Chain matching overrides Spanish dishes (P1)

**Severity:** High | **Path:** B Standard (architectural)
**Root cause:** `ORDER BY ds.priority_tier ASC` in L1 FTS queries ranks Tier 0 (scraped chains) above Tier 1 (cocina-española/BEDCA) when no explicit brand context.
**Fix:** Add secondary ORDER BY in FTS strategies 2 & 4 that prefers `chain_slug = 'cocina-espanola'` (or null chain) when `hasExplicitBrand=false`.
**Files:** `packages/api/src/estimation/level1Lookup.ts` (strategies 2 & 4 SQL)
**Queries fixed:** 8 wrong matches (tortilla→Tim Hortons, jamón→Starbucks, etc.)
**Effort:** ~4h (spec + plan + TDD + review)

---

## Ticket 2: F-NLP — Natural language query pre-processing (P2)

**Severity:** High | **Path:** Standard feature
**Problem:** Conversational wrappers ("me he tomado...", "acabo de comer...", "cuántas calorías tiene...") prevent entity extraction.
**Fix:** Add a pre-processing step in conversationCore.ts (before F042/F078) that strips conversational wrappers and extracts the food entity. Could use regex patterns for common Spanish phrases or a lightweight LLM call.
**Files:** `packages/api/src/conversation/conversationCore.ts`, `packages/api/src/conversation/entityExtractor.ts`
**Queries fixed:** 18 NULLs
**Effort:** ~6h (spec + plan + TDD + review) — may need LLM integration decision

---

## Ticket 3: F-MORPH — Spanish morphological normalization (P3 + P4)

**Severity:** Medium | **Path:** Standard feature
**Problems combined:**
- P3: Plural articles "unas/unos" not parsed (9 NULLs)
- P4: Diminutive suffixes "-ita/-ito/-itas/-itos" not recognized (18 NULLs)

**Fix:** Add morphological normalization layer before portion term detection and entity extraction:
- Strip/normalize plural articles: "unas tapas de X" → "tapa de X"
- Normalize diminutives: "tapita" → "tapa", "cañita" → "caña", "croquetitas" → "croquetas"
- Normalize containers: "plato de" → remove (pass through), "cuenco de" → remove, "bol de" → remove

**Files:** New utility in `packages/api/src/estimation/` or `packages/api/src/conversation/`, integrated into conversationCore.ts
**Queries fixed:** 27 NULLs (9 + 18)
**Effort:** ~4h

---

## Ticket 4: F-COUNT — Explicit count and extended modifier parsing (P5 + P6)

**Severity:** Medium | **Path:** Standard feature
**Problems combined:**
- P5: Numeric counts ("6 croquetas", "2 cañas") not parsed (20 NULLs)
- P6: Extended modifiers ("normal", "extra", "enorme", "doble", "dos raciones") not handled (12 NULLs)

**Fix:** Extend F042 multiplier extractor to handle:
- "N + food" pattern: extract N as portionMultiplier (e.g., "6 croquetas" → multiplier=6, query="croquetas")
- "media docena" → multiplier=6
- "un par de" → multiplier=2
- New modifier vocabulary: "normal"→1.0 (ignore), "extra"→1.5, "doble"→2.0, "enorme"→2.0
- "N raciones de" → multiplier=N
- "ración y media" → multiplier=1.5

**Files:** `packages/api/src/conversation/conversationCore.ts` (F042 extractor), `packages/api/src/estimation/portionSizing.ts`
**Queries fixed:** 32 NULLs (20 + 12)
**Effort:** ~5h

---

## Ticket 5: F-DRINK + P8 fix — Drink portion terms + pieceName cosmetic (P7 + P8)

**Severity:** Low | **Path:** Quick fix
**Problems combined:**
- P7: Drink-specific terms (tercio=333ml, vaso=150ml, botella=750ml) not recognized (3 NULLs)
- P8: pieceName singular ("gamba" instead of "gambas") in seed data (cosmetic)

**Fix:**
- P7: Add drink terms to F085 `PORTION_RULES` or create parallel drink portion detector
- P8: Fix `standard-portions.csv` pieceName values to use plurals

**Files:** `packages/api/src/estimation/portionSizing.ts`, `packages/api/prisma/seed-data/standard-portions.csv`
**Queries fixed:** 3 NULLs + cosmetic
**Effort:** ~2h

---

## Not ticketed (deferred)

- **P9 (Typos/fuzzy matching):** 6 NULLs from intentional misspellings. The existing L3 pgvector similarity should catch some of these. Low priority, high effort. Defer to backlog.

---

## Execution Order

1. **BUG-PROD-012** (P1) — Critical, blocks usability. ~4h
2. **F-NLP** (P2) — High, real users speak conversationally. ~6h
3. **F-MORPH** (P3+P4) — Medium, natural Spanish speech patterns. ~4h
4. **F-COUNT** (P5+P6) — Medium, common use case. ~5h
5. **F-DRINK+P8** (P7+P8) — Low, quick wins. ~2h

**Total estimated:** ~21h across 5 tickets

---

## Regression Test Strategy

After each ticket merge, re-run the 350-query battery (`/tmp/qa-exhaustive.sh`) against dev API and compare:
- NULL count should decrease
- OK count should increase
- No previously-OK queries should regress to NULL

Target: ≥300 OK out of 350 (from current 236).
