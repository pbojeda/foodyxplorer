// Unit tests for all shared Zod schemas
// Pure unit tests — no DB needed, no external deps

import { describe, it, expect } from 'vitest';
import {
  DataSourceTypeSchema,
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  FoodTypeSchema,
  NutrientReferenceBasisSchema,
  DishAvailabilitySchema,
} from '../schemas/enums';
import {
  CookingMethodSchema,
  CreateCookingMethodSchema,
} from '../schemas/cookingMethod';
import {
  DishCategorySchema,
  CreateDishCategorySchema,
} from '../schemas/dishCategory';
import {
  RestaurantSchema,
  CreateRestaurantSchema,
} from '../schemas/restaurant';
import { DishSchema, CreateDishSchema } from '../schemas/dish';
import {
  DishNutrientSchema,
  CreateDishNutrientSchema,
} from '../schemas/dishNutrient';
import {
  DishIngredientSchema,
  CreateDishIngredientSchema,
} from '../schemas/dishIngredient';
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
    const valid = ['official', 'ingredients', 'extrapolation', 'scraped', 'llm'] as const;
    for (const v of valid) {
      expect(EstimationMethodSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => EstimationMethodSchema.parse('guess')).toThrow();
  });
});

// PortionContextSchema removed in F-UX-B (enum dropped from DB and shared schemas).

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
  alcohol: 0,
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
    const { transFats: _tf, cholesterol: _ch, potassium: _po, monounsaturatedFats: _mf, polyunsaturatedFats: _pf, alcohol: _al, referenceBasis: _ref, ...withoutNewFields } = validNutrients;
    const result = CreateFoodNutrientSchema.parse(withoutNewFields);
    expect(result.transFats).toBe(0);
    expect(result.cholesterol).toBe(0);
    expect(result.alcohol).toBe(0);
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
// StandardPortion schemas — F-UX-B per-dish portion assumptions (replaces legacy XOR schema)
// ---------------------------------------------------------------------------

const validCreatePortion = {
  dishId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  term: 'tapa' as const,
  grams: 50,
  pieces: 2,
  pieceName: 'croquetas',
  confidence: 'high' as const,
  notes: null,
};

describe('CreateStandardPortionSchema — F-UX-B per-dish shape', () => {
  it('passes with pieces + pieceName both set', () => {
    const result = CreateStandardPortionSchema.parse(validCreatePortion);
    expect(result.dishId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(result.pieces).toBe(2);
    expect(result.pieceName).toBe('croquetas');
  });

  it('passes with pieces + pieceName both null (non-countable dish)', () => {
    const result = CreateStandardPortionSchema.parse({
      ...validCreatePortion,
      pieces: null,
      pieceName: null,
    });
    expect(result.pieces).toBeNull();
    expect(result.pieceName).toBeNull();
  });

  it('fails when pieces is set but pieceName is null', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validCreatePortion,
        pieceName: null,
      }),
    ).toThrow();
  });

  it('fails when pieces is null but pieceName is set', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({
        ...validCreatePortion,
        pieces: null,
        pieceName: 'croqueta',
      }),
    ).toThrow();
  });

  it('fails when grams is 0', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({ ...validCreatePortion, grams: 0 }),
    ).toThrow();
  });

  it('fails when pieces is 0 (min 1)', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({ ...validCreatePortion, pieces: 0 }),
    ).toThrow();
  });

  it('fails with invalid term', () => {
    expect(() =>
      CreateStandardPortionSchema.parse({ ...validCreatePortion, term: 'bocadillo' }),
    ).toThrow();
  });
});

describe('StandardPortionSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = StandardPortionSchema.parse({
      ...validCreatePortion,
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

// ---------------------------------------------------------------------------
// DishAvailabilitySchema
// ---------------------------------------------------------------------------

describe('DishAvailabilitySchema', () => {
  it('accepts all 4 valid values', () => {
    const valid = ['available', 'seasonal', 'discontinued', 'regional'] as const;
    for (const v of valid) {
      expect(DishAvailabilitySchema.parse(v)).toBe(v);
    }
  });

  it('rejects an invalid string', () => {
    expect(() => DishAvailabilitySchema.parse('unavailable')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CookingMethod schemas
// ---------------------------------------------------------------------------

const validCookingMethodBase = {
  name: 'Grilled',
  nameEs: 'A la parrilla',
  slug: 'grilled',
};

describe('CreateCookingMethodSchema', () => {
  it('passes with valid name/nameEs/slug', () => {
    const result = CreateCookingMethodSchema.parse(validCookingMethodBase);
    expect(result.name).toBe('Grilled');
    expect(result.slug).toBe('grilled');
  });

  it('fails when slug is empty string', () => {
    expect(() =>
      CreateCookingMethodSchema.parse({ ...validCookingMethodBase, slug: '' }),
    ).toThrow();
  });

  it('fails when name is missing', () => {
    const { name: _name, ...withoutName } = validCookingMethodBase;
    expect(() => CreateCookingMethodSchema.parse(withoutName)).toThrow();
  });

  it('accepts optional description', () => {
    const result = CreateCookingMethodSchema.parse({
      ...validCookingMethodBase,
      description: 'Cooked on a grill',
    });
    expect(result.description).toBe('Cooked on a grill');
  });
});

describe('CookingMethodSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = CookingMethodSchema.parse({
      ...validCookingMethodBase,
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// DishCategory schemas
// ---------------------------------------------------------------------------

const validDishCategoryBase = {
  name: 'Main Courses',
  nameEs: 'Platos principales',
  slug: 'main-courses',
};

describe('CreateDishCategorySchema', () => {
  it('passes with valid fields; sortOrder defaults to 0 when omitted', () => {
    const result = CreateDishCategorySchema.parse(validDishCategoryBase);
    expect(result.slug).toBe('main-courses');
    expect(result.sortOrder).toBe(0);
  });

  it('passes when sortOrder is explicitly set', () => {
    const result = CreateDishCategorySchema.parse({
      ...validDishCategoryBase,
      sortOrder: 5,
    });
    expect(result.sortOrder).toBe(5);
  });

  it('fails when slug is empty', () => {
    expect(() =>
      CreateDishCategorySchema.parse({ ...validDishCategoryBase, slug: '' }),
    ).toThrow();
  });

  it('fails when name is missing', () => {
    const { name: _name, ...withoutName } = validDishCategoryBase;
    expect(() => CreateDishCategorySchema.parse(withoutName)).toThrow();
  });
});

describe('DishCategorySchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = DishCategorySchema.parse({
      ...validDishCategoryBase,
      id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// Restaurant schemas
// ---------------------------------------------------------------------------

const validRestaurantBase = {
  name: "McDonald's Spain",
  chainSlug: 'mcdonalds',
  countryCode: 'ES',
  isActive: true,
};

describe('CreateRestaurantSchema', () => {
  it('passes with valid fields; countryCode defaults to ES; isActive defaults to true', () => {
    const result = CreateRestaurantSchema.parse({
      name: "McDonald's",
      chainSlug: 'mcdonalds',
    });
    expect(result.countryCode).toBe('ES');
    expect(result.isActive).toBe(true);
  });

  it('passes with all fields', () => {
    const result = CreateRestaurantSchema.parse(validRestaurantBase);
    expect(result.name).toBe("McDonald's Spain");
    expect(result.countryCode).toBe('ES');
  });

  it('fails when countryCode is lowercase (es)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...validRestaurantBase, countryCode: 'es' }),
    ).toThrow();
  });

  it('fails when countryCode is 3 chars (ESP)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...validRestaurantBase, countryCode: 'ESP' }),
    ).toThrow();
  });

  it('fails when countryCode is digits (12)', () => {
    expect(() =>
      CreateRestaurantSchema.parse({ ...validRestaurantBase, countryCode: '12' }),
    ).toThrow();
  });

  it('nameEs is optional/nullable', () => {
    const result = CreateRestaurantSchema.parse({
      ...validRestaurantBase,
      nameEs: null,
    });
    expect(result.nameEs).toBeNull();

    const result2 = CreateRestaurantSchema.parse(validRestaurantBase);
    expect(result2.nameEs).toBeUndefined();
  });
});

describe('RestaurantSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = RestaurantSchema.parse({
      ...validRestaurantBase,
      id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// Dish schemas
// ---------------------------------------------------------------------------

const validDishBase = {
  restaurantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  name: 'Big Mac',
  availability: 'available' as const,
  confidenceLevel: 'medium' as const,
  estimationMethod: 'scraped' as const,
  aliases: [],
};

describe('CreateDishSchema', () => {
  it('passes with valid fields including nullable foodId', () => {
    const result = CreateDishSchema.parse({
      ...validDishBase,
      foodId: null,
    });
    expect(result.name).toBe('Big Mac');
    expect(result.foodId).toBeNull();
  });

  it('availability defaults to available when omitted', () => {
    const { availability: _av, ...withoutAvailability } = validDishBase;
    const result = CreateDishSchema.parse(withoutAvailability);
    expect(result.availability).toBe('available');
  });

  it('portionGrams fails when 0', () => {
    expect(() =>
      CreateDishSchema.parse({ ...validDishBase, portionGrams: 0 }),
    ).toThrow();
  });

  it('portionGrams fails when negative', () => {
    expect(() =>
      CreateDishSchema.parse({ ...validDishBase, portionGrams: -1 }),
    ).toThrow();
  });

  it('portionGrams passes when null', () => {
    const result = CreateDishSchema.parse({ ...validDishBase, portionGrams: null });
    expect(result.portionGrams).toBeNull();
  });

  it('priceEur fails when negative', () => {
    expect(() =>
      CreateDishSchema.parse({ ...validDishBase, priceEur: -0.01 }),
    ).toThrow();
  });

  it('priceEur passes when 0', () => {
    const result = CreateDishSchema.parse({ ...validDishBase, priceEur: 0 });
    expect(result.priceEur).toBe(0);
  });

  it('priceEur passes when null', () => {
    const result = CreateDishSchema.parse({ ...validDishBase, priceEur: null });
    expect(result.priceEur).toBeNull();
  });

  it('aliases is array of strings', () => {
    const result = CreateDishSchema.parse({
      ...validDishBase,
      aliases: ['big mac', 'bigmac'],
    });
    expect(result.aliases).toEqual(['big mac', 'bigmac']);
  });

  it('aliases defaults to empty array when omitted', () => {
    const { aliases: _al, ...withoutAliases } = validDishBase;
    const result = CreateDishSchema.parse(withoutAliases);
    expect(result.aliases).toEqual([]);
  });

  it('fails when aliases is not an array', () => {
    expect(() =>
      CreateDishSchema.parse({ ...validDishBase, aliases: 'big mac' }),
    ).toThrow();
  });
});

describe('DishSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = DishSchema.parse({
      ...validDishBase,
      id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// DishNutrient schemas
// ---------------------------------------------------------------------------

const validDishNutrientBase = {
  dishId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  calories: 563,
  proteins: 26,
  carbohydrates: 44,
  sugars: 9,
  fats: 30,
  saturatedFats: 11,
  fiber: 3,
  salt: 1.7,
  sodium: 0.68,
  referenceBasis: 'per_serving' as const,
  transFats: 0,
  cholesterol: 0,
  potassium: 0,
  monounsaturatedFats: 0,
  polyunsaturatedFats: 0,
  alcohol: 0,
  estimationMethod: 'scraped' as const,
  sourceId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  confidenceLevel: 'medium' as const,
};

describe('CreateDishNutrientSchema', () => {
  it('passes with valid values; referenceBasis defaults to per_serving', () => {
    const { referenceBasis: _rb, ...withoutReferenceBasis } = validDishNutrientBase;
    const result = CreateDishNutrientSchema.parse(withoutReferenceBasis);
    expect(result.referenceBasis).toBe('per_serving');
  });

  it('calories fails when > 9000', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, calories: 9001 }),
    ).toThrow();
  });

  it('calories passes when exactly 9000', () => {
    const result = CreateDishNutrientSchema.parse({
      ...validDishNutrientBase,
      calories: 9000,
    });
    expect(result.calories).toBe(9000);
  });

  it('calories fails when negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, calories: -1 }),
    ).toThrow();
  });

  it('extended nutrients default to 0 when omitted', () => {
    const {
      transFats: _tf,
      cholesterol: _ch,
      potassium: _po,
      monounsaturatedFats: _mf,
      polyunsaturatedFats: _pf,
      alcohol: _al,
      referenceBasis: _rb,
      ...withoutExtended
    } = validDishNutrientBase;
    const result = CreateDishNutrientSchema.parse(withoutExtended);
    expect(result.transFats).toBe(0);
    expect(result.cholesterol).toBe(0);
    expect(result.potassium).toBe(0);
    expect(result.monounsaturatedFats).toBe(0);
    expect(result.polyunsaturatedFats).toBe(0);
    expect(result.alcohol).toBe(0);
  });

  it('fails when transFats is negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, transFats: -0.1 }),
    ).toThrow();
  });

  it('fails when cholesterol is negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, cholesterol: -1 }),
    ).toThrow();
  });

  it('fails when potassium is negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, potassium: -1 }),
    ).toThrow();
  });

  it('fails when monounsaturatedFats is negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, monounsaturatedFats: -1 }),
    ).toThrow();
  });

  it('fails when polyunsaturatedFats is negative', () => {
    expect(() =>
      CreateDishNutrientSchema.parse({ ...validDishNutrientBase, polyunsaturatedFats: -1 }),
    ).toThrow();
  });

  it('estimationMethod is required (no default)', () => {
    const { estimationMethod: _em, ...withoutEM } = validDishNutrientBase;
    expect(() => CreateDishNutrientSchema.parse(withoutEM)).toThrow();
  });
});

describe('DishNutrientSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = DishNutrientSchema.parse({
      ...validDishNutrientBase,
      id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ---------------------------------------------------------------------------
// DishIngredient schemas
// ---------------------------------------------------------------------------

const validDishIngredientBase = {
  dishId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  ingredientFoodId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  amount: 150,
  unit: 'g',
  gramWeight: 150,
  sortOrder: 0,
  notes: null,
};

describe('CreateDishIngredientSchema', () => {
  it('passes with valid input using dishId instead of recipeId', () => {
    const result = CreateDishIngredientSchema.parse(validDishIngredientBase);
    expect(result.dishId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(result.amount).toBe(150);
    expect(result.sortOrder).toBe(0);
  });

  it('fails when amount is 0 (must be positive)', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...validDishIngredientBase, amount: 0 }),
    ).toThrow();
  });

  it('fails when amount is negative', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...validDishIngredientBase, amount: -1 }),
    ).toThrow();
  });

  it('fails when sortOrder is negative', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...validDishIngredientBase, sortOrder: -1 }),
    ).toThrow();
  });

  it('fails when unit is empty string', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...validDishIngredientBase, unit: '' }),
    ).toThrow();
  });

  it('fails when unit exceeds 50 characters', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({
        ...validDishIngredientBase,
        unit: 'a'.repeat(51),
      }),
    ).toThrow();
  });

  it('gramWeight nullable; passes when null', () => {
    const result = CreateDishIngredientSchema.parse({
      ...validDishIngredientBase,
      gramWeight: null,
    });
    expect(result.gramWeight).toBeNull();
  });

  it('gramWeight fails when negative', () => {
    expect(() =>
      CreateDishIngredientSchema.parse({ ...validDishIngredientBase, gramWeight: -1 }),
    ).toThrow();
  });
});

describe('DishIngredientSchema', () => {
  it('passes with all fields including id and timestamps', () => {
    const result = DishIngredientSchema.parse({
      ...validDishIngredientBase,
      id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.id).toBe('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22');
  });
});
