// Unit tests for all shared Zod schemas
// Pure unit tests — no DB needed, no external deps

import { describe, it, expect } from 'vitest';
import {
  DataSourceTypeSchema,
  ConfidenceLevelSchema,
  EstimationMethodSchema,
  PortionContextSchema,
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
    const { nameEs: _, ...withoutNameEs } = validFoodBase;
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
