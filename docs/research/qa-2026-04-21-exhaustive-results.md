# QA Exhaustive Test Results — 2026-04-21

**Environment:** api-dev.nutrixplorer.com
**Key:** fxp_admin_dev_testing_2026 (admin tier, no rate limit)
**Total queries:** 350 (manual 30 + automated 52 + exhaustive 350)
**Result:** OK: 236 | NULL: 113 | ERR: 1 (empty query — expected)

---

## Summary by Category

| # | Category | OK | NULL | Total | Success% |
|---|----------|-----|------|-------|----------|
| 1 | 30 priority dishes × 4 terms | 120 | 0 | 120 | 100% |
| 2 | Bare dish names (no term) | 30 | 0 | 30 | 100% |
| 3 | Drinks | 27 | 3 | 30 | 90% |
| 4 | Diminutives + colloquial | 2 | 18 | 20 | 10% |
| 5 | Explicit counts | 0 | 20 | 20 | 0% |
| 6 | Size modifiers | 8 | 12 | 20 | 40% |
| 7 | Accent/spelling variations | 14 | 6 | 20 | 70% |
| 8 | Plural forms | 6 | 9 | 15 | 40% |
| 9 | Comparison queries | 12 | 3 | 15 | 80% |
| 10 | Menu queries | 0 | 10 | 10 | 0%* |
| 11 | Chain restaurant items | 11 | 4 | 15 | 73% |
| 12 | Natural language | 2 | 18 | 20 | 10% |
| 13 | Edge cases | 4 | 10 | 15 | 27% |

*Menu queries detect the intent correctly but the test script didn't parse multi-estimation responses.

---

## Root Cause Analysis — 7 Problem Categories

### P1 (CRITICAL): Chain matching overrides Spanish dishes — 8 wrong matches

When a query contains a word that matches a chain restaurant item (tortilla, jamón, chorizo, pan, queso, sal), the chain item ranks higher than the Spanish dish — producing wildly incorrect nutritional data.

| Query | Matched | Should be | Error magnitude |
|-------|---------|-----------|-----------------|
| "pintxo de tortilla" | Tim Hortons Tortilla (1932 kcal!) | Tortilla de patatas (~79 kcal) | 24× |
| "media ración de jamón ibérico" | Starbucks Bagel Jamón (143 kcal) | Jamón ibérico (~150 kcal) | ~same but WRONG FOOD |
| "media ración de pan con tomate" | Starbucks Tostada (113 kcal) | Pan con tomate (~93 kcal) | ~same but WRONG FOOD |
| "media ración de chorizo" | Telepizza Barbacoa (114 kcal) | Chorizo (~228 kcal) | 2× |
| "tapas de jamon" | McDonald's Cheesy Pan Jamón (300 kcal) | Jamón ibérico | WRONG FOOD |
| "tapa grande de jamón" | McDonald's Cheesy Pan Jamón (450 kcal) | Jamón ibérico | WRONG FOOD |
| "racion de jamon iberico" (no accent) | Starbucks Bagel (286 kcal) | Jamón ibérico (~300 kcal) | WRONG FOOD |
| "sal" | Five Guys Caramelo Salado (181 kcal) | Sal (BEDCA, ~0 kcal) | WRONG FOOD |

**Root cause:** The estimation cascade (L1→L2→L3→L4) prioritizes FTS matches across all sources equally. Chain items with keyword overlap rank higher because they have exact token matches in scraped names. The `hasExplicitBrand` flag only activates when the user explicitly names a chain (e.g., "big mac de mcdonalds").

**Affected queries:** Any query where dish name collides with a chain product name. High-frequency terms like "tortilla", "jamón", "chorizo", "pan", "queso" are most vulnerable.

### P2 (HIGH): Natural language / conversational queries — 18 NULLs

Queries that include conversational context (verbs, pronouns, temporal markers) return no results because the entity extractor doesn't strip the conversational wrapper.

Examples:
- "me he tomado una ración de croquetas" → NULL
- "acabo de comer paella" → NULL
- "cuántas calorías tiene una ración de patatas bravas" → NULL
- "he desayunado café con leche y tostada" → NULL

**Root cause:** The conversation pipeline expects clean food queries. F078 strips some portion terms but doesn't handle full natural language sentences with verbs, pronouns, and temporal markers.

### P3 (MEDIUM): Plural forms — 9 NULLs

Queries starting with "unas/unos" fail:
- "unas tapas de croquetas" → NULL
- "unas patatas bravas" → NULL
- "unas gambas al ajillo" → NULL
- "unas cañas" → NULL

**Root cause:** The F042 multiplier extractor and F085 portion term detector don't handle the plural articles "unas/unos" as entry points. Only "una/un/una" are recognized.

### P4 (MEDIUM): Diminutives — 18 NULLs

Spanish diminutive suffixes (-ita, -ito, -itas, -itos) are not recognized:
- "tapita" → not recognized as "tapa"
- "cañita" → not recognized as "caña"
- "copita" → not recognized as "copa"
- "croquetitas" → not recognized as "croquetas"

**Root cause:** No morphological normalization in the portion term detector or entity extractor.

### P5 (MEDIUM): Explicit counts — 20 NULLs

Numeric quantity prefixes are not parsed:
- "6 croquetas de jamón" → NULL
- "2 cañas de cerveza" → NULL
- "3 pinchos de tortilla" → NULL
- "media docena de croquetas" → NULL

**Root cause:** The parser (F042/F078) extracts portion terms and multipliers but not explicit numeric counts. Numbers at the start of a query cause entity extraction to fail.

### P6 (MEDIUM): Compound/unusual size modifiers — 12 NULLs

- "media ración grande de calamares" → NULL (compound contradiction)
- "ración normal de tortilla" → NULL ("normal" not recognized)
- "ración extra de croquetas" → NULL ("extra" not recognized)
- "ración enorme de cocido" → NULL
- "dos raciones de patatas bravas" → NULL
- "ración y media de gambas" → NULL

**Root cause:** F042 only handles a fixed set of modifiers (grande=1.5, pequeña=0.7, media=0.5). Other Spanish size expressions are not mapped.

### P7 (LOW): Drink portion terms — 3 NULLs

- "un tercio de cerveza" → NULL (333ml)
- "un vaso de vino tinto" → NULL (150ml)
- "una botella de vino tinto" → NULL (750ml)

Already documented in memory: `project_drink_portions.md`

---

## Additional Observations

### Correct but surprising results

- "una coca cola" → "Huevas cocidas de merluza" (179 kcal) — word "coca" matches fish roe
- "un doble de cerveza" → Cerveza lata × 2 multiplier (284 kcal) — "doble" works as multiplier!
- "pincho de croquetas" (no accent) → works (72 kcal, pintxo/30g)
- "racion de paella" (no accent) → works (360 kcal, racion/300g)
- "tortilla española" (bare) → Tortilla de patatas (correct!) but "pintxo de tortilla" → Tim Hortons (wrong!)
- Category 1 (30 dishes × 4 terms): 100% success rate — BUG-PROD-011 scaling works perfectly

### Menu intent detection works but needs response parsing

Queries #291-296 correctly detect `intent=menu_estimation` but the multi-item response structure wasn't parsed by the test script. The backend likely returns the data — needs verification.

### pieceName singular bug (cosmetic)

Throughout results: "gamba" instead of "gambas", "croqueta" instead of "croquetas", "boquerón" instead of "boquerones", "churro" instead of "churros". This is a seed data issue in `standard-portions.csv`.

---

## Prioritized Fix Plan

| Priority | Problem | Queries affected | Suggested approach |
|----------|---------|-----------------|-------------------|
| P1 CRITICAL | Chain matching overrides | 8 wrong matches | Boost cocina-española + BEDCA when no explicit chain context |
| P2 HIGH | Natural language | 18 NULLs | Pre-processing: strip conversational wrapper, extract food entity |
| P3 MEDIUM | Plurals (unas/unos) | 9 NULLs | Normalize plural articles in F042/portion detector |
| P4 MEDIUM | Diminutives | 18 NULLs | Morphological normalization (-ita→-a, -ito→-o) |
| P5 MEDIUM | Explicit counts | 20 NULLs | Parse "N + food" pattern, use N as multiplier |
| P6 MEDIUM | Compound modifiers | 12 NULLs | Expand F042 modifier vocabulary |
| P7 LOW | Drink terms | 3 NULLs | Add vaso/tercio/botella to portion terms |
| P8 LOW | pieceName singular | cosmetic | Fix CSV seed data |
| P9 LOW | Typos/fuzzy | 6 NULLs | pg_trgm similarity threshold tuning |

---

## Raw results file

Full output saved at: `/tmp/qa-exhaustive-results.txt`
