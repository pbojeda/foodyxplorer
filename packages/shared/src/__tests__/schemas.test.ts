// Unit tests for all shared Zod schemas
// Pure unit tests — no DB needed, no external deps

import { describe, it, expect } from 'vitest';
import {
  DataSourceTypeSchema,
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  PortionContextSchema,
  FoodTypeSchema,
  NutrientReferenceBasisSchema,
} from '../schemas/enums';
import {
  DataSourceSchema,
  CreateDataSourceSchema,
} from '../schemas/dataSource';
import { FoodSchema, CreateFoodSchema } from '../schemas/food';
import {
  FoodNutrientSchema,
  CreateFoodNutrientSchema,
} from '../schemas/foodNutrient';
import {
  StandardPortionSchema,
  CreateStandardPortionSchema,
} from '../schemas/standardPortion';
import { RecipeSchema, CreateRecipeSchema } from '../schemas/recipe';
import {
  RecipeIngredientSchema,
  CreateRecipeIngredientSchema,
} from '../schemas/recipeIngredient';

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

describe('DataSourceTypeSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['official', 'estimated', 'scraped', 'user'] as const;
    for (const v of valid) {
      expect(DataSourceTypeSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => DataSourceTypeSchema.parse('unknown')).toThrow();
  });
});

describe('ConfidenceLevelSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['high', 'medium', 'low'] as const;
    for (const v of valid) {
      expect(ConfidenceLevelSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => ConfidenceLevelSchema.parse('VERY_HIGH')).toThrow();
  });
});

describe('EstimationMethodSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['official', 'ingredients', 'extrapolation', 'scraped'] as const;
    for (const v of valid) {
      expect(EstimationMethodSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => EstimationMethodSchema.parse('guess')).toThrow();
  });
});

describe('PortionContextSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['main_course', 'side_dish', 'dessert', 'starter', 'snack'] as const;
    for (const v of valid) {
      expect(PortionContextSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => PortionContextSchema.parse('beverage')).toThrow();
  });
});

describe('FoodTypeSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['generic', 'branded', 'composite'] as const;
    for (const v of valid) {
      expect(FoodTypeSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => FoodTypeSchema.parse('unknown')).toThrow();
  });
});

describe('NutrientReferenceBasisSchema', () => {
  it('accepts all valid values', () => {
    const valid = ['per_100g', 'per_serving', 'per_package'] as const;
    for (const v of valid) {
      expect(NutrientReferenceBasisSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => NutrientReferenceBasisSchema.parse('per_meal')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DataSource schemas
// ---------------------------------------------------------------------------

const validDataSourceBase = {
  name: 'USDA FoodData Central',
  type: 'official' as const,
  url: 'https://fdc.nal.usda.gov/',
  lastUpdated: new Date('2024-01-01'),
};

describe('CreateDataSourceSchema', () => {
  it('passes with valid minimal input', () => {
    const result = CreateDataSourceSchema.parse({
      name: 'FEN',
      type: 'official',
    });
    expect(result.name).toBe('FEN');
    expect(result.type).toBe('official');
  });

  it('passes with all fields', () => {
    const result = CreateDataSourceSchema.parse(validDataSourceBase);
    expect(result.url).toBe('https://fdc.nal.usda.gov/');
  });

  it('fails when name is missing', () => {
    expect(() => CreateDataSourceSchema.parse({ type: 'official' })).toThrow();
  });

  it('fails when type is invalid', () => {
    expect(() =>
      CreateDataSourceSchema.parse({ name: 'FEN', type: 'fake' }),
    ).toThrow();
  });

  it('strips unknown fields', () => {
    const result = CreateDataSourceSchema.parse({
      ...validDataSourceBase,
      unknownField: 'should be stripped',
    });
    expect((result as Record<string, unknown>)["unknownField"]).toBeUndefined();
  });
});

describe('DataSourceSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = DataSourceSchema.parse({
      ...validDataSourceBase,
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// Food schemas
// ---------------------------------------------------------------------------

const validFoodBase = {
  name: 'Chicken',
  nameEs: 'Pollo',
  aliases: ['hen', 'poultry'],
  foodGroup: 'Meat',
  sourceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  externalId: 'USDA-001',
  confidenceLevel: 'high' as const,
  foodType: 'generic' as const,
};

describe('CreateFoodSchema', () => {
  it('passes with valid input', () => {
    const result = CreateFoodSchema.parse(validFoodBase);
    expect(result.name).toBe('Chicken');
    expect(result.aliases).toEqual(['hen', 'poultry']);
  });

  it('fails when name is empty string', () => {
    expect(() =>
      CreateFoodSchema.parse({ ...validFoodBase, name: '' }),
    ).toThrow();
  });

  it('fails when nameEs is missing', () => {
    const { nameEs: _nameEs, ...withoutNameEs } = validFoodBase;
    expect(() => CreateFoodSchema.parse(withoutNameEs)).toThrow();
  });

  it('fails when aliases is not an array', () => {
    expect(() =>
      CreateFoodSchema.parse({ ...validFoodBase, aliases: 'hen' }),
    ).toThrow();
  });

  it('accepts null foodGroup (optional field)', () => {
    const result = CreateFoodSchema.parse({ ...validFoodBase, foodGroup: null });
    expect(result.foodGroup).toBeNull();
  });

  it('accepts null externalId (optional field)', () => {
    const result = CreateFoodSchema.parse({
      ...validFoodBase,
      externalId: null,
    });
    expect(result.externalId).toBeNull();
  });
});

describe('FoodSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = FoodSchema.parse({
      ...validFoodBase,
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// FoodNutrient schemas
// ---------------------------------------------------------------------------

const validNutrients = {
  foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  calories: 165,
  proteins: 31,
  carbohydrates: 0,
  sugars: 0,
  fats: 3.6,
  saturatedFats: 1,
  fiber: 0,
  salt: 0.07,
  sodium: 0.074,
  referenceBasis: 'per_100g' as const,
  transFats: 0,
  cholesterol: 0,
  potassium: 0,
  monounsaturatedFats: 0,
  polyunsaturatedFats: 0,
  sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  confidenceLevel: 'high' as const,
};

describe('CreateFoodNutrientSchema', () => {
  it('passes with valid nutrient values', () => {
    const result = CreateFoodNutrientSchema.parse(validNutrients);
    expect(result.calories).toBe(165);
  });

  it('fails when calories is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, calories: -1 }),
    ).toThrow();
  });

  it('fails when calories exceeds 900', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, calories: 901 }),
    ).toThrow();
  });

  it('fails when proteins is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, proteins: -0.1 }),
    ).toThrow();
  });

  it('fails when carbohydrates is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, carbohydrates: -1 }),
    ).toThrow();
  });

  it('fails when fats is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, fats: -5 }),
    ).toThrow();
  });

  it('accepts extra as arbitrary JSON object', () => {
    const result = CreateFoodNutrientSchema.parse({
      ...validNutrients,
      extra: { vitamin_c: 1.2, potassium: 256 },
    });
    expect(result.extra).toEqual({ vitamin_c: 1.2, potassium: 256 });
  });

  it('accepts extra as undefined (optional)', () => {
    const result = CreateFoodNutrientSchema.parse(validNutrients);
    expect(result.extra).toBeUndefined();
  });

  it('fails when transFats is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, transFats: -0.1 }),
    ).toThrow();
  });

  it('fails when cholesterol is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, cholesterol: -1 }),
    ).toThrow();
  });

  it('fails when potassium is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, potassium: -1 }),
    ).toThrow();
  });

  it('fails when monounsaturatedFats is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, monounsaturatedFats: -1 }),
    ).toThrow();
  });

  it('fails when polyunsaturatedFats is negative', () => {
    expect(() =>
      CreateFoodNutrientSchema.parse({ ...validNutrients, polyunsaturatedFats: -1 }),
    ).toThrow();
  });

  it('accepts 0 for all new nutrient fields', () => {
    const result = CreateFoodNutrientSchema.parse({
      ...validNutrients,
      transFats: 0,
      cholesterol: 0,
      potassium: 0,
      monounsaturatedFats: 0,
      polyunsaturatedFats: 0,
    });
    expect(result.transFats).toBe(0);
    expect(result.cholesterol).toBe(0);
    expect(result.potassium).toBe(0);
    expect(result.monounsaturatedFats).toBe(0);
    expect(result.polyunsaturatedFats).toBe(0);
  });

  it('applies default 0 when new nutrient fields are omitted', () => {
    const { transFats: _tf, cholesterol: _ch, potassium: _po, monounsaturatedFats: _mf, polyunsaturatedFats: _pf, referenceBasis: _ref, ...withoutNewFields } = validNutrients;
    const result = CreateFoodNutrientSchema.parse(withoutNewFields);
    expect(result.transFats).toBe(0);
    expect(result.cholesterol).toBe(0);
    expect(result.referenceBasis).toBe('per_100g');
  });
});

describe('FoodNutrientSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = FoodNutrientSchema.parse({
      ...validNutrients,
      id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// StandardPortion schemas — XOR constraint
// ---------------------------------------------------------------------------

const validPortionWithFood = {
  foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  foodGroup: null,
  context: 'main_course' as const,
  portionGrams: 150,
  sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  confidenceLevel: 'medium' as const,
  description: '1 serving',
  isDefault: false,
};

describe('CreateStandardPortionSchema — XOR constraint', () => {
  it('passes when only foodId is set', () => {
    const result = CreateStandardPortionSchema.parse(validPortionWithFood);
    expect(result.foodId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(result.foodGroup).toBeNull();
  });

  it('passes when only foodGroup is set', () => {
    const result = CreateStandardPortionSchema.parse({
      ...validPortionWithFood,
      foodId: null,
      foodGroup: 'Cereales',
    });
    expect(result.foodGroup).toBe('Cereales');
    expect(result.foodId).toBeNull();
  });

  it('fails when both foodId and foodGroup are null', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validPortionWithFood,
        foodId: null,
        foodGroup: null,
      }),
    ).toThrow();
  });

  it('fails when both foodId and foodGroup are set', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validPortionWithFood,
        foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        foodGroup: 'Cereales',
      }),
    ).toThrow();
  });

  it('accepts optional notes field', () => {
    const result = CreateStandardPortionSchema.parse({
      ...validPortionWithFood,
      notes: 'Plato principal típico',
    });
    expect(result.notes).toBe('Plato principal típico');
  });

  it('fails when portionGrams is negative', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validPortionWithFood,
        portionGrams: -10,
      }),
    ).toThrow();
  });

  it('fails when description is empty string', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validPortionWithFood,
        description: '',
      }),
    ).toThrow();
  });

  it('passes when isDefault is omitted (defaults to false)', () => {
    const { isDefault: _isDefault, ...withoutIsDefault } = validPortionWithFood;
    const result = CreateStandardPortionSchema.parse(withoutIsDefault);
    expect(result.isDefault).toBe(false);
  });

  it('requires description — fails when omitted', () => {
    const { description: _desc, ...withoutDescription } = validPortionWithFood;
    expect(() =>
      CreateStandardPortionSchema.parse(withoutDescription),
    ).toThrow();
  });
});

describe('StandardPortionSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = StandardPortionSchema.parse({
      ...validPortionWithFood,
      id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// Recipe schemas
// ---------------------------------------------------------------------------

const validRecipeBase = {
  foodId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 30,
  sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
};

describe('CreateRecipeSchema', () => {
  it('passes with all fields', () => {
    const result = CreateRecipeSchema.parse(validRecipeBase);
    expect(result.foodId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(result.servings).toBe(2);
    expect(result.prepMinutes).toBe(10);
    expect(result.cookMinutes).toBe(30);
  });

  it('passes when servings, prepMinutes, cookMinutes are null', () => {
    const result = CreateRecipeSchema.parse({
      ...validRecipeBase,
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
    });
    expect(result.servings).toBeNull();
    expect(result.prepMinutes).toBeNull();
    expect(result.cookMinutes).toBeNull();
  });

  it('fails when servings is 0 (must be positive)', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, servings: 0 }),
    ).toThrow();
  });

  it('fails when servings is negative', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, servings: -1 }),
    ).toThrow();
  });

  it('fails when prepMinutes is negative', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, prepMinutes: -1 }),
    ).toThrow();
  });

  it('fails when cookMinutes is negative', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, cookMinutes: -1 }),
    ).toThrow();
  });

  it('fails when foodId is missing', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, foodId: undefined }),
    ).toThrow();
  });

  it('fails when sourceId is not a valid UUID', () => {
    expect(() =>
      CreateRecipeSchema.parse({ ...validRecipeBase, sourceId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('RecipeSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = RecipeSchema.parse({
      ...validRecipeBase,
      id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// RecipeIngredient schemas
// ---------------------------------------------------------------------------

const validIngredientBase = {
  recipeId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  ingredientFoodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  amount: 150,
  unit: 'g',
  gramWeight: 150,
  sortOrder: 0,
  notes: null,
};

describe('CreateRecipeIngredientSchema', () => {
  it('passes with valid input', () => {
    const result = CreateRecipeIngredientSchema.parse(validIngredientBase);
    expect(result.recipeId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(result.amount).toBe(150);
    expect(result.unit).toBe('g');
    expect(result.sortOrder).toBe(0);
  });

  it('fails when amount is 0 (must be positive)', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...validIngredientBase, amount: 0 }),
    ).toThrow();
  });

  it('fails when amount is negative', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...validIngredientBase, amount: -1 }),
    ).toThrow();
  });

  it('fails when sortOrder is negative', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...validIngredientBase, sortOrder: -1 }),
    ).toThrow();
  });

  it('fails when unit is empty string', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...validIngredientBase, unit: '' }),
    ).toThrow();
  });

  it('fails when unit exceeds 50 characters', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({
        ...validIngredientBase,
        unit: 'a'.repeat(51),
      }),
    ).toThrow();
  });

  it('allows gramWeight to be null', () => {
    const result = CreateRecipeIngredientSchema.parse({
      ...validIngredientBase,
      gramWeight: null,
    });
    expect(result.gramWeight).toBeNull();
  });

  it('fails when gramWeight is negative', () => {
    expect(() =>
      CreateRecipeIngredientSchema.parse({ ...validIngredientBase, gramWeight: -1 }),
    ).toThrow();
  });
});

describe('RecipeIngredientSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = RecipeIngredientSchema.parse({
      ...validIngredientBase,
      id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});
