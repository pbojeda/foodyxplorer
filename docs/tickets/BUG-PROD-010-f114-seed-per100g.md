# BUG-PROD-010 — F114 seed nutrients stored per-100g instead of per-portionGrams

**Status:** In Progress
**Type:** Bug (data)
**Severity:** P0 (wrong calorie data shown to users)
**Path:** A (Quick)
**Branch:** `bugfix/BUG-PROD-010-seed-nutrients`
**Affects:** Production — 2 dishes (Chuletón de buey, Chorizo ibérico embutido)

---

## Root Cause

The DishNutrient table convention is `referenceBasis = per_serving` — nutrients are stored for the full `portionGrams` weight. But F114 seeded Chuletón (portionGrams=700) and Chorizo (portionGrams=180) with nutrients per-100g from BEDCA/USDA sources WITHOUT scaling.

**Evidence:**
- Chuletón: portionGrams=700, calories=280. 280 kcal/700g = 40 kcal/100g — impossible for beef ribeye.
- Chorizo: portionGrams=180, calories=468. 468 kcal/180g = 260 kcal/100g — but BEDCA chorizo is 468 kcal/100g (source data was per-100g).
- Croquetas (existing dish, correctly seeded): portionGrams=120, calories=290. 290/120 = 242 kcal/100g — matches BEDCA croqueta frita.

**Scaling factors:**
- Chuletón: ×7.0 (portionGrams=700 / 100)
- Chorizo: ×1.8 (portionGrams=180 / 100)

## Fix

Multiply all nutrient fields by `portionGrams/100` for both dishes in `spanish-dishes.json`:

| Dish | portionGrams | Factor | calories (was→fix) | proteins | fats | saturatedFats | salt |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Chuletón | 700 | ×7 | 280→1960 | 21→147 | 22→154 | 9→63 | 0.18→1.26 |
| Chorizo | 180 | ×1.8 | 468→842.4→842 | 24→43.2→43 | 40→72 | 15→27 | 2.40→4.32 |

Round to integers (except salt which uses 2 decimals in the dataset).

## Acceptance Criteria

- [ ] AC1: Chuletón nutrients scaled ×7 in spanish-dishes.json
- [ ] AC2: Chorizo nutrients scaled ×1.8 in spanish-dishes.json
- [ ] AC3: Unit test verifies nutrients are within expected per-portionGrams ranges
- [ ] AC4: `validateSpanishDishes` passes (no schema violations)
- [ ] AC5: Existing F114 unit tests still pass
- [ ] AC6: Re-seed dev + prod after merge

## Prevention

Add a validation rule to `validateSpanishDishes.ts`: for each dish, verify `calories / portionGrams` yields a reasonable per-100g value (e.g., 50-900 kcal/100g range). Flag outliers.
