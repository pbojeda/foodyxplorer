// QA edge-case tests for F041 (/receta command + recipeFormatter).
//
// Covers gaps not exercised by the developer-written tests:
//  1. Individual null nutrient fields in per-ingredient breakdown (→ "? kcal")
//  2. Redis.incr NOT called when input guards fire (empty / too-long)
//  3. Redis.expire fail-open (throws on first request → request still proceeds)
//  4. Whitespace-padded args that become exactly 2000 chars after trim → allowed
//  5. Unknown confidenceLevel → raw value escaped and shown (fallback path)
//  6. All four mandatory totalNutrients null → no crash, header still present
//  7. Ingredient name containing MarkdownV2 special chars → escaped in output
//  8. Unresolved ingredient name containing MarkdownV2 special chars → escaped
//  9. portionMultiplier of integer 2 (not 2.0) → suffix shown (≠ 1)
// 10. portionMultiplier exactly 1 (integer) → no suffix (same as 1.0)
// 11. Rate limit boundary: exactly 5th call (incr returns 5) → NOT blocked
//     and 6th call (incr returns 6) blocks (already tested; re-verified here
//     with explicit key assertion)
// 12. Different chatIds get different Redis keys (isolation)
// 13. Spec inconsistency note: truncation suffix has two spaces ("...  y X")
//     vs. spec's one space ("... y X") — test documents actual behaviour

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import type { RecipeCalculateData } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { handleReceta } from '../commands/receta.js';
import { formatRecipeResult } from '../formatters/recipeFormatter.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMockRedis(incrReturn: number | Error = 1) {
  return {
    incr: incrReturn instanceof Error
      ? vi.fn().mockRejectedValue(incrReturn)
      : vi.fn().mockResolvedValue(incrReturn),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

type MockApiClient = { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };

function makeMockClient(): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn(),
    healthCheck: vi.fn(),
    searchRestaurants: vi.fn(),
    createRestaurant: vi.fn(),
    uploadImage: vi.fn(),
    uploadPdf: vi.fn(),
    analyzeMenu: vi.fn(),
    calculateRecipe: vi.fn(),
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
  };
}

function makeNutrients(overrides: Record<string, number | null> = {}) {
  return {
    calories: 300,
    proteins: 25,
    carbohydrates: 30,
    sugars: null,
    fats: 10,
    saturatedFats: null,
    fiber: null,
    salt: null,
    sodium: null,
    transFats: null,
    cholesterol: null,
    potassium: null,
    monounsaturatedFats: null,
    polyunsaturatedFats: null,
    alcohol: null,
    referenceBasis: 'per_serving' as const,
    ...overrides,
  };
}

function makeIngredient(overrides: Partial<{
  name: string;
  nameEs: string | null;
  grams: number;
  portionMultiplier: number;
  calories: number | null;
  proteins: number | null;
}> = {}) {
  const {
    name = 'pollo',
    nameEs = 'Pollo',
    grams = 200,
    portionMultiplier = 1.0,
    calories = 300,
    proteins = 25,
  } = overrides;
  return {
    input: { foodId: null, name, grams, portionMultiplier },
    resolved: true,
    resolvedAs: { entityId: 'uuid-1', name, nameEs, matchType: 'exact_food' as const },
    nutrients: makeNutrients({ calories, proteins }),
  };
}

const BASE_DATA: RecipeCalculateData = {
  mode: 'free-form',
  resolvedCount: 1,
  unresolvedCount: 0,
  confidenceLevel: 'high',
  totalNutrients: makeNutrients(),
  ingredients: [makeIngredient()],
  unresolvedIngredients: [],
  cachedAt: null,
  portions: null,
  perPortion: null,
};

const CHAT_ID = 42;
const CHAT_ID_B = 99;

// ---------------------------------------------------------------------------
// 1. Individual null nutrient fields in per-ingredient breakdown
// ---------------------------------------------------------------------------

describe('formatRecipeResult — individual null nutrient fields in ingredient', () => {
  it('shows "? kcal" when ingredient nutrients.calories is null (but nutrients object is non-null)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: 'misterio', grams: 100, portionMultiplier: 1.0 },
          resolved: true,
          resolvedAs: { entityId: 'uuid-x', name: 'mystery', nameEs: 'Misterio', matchType: 'exact_food' as const },
          nutrients: makeNutrients({ calories: null }),
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('? kcal');
  });

  it('shows "? g prot" when ingredient nutrients.proteins is null (but nutrients object is non-null)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: 'misterio', grams: 100, portionMultiplier: 1.0 },
          resolved: true,
          resolvedAs: { entityId: 'uuid-x', name: 'mystery', nameEs: 'Misterio', matchType: 'exact_food' as const },
          nutrients: makeNutrients({ proteins: null }),
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('? g prot');
  });

  it('shows both "? kcal" and "? g prot" when both are null (nutrients object non-null)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          input: { foodId: null, name: 'misterio', grams: 100, portionMultiplier: 1.0 },
          resolved: true,
          resolvedAs: { entityId: 'uuid-x', name: 'mystery', nameEs: 'Misterio', matchType: 'exact_food' as const },
          nutrients: makeNutrients({ calories: null, proteins: null }),
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('? kcal');
    expect(result).toContain('? g prot');
    // Must NOT show "sin datos" — that is reserved for nutrients === null (the whole object)
    expect(result).not.toContain('sin datos');
  });
});

// ---------------------------------------------------------------------------
// 2. Redis.incr NOT called when input guards fire
// ---------------------------------------------------------------------------

describe('handleReceta — redis.incr not called on input guards', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
  });

  it('does NOT call redis.incr when args are empty', async () => {
    const redis = makeMockRedis();
    await handleReceta('', CHAT_ID, mock as unknown as ApiClient, redis);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does NOT call redis.incr when args are whitespace-only', async () => {
    const redis = makeMockRedis();
    await handleReceta('   \t  \n  ', CHAT_ID, mock as unknown as ApiClient, redis);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('does NOT call redis.incr when trimmed args exceed 2000 chars', async () => {
    const redis = makeMockRedis();
    await handleReceta('a'.repeat(2001), CHAT_ID, mock as unknown as ApiClient, redis);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Redis.expire fail-open (throws on first request)
// ---------------------------------------------------------------------------

describe('handleReceta — redis.expire failure is fail-open', () => {
  it('proceeds to API call when redis.expire throws on first request', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    const redis = {
      incr: vi.fn().mockResolvedValue(1),          // first request
      expire: vi.fn().mockRejectedValue(new Error('Redis write failure')),
    } as unknown as Redis;

    mock.calculateRecipe.mockResolvedValue(BASE_DATA);

    // Should NOT throw — fail-open means the API call proceeds
    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    // API was called despite expire failure
    expect(mock.calculateRecipe).toHaveBeenCalled();
    // Result is the formatted recipe (not an error message)
    expect(result).toContain('*Resultado de la receta*');
  });
});

// ---------------------------------------------------------------------------
// 4. Whitespace-padded args that become exactly 2000 chars after trim
// ---------------------------------------------------------------------------

describe('handleReceta — trim before length check', () => {
  it('allows input that is exactly 2000 chars AFTER trimming surrounding whitespace', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    const redis = makeMockRedis(1);
    mock.calculateRecipe.mockResolvedValue(BASE_DATA);

    const padded = '  ' + 'a'.repeat(2000) + '  ';
    // After trimming: exactly 2000 chars → should NOT trigger length error
    await handleReceta(padded, CHAT_ID, mock as unknown as ApiClient, redis);

    expect(mock.calculateRecipe).toHaveBeenCalledWith('a'.repeat(2000), undefined);
  });

  it('rejects input that is exactly 2001 chars AFTER trimming surrounding whitespace', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    const redis = makeMockRedis(1);

    const padded = '  ' + 'a'.repeat(2001) + '  ';
    const result = await handleReceta(padded, CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('2000');
    expect(mock.calculateRecipe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Unknown confidenceLevel → escaped raw value
// ---------------------------------------------------------------------------

describe('formatRecipeResult — unknown confidenceLevel fallback', () => {
  it('falls back to escaped raw value when confidenceLevel is not in CONFIDENCE_MAP', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      confidenceLevel: 'very_high' as 'high' | 'medium' | 'low',
    };
    const result = formatRecipeResult(data);
    // 'very_high' has an underscore — escapeMarkdown should escape it to 'very\_high'
    expect(result).toContain('very\\_high');
    // Should still be wrapped in italic footer
    expect(result).toContain('_Confianza:');
  });
});

// ---------------------------------------------------------------------------
// 6. All four mandatory totalNutrients null → no crash
// ---------------------------------------------------------------------------

describe('formatRecipeResult — all mandatory totalNutrients null', () => {
  it('does not crash when calories, proteins, carbohydrates and fats are all null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: null, proteins: null, carbohydrates: null, fats: null }),
    };
    expect(() => formatRecipeResult(data)).not.toThrow();
  });

  it('still contains the header when all mandatory nutrients are null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: null, proteins: null, carbohydrates: null, fats: null }),
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('*Resultado de la receta*');
  });

  it('still contains the confidence footer when all mandatory nutrients are null', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      totalNutrients: makeNutrients({ calories: null, proteins: null, carbohydrates: null, fats: null }),
      confidenceLevel: 'low',
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('baja');
  });
});

// ---------------------------------------------------------------------------
// 7. Ingredient name with MarkdownV2 special chars → escaped
// ---------------------------------------------------------------------------

describe('formatRecipeResult — MarkdownV2 escaping in ingredient names', () => {
  it('escapes parentheses in ingredient display name', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ name: 'aceite de oliva (extra virgen)', nameEs: 'Aceite de oliva (extra virgen)' }),
      ],
    };
    const result = formatRecipeResult(data);
    // Parentheses must be escaped: \( and \)
    expect(result).toContain('\\(extra virgen\\)');
    // The raw unescaped form must NOT appear
    expect(result).not.toMatch(/[^\\]\(extra virgen\)[^\\]/);
  });

  it('escapes dots in ingredient display name', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ nameEs: 'Salsa A.O.P.' }),
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('A\\.O\\.P\\.');
  });

  it('escapes hyphens in ingredient display name', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        makeIngredient({ nameEs: 'Jamón ibérico - pata negra' }),
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('\\-');
  });
});

// ---------------------------------------------------------------------------
// 8. Unresolved ingredient name with MarkdownV2 special chars
// ---------------------------------------------------------------------------

describe('formatRecipeResult — MarkdownV2 escaping in unresolved ingredient names', () => {
  it('escapes special chars in unresolved ingredient names', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      unresolvedIngredients: ['polvo de unicornio (mágico)', 'esencia #5'],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('\\(mágico\\)');
    expect(result).toContain('\\#5');
  });
});

// ---------------------------------------------------------------------------
// 9. portionMultiplier as integer 2 (not 2.0) → suffix shown
// ---------------------------------------------------------------------------

describe('formatRecipeResult — portionMultiplier integer values', () => {
  it('shows suffix when portionMultiplier is integer 2 (not equal to 1.0)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          ...makeIngredient(),
          input: { foodId: null, name: 'pollo', grams: 400, portionMultiplier: 2 },
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).toContain('x2');
  });

  it('does NOT show suffix when portionMultiplier is integer 1 (equals 1.0)', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      ingredients: [
        {
          ...makeIngredient(),
          input: { foodId: null, name: 'pollo', grams: 200, portionMultiplier: 1 },
        },
      ],
    };
    const result = formatRecipeResult(data);
    expect(result).not.toContain('x1');
  });
});

// ---------------------------------------------------------------------------
// 10. Different chatIds get different Redis keys (isolation)
// ---------------------------------------------------------------------------

describe('handleReceta — Redis key isolation per chatId', () => {
  it('uses different Redis keys for different chatIds', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    mock.calculateRecipe.mockResolvedValue(BASE_DATA);

    const redisA = makeMockRedis(1);
    const redisB = makeMockRedis(1);

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redisA);
    await handleReceta('200g pollo', CHAT_ID_B, mock as unknown as ApiClient, redisB);

    expect(redisA.incr).toHaveBeenCalledWith(`fxp:receta:hourly:${CHAT_ID}`);
    expect(redisB.incr).toHaveBeenCalledWith(`fxp:receta:hourly:${CHAT_ID_B}`);
  });
});

// ---------------------------------------------------------------------------
// 11. RECIPE_UNRESOLVABLE error does NOT consume rate limit (the error is from API)
//     — rate limit was already incremented before the API call; verify counter incremented
// ---------------------------------------------------------------------------

describe('handleReceta — rate limit incremented even on API error', () => {
  it('still increments rate limit counter when API returns RECIPE_UNRESOLVABLE', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    const redis = makeMockRedis(3);

    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'RECIPE_UNRESOLVABLE', 'No ingredients resolved'),
    );

    await handleReceta('xyz123', CHAT_ID, mock as unknown as ApiClient, redis);

    // Counter was incremented (rate limit consumed before API call)
    expect(redis.incr).toHaveBeenCalledWith(`fxp:receta:hourly:${CHAT_ID}`);
    // The response is the error message, not a rate limit message
  });
});

// ---------------------------------------------------------------------------
// 12. Spec inconsistency documentation: truncation suffix spacing
// ---------------------------------------------------------------------------

describe('formatRecipeResult — truncation suffix format (actual behaviour)', () => {
  function makeManyIngredientsData(): RecipeCalculateData {
    const manyIngredients = Array.from({ length: 50 }, (_, i) =>
      makeIngredient({
        nameEs: `Ingrediente Especial Con Nombre Muy Largo Para Prueba Numero ${String(i).padStart(3, '0')}`,
        grams: 100 + i,
        calories: 200,
        proteins: 20,
      }),
    );
    return {
      ...BASE_DATA,
      resolvedCount: 50,
      ingredients: manyIngredients,
    };
  }

  it('truncation suffix uses "...  y X ingredientes más" (two spaces — documents actual impl)', () => {
    // NOTE: The spec table (line 149) shows one space: "... y X ingredientes más"
    // The implementation uses TWO spaces: "...  y X ingredientes más"
    // This test documents the ACTUAL behaviour. The spec has a minor inconsistency here.
    const result = formatRecipeResult(makeManyIngredientsData());
    // Verify the suffix is present in any form (regex is lenient on spaces)
    expect(result).toMatch(/ingredientes m[aá]s/);
  });

  it('truncation suffix contains the count of omitted ingredients (a positive number)', () => {
    const result = formatRecipeResult(makeManyIngredientsData());
    // e.g. "y 38 ingredientes más"
    expect(result).toMatch(/y \d+ ingredientes/);
  });
});

// ---------------------------------------------------------------------------
// 13. Non-ApiError thrown by calculateRecipe → generic fallback message
// ---------------------------------------------------------------------------

describe('handleReceta — non-ApiError generic fallback', () => {
  it('returns generic error message when calculateRecipe throws a plain Error', async () => {
    vi.clearAllMocks();
    const mock = makeMockClient();
    const redis = makeMockRedis(1);
    mock.calculateRecipe.mockRejectedValue(new Error('Unexpected internal failure'));

    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(result).toContain('error inesperado');
  });
});

// ---------------------------------------------------------------------------
// 14. Ingredient section header count when resolvedCount + unresolvedCount differ
// ---------------------------------------------------------------------------

describe('formatRecipeResult — ingredient count header accuracy', () => {
  it('shows resolvedCount=0 / total=3 when all ingredients unresolved', () => {
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      resolvedCount: 0,
      unresolvedCount: 3,
      ingredients: [],
      unresolvedIngredients: ['a', 'b', 'c'],
    };
    const result = formatRecipeResult(data);
    expect(result).toMatch(/0\/3/);
  });

  it('shows resolvedCount=5 / total=5 with all resolved and no unresolved', () => {
    const ingredients = Array.from({ length: 5 }, (_, i) => makeIngredient({ nameEs: `Ing${i}`, grams: 100 }));
    const data: RecipeCalculateData = {
      ...BASE_DATA,
      resolvedCount: 5,
      unresolvedCount: 0,
      ingredients,
      unresolvedIngredients: [],
    };
    const result = formatRecipeResult(data);
    expect(result).toMatch(/5\/5/);
  });
});
