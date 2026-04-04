// F076 — Unit tests for MenuEstimation Zod schemas

import { describe, it, expect } from 'vitest';
import {
  MenuEstimationTotalsSchema,
  MenuEstimationItemSchema,
  MenuEstimationDataSchema,
  ConversationIntentSchema,
  ConversationMessageDataSchema,
} from '../index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_TOTALS = {
  calories: 850,
  proteins: 42,
  carbohydrates: 95,
  sugars: 15,
  fats: 28,
  saturatedFats: 8,
  fiber: 6,
  salt: 2.1,
  sodium: 840,
  transFats: 0,
  cholesterol: 120,
  potassium: 800,
  monounsaturatedFats: 10,
  polyunsaturatedFats: 5,
  alcohol: 0,
};

const ZERO_TOTALS = {
  calories: 0, proteins: 0, carbohydrates: 0, sugars: 0,
  fats: 0, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
};

const VALID_ESTIMATION = {
  query: 'gazpacho',
  chainSlug: null,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: '00000000-0000-e073-0007-000000000001',
    name: 'Gazpacho',
    nameEs: 'Gazpacho',
    restaurantId: '00000000-0000-e073-0006-000000000001',
    chainSlug: null,
    portionGrams: 300,
    nutrients: {
      calories: 120, proteins: 2, carbohydrates: 10, sugars: 5,
      fats: 8, saturatedFats: 1, fiber: 2, salt: 0.5, sodium: 200,
      transFats: 0, cholesterol: 0, potassium: 300,
      monounsaturatedFats: 5, polyunsaturatedFats: 1, alcohol: 0,
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official' as const,
    source: { id: '00000000-0000-0000-0000-000000000003', name: 'BEDCA', type: 'official' as const, url: null },
    similarityDistance: null,
  },
  cachedAt: null,
  portionMultiplier: 1,
};

const NULL_RESULT_ESTIMATION = {
  query: 'plato desconocido',
  chainSlug: null,
  level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
  portionMultiplier: 1,
};

// ---------------------------------------------------------------------------
// MenuEstimationTotalsSchema
// ---------------------------------------------------------------------------

describe('MenuEstimationTotalsSchema', () => {
  it('validates valid totals with all 14 nutrients', () => {
    expect(MenuEstimationTotalsSchema.safeParse(VALID_TOTALS).success).toBe(true);
  });

  it('validates zero-filled totals', () => {
    expect(MenuEstimationTotalsSchema.safeParse(ZERO_TOTALS).success).toBe(true);
  });

  it('rejects negative values', () => {
    const result = MenuEstimationTotalsSchema.safeParse({ ...VALID_TOTALS, calories: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects missing nutrient fields', () => {
    const { potassium: _, ...incomplete } = VALID_TOTALS;
    const result = MenuEstimationTotalsSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MenuEstimationItemSchema
// ---------------------------------------------------------------------------

describe('MenuEstimationItemSchema', () => {
  it('validates item with matched estimation', () => {
    const result = MenuEstimationItemSchema.safeParse({
      query: 'gazpacho',
      estimation: VALID_ESTIMATION,
    });
    expect(result.success).toBe(true);
  });

  it('validates item with null-result estimation (not found)', () => {
    const result = MenuEstimationItemSchema.safeParse({
      query: 'plato desconocido',
      estimation: NULL_RESULT_ESTIMATION,
    });
    expect(result.success).toBe(true);
  });

  it('rejects item with missing estimation', () => {
    const result = MenuEstimationItemSchema.safeParse({ query: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects item with null estimation (estimation itself must be non-null)', () => {
    const result = MenuEstimationItemSchema.safeParse({ query: 'test', estimation: null });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MenuEstimationDataSchema
// ---------------------------------------------------------------------------

describe('MenuEstimationDataSchema', () => {
  it('validates complete menu estimation data', () => {
    const result = MenuEstimationDataSchema.safeParse({
      items: [
        { query: 'gazpacho', estimation: VALID_ESTIMATION },
        { query: 'plato desconocido', estimation: NULL_RESULT_ESTIMATION },
      ],
      totals: VALID_TOTALS,
      itemCount: 2,
      matchedCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('validates zero-match menu', () => {
    const result = MenuEstimationDataSchema.safeParse({
      items: [{ query: 'x', estimation: NULL_RESULT_ESTIMATION }],
      totals: ZERO_TOTALS,
      itemCount: 1,
      matchedCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative itemCount', () => {
    const result = MenuEstimationDataSchema.safeParse({
      items: [],
      totals: ZERO_TOTALS,
      itemCount: -1,
      matchedCount: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConversationIntentSchema — menu_estimation added
// ---------------------------------------------------------------------------

describe('ConversationIntentSchema (F076)', () => {
  it('accepts menu_estimation intent', () => {
    expect(ConversationIntentSchema.safeParse('menu_estimation').success).toBe(true);
  });

  it('still accepts existing intents', () => {
    for (const intent of ['context_set', 'comparison', 'estimation', 'text_too_long']) {
      expect(ConversationIntentSchema.safeParse(intent).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ConversationMessageDataSchema — menuEstimation field
// ---------------------------------------------------------------------------

describe('ConversationMessageDataSchema (F076)', () => {
  const ACTOR_ID = '00000000-0000-0000-0000-000000000001';

  it('accepts menu_estimation intent with menuEstimation field', () => {
    const result = ConversationMessageDataSchema.safeParse({
      intent: 'menu_estimation',
      actorId: ACTOR_ID,
      menuEstimation: {
        items: [{ query: 'gazpacho', estimation: VALID_ESTIMATION }],
        totals: VALID_TOTALS,
        itemCount: 1,
        matchedCount: 1,
      },
      activeContext: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts menu_estimation without menuEstimation field (optional)', () => {
    const result = ConversationMessageDataSchema.safeParse({
      intent: 'menu_estimation',
      actorId: ACTOR_ID,
      activeContext: null,
    });
    expect(result.success).toBe(true);
  });
});
