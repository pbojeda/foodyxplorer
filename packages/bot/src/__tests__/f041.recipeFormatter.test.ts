// Unit tests for formatRecipeResult (F041 — recipeFormatter.ts).
// Pure function — no mocks needed. Plain object fixtures for RecipeCalculateData.

import { describe, it, expect } from 'vitest';
import type { RecipeCalculateData } from '@foodxplorer/shared';
import { formatRecipeResult } from '../formatters/recipeFormatter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNutrients(overrides: Record<string, number | null> = {}) {
  return {
    calories: 450,
    proteins: 35,
    carbohydrates: 40,
    sugars: null,
    fats: 12,
    saturatedFats: null,
    fiber: 3,
    salt: null,
    sodium: 200,
    transFats: null,
    cholesterol: null,
    potassium: null,
    monounsaturatedFats: null,
    polyunsaturatedFats: null,
    referenceBasis: 'per_serving' as const,
    ...overrides,
  };
}

function makeIngredient(overrides: Partial<{
  name: string;
  nameEs: string | null;
  grams: number;
  portionMultiplier: number;
  resolved: boolean;
  calories: number | null;
  proteins: number | null;
}> = {}) {
  const {
    name = 'pollo',
    nameEs = 'Pollo',
    grams = 200,
    portionMultiplier = 1.0,
    resolved = true,
    calories = 330,
    proteins = 31,
  } = overrides;

  return {
    input: { foodId: null, name, grams, portionMultiplier },
    resolved,
    resolvedAs: resolved
      ? { entityId: 'uuid-1', name, nameEs, matchType: 'exact_food' as const }
      : null,
    nutrients: resolved
      ? makeNutrients({ calories, proteins, fiber: 0, sodium: 0 })
      : null,
  };
}

const BASE_DATA: RecipeCalculateData = {
  mode: 'free-form',
  resolvedCount: 2,
  unresolvedCount: 0,
  confidenceLevel: 'medium',
  totalNutrients: makeNutrients(),
  ingredients: [
    makeIngredient({ name: 'pollo', nameEs: 'Pollo', grams: 200, calories: 330, proteins: 31 }),
    makeIngredient({ name: 'arroz', nameEs: 'Arroz', grams: 100, calories: 120, proteins: 4 }),
  ],
  unresolvedIngredients: [],
  cachedAt: null,
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe('formatRecipeResult — header', () => {
  it('starts with *Resultado de la receta*', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('*Resultado de la receta*');
  });

  it('shows calories in the totals', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('450');
    expect(result).toContain('kcal');
  });

  it('shows proteins in the totals', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('35');
  });

  it('shows carbohydrates in the totals', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('40');
  });

  it('shows fats in the totals', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('12');
  });

  it('uses formatNutrient which escapes decimal points (e.g. 26.5 → 26\\.5)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: 26.5 }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('26\\.5');
  });
});

// ---------------------------------------------------------------------------
// Optional nutrients
// ---------------------------------------------------------------------------

describe('formatRecipeResult — optional nutrients', () => {
  it('shows fiber when non-null and > 0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ fiber: 3 }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('Fibra');
    expect(result).toContain('3');
  });

  it('does NOT show fiber when null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ fiber: null }),
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('Fibra');
  });

  it('does NOT show fiber when 0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ fiber: 0 }),
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('Fibra');
  });

  it('shows sodium when non-null and > 0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ sodium: 200 }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('Sodio');
    expect(result).toContain('200');
    expect(result).toContain('mg');
  });

  it('does NOT show sodium when null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ sodium: null }),
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('Sodio');
  });

  it('shows saturatedFats when non-null and > 0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ saturatedFats: 5 }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('Grasas saturadas');
    expect(result).toContain('5');
  });

  it('does NOT show saturatedFats when null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ saturatedFats: null }),
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('Grasas saturadas');
  });

  it('omits mandatory nutrient row when value is null (e.g. calories null)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: null }),
    };
    const result = formatRecipeResult(data);
    // calories row should not appear
    expect(result).not.toContain('Calorías: null');
    // should still not crash
    expect(result).toContain('*Resultado de la receta*');
  });

  it('shows 0 for mandatory fields when value is 0 (not null)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: 0 }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('Calorías: 0 kcal');
  });
});

// ---------------------------------------------------------------------------
// Ingredient count line
// ---------------------------------------------------------------------------

describe('formatRecipeResult — ingredient count', () => {
  it('shows resolvedCount / total in ingredient section header', () => {
    const result = formatRecipeResult(BASE_DATA);
    // resolvedCount=2, unresolvedCount=0 → total=2
    expect(result).toMatch(/2\/2|2 \/ 2|Ingredientes \(2\/2\)/);
  });

  it('shows correct counts when some unresolved', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      resolvedCount: 1,
      unresolvedCount: 2,
      unresolvedIngredients: ['xyz', 'abc'],
    };
    const result = formatRecipeResult(data);
    expect(result).toMatch(/1\/3|1 \/ 3/);
  });
});

// ---------------------------------------------------------------------------
// Per-ingredient list
// ---------------------------------------------------------------------------

describe('formatRecipeResult — per-ingredient list', () => {
  it('shows a bullet for each resolved ingredient', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('• ');
  });

  it('prefers resolvedAs.nameEs for display name', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('Pollo');
  });

  it('falls back to resolvedAs.name when nameEs is null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ nameEs: null }),
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('pollo');
  });

  it('falls back to input.name when resolvedAs is null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: 'ingrediente misterioso', grams: 100, portionMultiplier: 1.0 },
          resolved: false,
          resolvedAs: null,
          nutrients: null,
        },
      ],
    };
    // resolved=false → should NOT appear in bullet list
    const result = formatRecipeResult(data);
    expect(result).not.toContain('ingrediente misterioso');
  });

  it('does NOT show a bullet line for ingredients where resolved === false', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ resolved: false, name: 'ghost ingredient' }),
      ],
      resolvedCount: 0,
      unresolvedCount: 1,
      unresolvedIngredients: ['ghost ingredient'],
    };
    const result = formatRecipeResult(data);
    // Should not have a bullet line for the unresolved ingredient
    // (it appears under "No resueltos" instead, not as a • bullet).
    expect(result).not.toMatch(/^• .*ghost ingredient/m);
  });

  it('shows grams in bullet line', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('200g');
  });

  it('shows ingredient calories in bullet line', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('330');
  });

  it('shows ingredient proteins in bullet line', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('31');
  });

  it('shows portionMultiplier when != 1.0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          ...makeIngredient({ grams: 1000 }),
          input: { foodId: null, name: 'pollo', grams: 1000, portionMultiplier: 0.5 },
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('x0');
    expect(result).toContain('0\\.5');
  });

  it('does NOT show portionMultiplier suffix when == 1.0', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ portionMultiplier: 1.0 }),
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('x1');
  });

  it('shows "sin datos" when nutrients is null for resolved ingredient', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: 'misterio', grams: 100, portionMultiplier: 1.0 },
          resolved: true,
          resolvedAs: { entityId: 'uuid-x', name: 'misterio', nameEs: 'Misterio', matchType: 'exact_food' as const },
          nutrients: null,
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('sin datos');
  });

  it('displays name "Ingrediente" as fallback when all name sources are null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: null, grams: 100, portionMultiplier: 1.0 },
          resolved: true,
          resolvedAs: { entityId: 'uuid-x', name: null as unknown as string, nameEs: null, matchType: 'exact_food' as const },
          nutrients: makeNutrients({ calories: 100, proteins: 5, fiber: 0, sodium: 0 }),
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('Ingrediente');
  });
});

// ---------------------------------------------------------------------------
// Unresolved section
// ---------------------------------------------------------------------------

describe('formatRecipeResult — unresolved list', () => {
  it('shows *No resueltos:* when unresolvedIngredients is non-empty', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      unresolvedIngredients: ['aceite de trufa', 'polvo de unicornio'],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('No resueltos');
    expect(result).toContain('aceite de trufa');
    expect(result).toContain('polvo de unicornio');
  });

  it('does NOT show *No resueltos:* when unresolvedIngredients is empty', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).not.toContain('No resueltos');
  });
});

// ---------------------------------------------------------------------------
// Confidence footer
// ---------------------------------------------------------------------------

describe('formatRecipeResult — confidence footer', () => {
  it('maps high → alta', () => {
    const data: RecipeCalculateData = { ...BASE_DATA, confidenceLevel: 'high' };
    const result = formatRecipeResult(data);
    expect(result).toContain('alta');
  });

  it('maps medium → media', () => {
    const data: RecipeCalculateData = { ...BASE_DATA, confidenceLevel: 'medium' };
    const result = formatRecipeResult(data);
    expect(result).toContain('media');
  });

  it('maps low → baja', () => {
    const data: RecipeCalculateData = { ...BASE_DATA, confidenceLevel: 'low' };
    const result = formatRecipeResult(data);
    expect(result).toContain('baja');
  });

  it('confidence footer uses italic format _Confianza: ..._', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result).toContain('_Confianza:');
  });
});

// ---------------------------------------------------------------------------
// Truncation (smart — ingredient list only)
// ---------------------------------------------------------------------------

// Helper: build a fixture that will trigger truncation (names long enough to exceed 4000 chars).
// Each ingredient line is ~120 chars; 50 × 120 = 6000 chars for the ingredient section alone.
function makeLongIngredientName(i: number): string {
  // 80-char names to force truncation well past 4000
  return `Ingrediente Especial Con Nombre Extremadamente Largo Para Prueba Numero ${String(i).padStart(3, '0')}`;
}

function makeTruncationData(confidenceLevel: 'high' | 'medium' | 'low' = 'medium'): RecipeCalculateData {
  const manyIngredients = Array.from({ length: 50 }, (_, i) =>
    makeIngredient({
      name: makeLongIngredientName(i).toLowerCase(),
      nameEs: makeLongIngredientName(i),
      grams: 100 + i,
      calories: 200,
      proteins: 20,
    }),
  );
  return {
    ...BASE_DATA,
    resolvedCount: 50,
    unresolvedCount: 0,
    confidenceLevel,
    ingredients: manyIngredients,
  };
}

describe('formatRecipeResult — truncation', () => {
  it('output length is ≤ 4000 chars when there are many long-named ingredients', () => {
    const result = formatRecipeResult(makeTruncationData());
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it('truncated output still contains the header section', () => {
    const result = formatRecipeResult(makeTruncationData());
    expect(result).toContain('*Resultado de la receta*');
    expect(result).toContain('Calorías');
  });

  it('truncated output still contains the confidence footer', () => {
    const result = formatRecipeResult(makeTruncationData('low'));
    expect(result).toContain('baja');
  });

  it('truncated output contains "ingredientes más" note', () => {
    const result = formatRecipeResult(makeTruncationData());
    // Custom truncation note: \.\.\. y X ingredientes más
    expect(result).toMatch(/ingredientes m.s/);
  });

  it('short output (few ingredients) is NOT truncated', () => {
    const result = formatRecipeResult(BASE_DATA);
    expect(result.length).toBeLessThan(4000);
    expect(result).not.toMatch(/ingredientes m.s/);
  });
});
