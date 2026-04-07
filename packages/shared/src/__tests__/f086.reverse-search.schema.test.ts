import { describe, it, expect } from 'vitest';
import {
  ReverseSearchQuerySchema,
  ReverseSearchResultSchema,
  ReverseSearchDataSchema,
  ConversationIntentSchema,
  ConversationMessageDataSchema,
} from '../index.js';

// ---------------------------------------------------------------------------
// ReverseSearchQuerySchema
// ---------------------------------------------------------------------------

describe('ReverseSearchQuerySchema', () => {
  it('accepts valid params with all fields', () => {
    const result = ReverseSearchQuerySchema.parse({
      chainSlug: 'burger-king',
      maxCalories: 600,
      minProtein: 30,
      limit: 10,
    });
    expect(result.chainSlug).toBe('burger-king');
    expect(result.maxCalories).toBe(600);
    expect(result.minProtein).toBe(30);
    expect(result.limit).toBe(10);
  });

  it('accepts valid params with only required fields (defaults limit to 5)', () => {
    const result = ReverseSearchQuerySchema.parse({
      chainSlug: 'mcdonalds',
      maxCalories: 500,
    });
    expect(result.minProtein).toBeUndefined();
    expect(result.limit).toBe(5);
  });

  it('coerces string numbers from query params', () => {
    const result = ReverseSearchQuerySchema.parse({
      chainSlug: 'mcdonalds',
      maxCalories: '400',
      minProtein: '20',
      limit: '8',
    });
    expect(result.maxCalories).toBe(400);
    expect(result.minProtein).toBe(20);
    expect(result.limit).toBe(8);
  });

  it('rejects missing chainSlug', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ maxCalories: 600 }),
    ).toThrow();
  });

  it('rejects missing maxCalories', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'burger-king' }),
    ).toThrow();
  });

  it('rejects maxCalories < 100', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 50 }),
    ).toThrow();
  });

  it('rejects maxCalories > 3000', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 5000 }),
    ).toThrow();
  });

  it('rejects minProtein < 0', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 600, minProtein: -5 }),
    ).toThrow();
  });

  it('rejects minProtein > 200', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 600, minProtein: 250 }),
    ).toThrow();
  });

  it('rejects limit > 20', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 600, limit: 25 }),
    ).toThrow();
  });

  it('rejects limit < 1', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'bk', maxCalories: 600, limit: 0 }),
    ).toThrow();
  });

  it('rejects invalid chainSlug format', () => {
    expect(() =>
      ReverseSearchQuerySchema.parse({ chainSlug: 'Burger King!', maxCalories: 600 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReverseSearchResultSchema
// ---------------------------------------------------------------------------

describe('ReverseSearchResultSchema', () => {
  const validResult = {
    name: 'Whopper',
    nameEs: null,
    calories: 657,
    proteins: 28,
    fats: 40,
    carbohydrates: 49,
    portionGrams: 290,
    proteinDensity: 4.26,
  };

  it('accepts a valid result', () => {
    const parsed = ReverseSearchResultSchema.parse(validResult);
    expect(parsed.name).toBe('Whopper');
    expect(parsed.proteinDensity).toBe(4.26);
  });

  it('accepts null portionGrams and nameEs', () => {
    const parsed = ReverseSearchResultSchema.parse({
      ...validResult,
      nameEs: null,
      portionGrams: null,
    });
    expect(parsed.portionGrams).toBeNull();
    expect(parsed.nameEs).toBeNull();
  });

  it('rejects missing name', () => {
    const { name: _, ...without } = validResult;
    expect(() => ReverseSearchResultSchema.parse(without)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReverseSearchDataSchema
// ---------------------------------------------------------------------------

describe('ReverseSearchDataSchema', () => {
  const validData = {
    chainSlug: 'burger-king',
    chainName: 'Burger King',
    maxCalories: 600,
    minProtein: null,
    results: [],
    totalMatches: 0,
  };

  it('accepts valid data with empty results', () => {
    const parsed = ReverseSearchDataSchema.parse(validData);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.totalMatches).toBe(0);
  });

  it('accepts valid data with results', () => {
    const parsed = ReverseSearchDataSchema.parse({
      ...validData,
      minProtein: 20,
      results: [
        {
          name: 'Grilled Chicken',
          nameEs: 'Pollo a la Parrilla',
          calories: 350,
          proteins: 40,
          fats: 12,
          carbohydrates: 20,
          portionGrams: 200,
          proteinDensity: 11.43,
        },
      ],
      totalMatches: 1,
    });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.minProtein).toBe(20);
  });

  it('rejects missing chainSlug', () => {
    const { chainSlug: _, ...without } = validData;
    expect(() => ReverseSearchDataSchema.parse(without)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ConversationIntentSchema — includes reverse_search
// ---------------------------------------------------------------------------

describe('ConversationIntentSchema — reverse_search', () => {
  it('accepts reverse_search as a valid intent', () => {
    const result = ConversationIntentSchema.parse('reverse_search');
    expect(result).toBe('reverse_search');
  });

  it('still accepts existing intents', () => {
    expect(ConversationIntentSchema.parse('estimation')).toBe('estimation');
    expect(ConversationIntentSchema.parse('context_set')).toBe('context_set');
  });
});

// ---------------------------------------------------------------------------
// ConversationMessageDataSchema — includes reverseSearch field
// ---------------------------------------------------------------------------

describe('ConversationMessageDataSchema — reverseSearch field', () => {
  const baseData = {
    intent: 'reverse_search' as const,
    actorId: '00000000-0000-0000-0000-000000000001',
    activeContext: { chainSlug: 'burger-king', chainName: 'Burger King' },
  };

  it('accepts reverse_search intent with reverseSearch data', () => {
    const parsed = ConversationMessageDataSchema.parse({
      ...baseData,
      reverseSearch: {
        chainSlug: 'burger-king',
        chainName: 'Burger King',
        maxCalories: 600,
        minProtein: null,
        results: [],
        totalMatches: 0,
      },
    });
    expect(parsed.intent).toBe('reverse_search');
    expect(parsed.reverseSearch).toBeDefined();
  });

  it('accepts reverse_search intent without reverseSearch data (error case)', () => {
    const parsed = ConversationMessageDataSchema.parse(baseData);
    expect(parsed.reverseSearch).toBeUndefined();
  });
});
