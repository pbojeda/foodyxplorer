// Unit tests for conversation.ts Zod schemas (F070)
//
// Covers: ConversationMessageBodySchema, ConversationIntentSchema,
//         ConversationMessageDataSchema — valid inputs, invalid inputs,
//         trim behaviour, min/max bounds, optional field presence by intent.

import { describe, it, expect } from 'vitest';
import {
  ConversationMessageBodySchema,
  ConversationIntentSchema,
  ConversationMessageDataSchema,
  NutrientKeySchema,
  ConversationTurnStateSchema,
  FollowUpAttributeDataSchema,
  FollowUpRefinementDataSchema,
  FollowUpMetaSchema,
} from '../schemas/conversation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ESTIMATE_DATA = {
  query: 'big mac',
  chainSlug: 'mcdonalds-es',
  portionMultiplier: 1,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  result: null,
  cachedAt: null,
};

// ---------------------------------------------------------------------------
// ConversationMessageBodySchema
// ---------------------------------------------------------------------------

describe('ConversationMessageBodySchema', () => {
  it('parses a minimal valid body with just text', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'big mac' });
    expect(result.success).toBe(true);
  });

  it('parses body with optional chainSlug and chainName', () => {
    const result = ConversationMessageBodySchema.safeParse({
      text: 'big mac',
      chainSlug: 'mcdonalds-es',
      chainName: "McDonald's",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chainSlug).toBe('mcdonalds-es');
      expect(result.data.chainName).toBe("McDonald's");
    }
  });

  it('trims leading and trailing whitespace from text', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: '  big mac  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('big mac');
    }
  });

  it('rejects empty string after trim', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects text that exceeds 2000 chars', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'a'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('accepts text at exactly 2000 chars', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'a'.repeat(2000) });
    expect(result.success).toBe(true);
  });

  it('accepts text at exactly 1 char', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'x' });
    expect(result.success).toBe(true);
  });

  it('rejects missing text field', () => {
    const result = ConversationMessageBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('chainSlug and chainName are optional — absent is valid', () => {
    const result = ConversationMessageBodySchema.safeParse({ text: 'pollo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chainSlug).toBeUndefined();
      expect(result.data.chainName).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ConversationIntentSchema
// ---------------------------------------------------------------------------

describe('ConversationIntentSchema', () => {
  it('accepts context_set', () => {
    expect(ConversationIntentSchema.safeParse('context_set').success).toBe(true);
  });

  it('accepts comparison', () => {
    expect(ConversationIntentSchema.safeParse('comparison').success).toBe(true);
  });

  it('accepts estimation', () => {
    expect(ConversationIntentSchema.safeParse('estimation').success).toBe(true);
  });

  it('accepts text_too_long', () => {
    expect(ConversationIntentSchema.safeParse('text_too_long').success).toBe(true);
  });

  it('rejects unknown intent', () => {
    expect(ConversationIntentSchema.safeParse('unknown').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ConversationIntentSchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConversationMessageDataSchema
// ---------------------------------------------------------------------------

describe('ConversationMessageDataSchema', () => {
  describe('intent: text_too_long', () => {
    it('parses minimal text_too_long response with null activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses text_too_long with an activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: context_set (resolved)', () => {
    it('parses context_set resolved response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'context_set',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
        activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: context_set (ambiguous)', () => {
    it('parses context_set ambiguous response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'context_set',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        ambiguous: true,
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: estimation', () => {
    it('parses estimation response', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        estimation: VALID_ESTIMATE_DATA,
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('intent: comparison', () => {
    it('parses comparison response with both dishes', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'comparison',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        comparison: {
          dishA: VALID_ESTIMATE_DATA,
          dishB: VALID_ESTIMATE_DATA,
        },
        activeContext: null,
      });
      expect(result.success).toBe(true);
    });

    it('parses comparison response with optional nutrientFocus', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'comparison',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        comparison: {
          dishA: VALID_ESTIMATE_DATA,
          dishB: VALID_ESTIMATE_DATA,
          nutrientFocus: 'calorías',
        },
        activeContext: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.comparison?.nutrientFocus).toBe('calorías');
      }
    });
  });

  describe('validation failures', () => {
    it('rejects missing intent', () => {
      const result = ConversationMessageDataSchema.safeParse({
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid intent value', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'invalid_intent',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-uuid actorId', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        actorId: 'not-a-uuid',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing actorId', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'estimation',
        activeContext: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-null/non-object activeContext', () => {
      const result = ConversationMessageDataSchema.safeParse({
        intent: 'text_too_long',
        actorId: 'fd000000-0001-4000-a000-000000000001',
        activeContext: 'not-an-object',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// F-MULTITURN-001 — New schema additions
// ---------------------------------------------------------------------------

const VALID_ESTIMATE_DATA_WITH_RESULT = {
  query: 'paella valenciana',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0001-4000-a000-000000000011',
    name: 'Paella Valenciana',
    nameEs: 'Paella valenciana',
    restaurantId: null,
    chainSlug: null,
    portionGrams: 350,
    nutrients: {
      calories: 450, proteins: 20, carbohydrates: 65, sugars: 4,
      fats: 12, saturatedFats: 2, fiber: 3, salt: 1.5, sodium: 600,
      transFats: 0, cholesterol: 80, potassium: 400,
      monounsaturatedFats: 6, polyunsaturatedFats: 3, alcohol: 0,
      referenceBasis: 'per_serving',
    },
    confidenceLevel: 'high',
    estimationMethod: 'official',
    source: { id: 'fd000000-0001-4000-a000-000000000099', name: 'Source', type: 'official', url: 'https://example.com' },
    similarityDistance: null,
  },
  cachedAt: null,
};

const VALID_TURN_STATE = {
  query: 'paella valenciana',
  chainSlug: null,
  estimation: VALID_ESTIMATE_DATA_WITH_RESULT,
  portionMultiplier: 1,
  storedAt: Date.now(),
};

describe('NutrientKeySchema (F-MULTITURN-001)', () => {
  it('accepts carbohydrates', () => {
    expect(NutrientKeySchema.safeParse('carbohydrates').success).toBe(true);
  });

  it('accepts all 15 nutrient keys', () => {
    const keys = [
      'calories', 'proteins', 'carbohydrates', 'sugars', 'fats',
      'saturatedFats', 'fiber', 'salt', 'sodium', 'transFats',
      'cholesterol', 'potassium', 'monounsaturatedFats', 'polyunsaturatedFats', 'alcohol',
    ];
    for (const key of keys) {
      expect(NutrientKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('rejects referenceBasis (excluded from nutrient keys)', () => {
    expect(NutrientKeySchema.safeParse('referenceBasis').success).toBe(false);
  });

  it('rejects unknown key', () => {
    expect(NutrientKeySchema.safeParse('unknownNutrient').success).toBe(false);
  });
});

describe('ConversationIntentSchema — new values (F-MULTITURN-001)', () => {
  it('accepts follow_up_attribute', () => {
    expect(ConversationIntentSchema.safeParse('follow_up_attribute').success).toBe(true);
  });

  it('accepts follow_up_refinement', () => {
    expect(ConversationIntentSchema.safeParse('follow_up_refinement').success).toBe(true);
  });

  it('accepts reverse_search (pre-existing value)', () => {
    expect(ConversationIntentSchema.safeParse('reverse_search').success).toBe(true);
  });
});

describe('ConversationTurnStateSchema (F-MULTITURN-001)', () => {
  it('parses valid turn state with non-null estimation result', () => {
    const result = ConversationTurnStateSchema.safeParse(VALID_TURN_STATE);
    expect(result.success).toBe(true);
  });

  it('parses valid turn state with estimation.result = null (R3-1 fix: estimation itself is NOT nullable)', () => {
    const nullResultTurnState = {
      ...VALID_TURN_STATE,
      estimation: {
        ...VALID_ESTIMATE_DATA_WITH_RESULT,
        result: null,
      },
    };
    const result = ConversationTurnStateSchema.safeParse(nullResultTurnState);
    expect(result.success).toBe(true);
  });

  it('rejects turn state with null estimation (estimation wrapper must NOT be null)', () => {
    const result = ConversationTurnStateSchema.safeParse({
      ...VALID_TURN_STATE,
      estimation: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier below 0.1', () => {
    const result = ConversationTurnStateSchema.safeParse({
      ...VALID_TURN_STATE,
      portionMultiplier: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it('rejects portionMultiplier above 5.0', () => {
    const result = ConversationTurnStateSchema.safeParse({
      ...VALID_TURN_STATE,
      portionMultiplier: 6,
    });
    expect(result.success).toBe(false);
  });

  it('requires chainSlug to be string or null', () => {
    const withSlug = ConversationTurnStateSchema.safeParse({
      ...VALID_TURN_STATE,
      chainSlug: 'mcdonalds-es',
    });
    expect(withSlug.success).toBe(true);

    const withNull = ConversationTurnStateSchema.safeParse({
      ...VALID_TURN_STATE,
      chainSlug: null,
    });
    expect(withNull.success).toBe(true);
  });
});

describe('FollowUpAttributeDataSchema (F-MULTITURN-001)', () => {
  it('parses valid attribute data', () => {
    const result = FollowUpAttributeDataSchema.safeParse({
      nutrientKey: 'carbohydrates',
      nutrientLabel: 'Carbohidratos',
      value: 45,
      unit: 'g',
      dishName: 'Paella valenciana',
      priorTurnQuery: 'paella valenciana',
      priorEstimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid nutrientKey', () => {
    const result = FollowUpAttributeDataSchema.safeParse({
      nutrientKey: 'referenceBasis',
      nutrientLabel: 'Ref',
      value: 1,
      unit: 'g',
      dishName: 'Paella',
      priorTurnQuery: 'paella valenciana',
      priorEstimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(false);
  });

  it('requires priorTurnQuery (Plan-R4 fix)', () => {
    const result = FollowUpAttributeDataSchema.safeParse({
      nutrientKey: 'calories',
      nutrientLabel: 'Calorías',
      value: 450,
      unit: 'kcal',
      dishName: 'Paella',
      // priorTurnQuery omitted
      priorEstimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative value', () => {
    const result = FollowUpAttributeDataSchema.safeParse({
      nutrientKey: 'calories',
      nutrientLabel: 'Calorías',
      value: -1,
      unit: 'kcal',
      dishName: 'Paella',
      priorTurnQuery: 'paella valenciana',
      priorEstimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(false);
  });
});

describe('FollowUpRefinementDataSchema (F-MULTITURN-001)', () => {
  it('parses valid refinement data', () => {
    const result = FollowUpRefinementDataSchema.safeParse({
      originalQuery: 'paella valenciana',
      mergedQuery: 'paella valenciana de pollo',
      estimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(true);
  });

  it('requires originalQuery', () => {
    const result = FollowUpRefinementDataSchema.safeParse({
      mergedQuery: 'paella valenciana de pollo',
      estimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(false);
  });

  it('requires mergedQuery', () => {
    const result = FollowUpRefinementDataSchema.safeParse({
      originalQuery: 'paella valenciana',
      estimation: VALID_ESTIMATE_DATA_WITH_RESULT,
    });
    expect(result.success).toBe(false);
  });
});

describe('FollowUpMetaSchema (F-MULTITURN-001)', () => {
  it('parses valid meta data', () => {
    const result = FollowUpMetaSchema.safeParse({
      classifierType: 'attribute',
      confidence: 0.95,
      turnStateHit: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown classifierType', () => {
    const result = FollowUpMetaSchema.safeParse({
      classifierType: 'unknown',
      confidence: 0.9,
      turnStateHit: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const result = FollowUpMetaSchema.safeParse({
      classifierType: 'refinement',
      confidence: 1.5,
      turnStateHit: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('ConversationMessageDataSchema — new optional fields (F-MULTITURN-001)', () => {
  it('parses estimation intent without new optional fields (backwards compat)', () => {
    const result = ConversationMessageDataSchema.safeParse({
      intent: 'estimation',
      actorId: 'fd000000-0001-4000-a000-000000000001',
      estimation: VALID_ESTIMATE_DATA,
      activeContext: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.followUpAttribute).toBeUndefined();
      expect(result.data.followUpRefinement).toBeUndefined();
      expect(result.data.followUpMeta).toBeUndefined();
    }
  });

  it('parses follow_up_attribute intent with followUpAttribute and followUpMeta', () => {
    const result = ConversationMessageDataSchema.safeParse({
      intent: 'follow_up_attribute',
      actorId: 'fd000000-0001-4000-a000-000000000001',
      activeContext: null,
      followUpAttribute: {
        nutrientKey: 'carbohydrates',
        nutrientLabel: 'Carbohidratos',
        value: 45,
        unit: 'g',
        dishName: 'Paella valenciana',
        priorTurnQuery: 'paella valenciana',
        priorEstimation: VALID_ESTIMATE_DATA_WITH_RESULT,
      },
      followUpMeta: {
        classifierType: 'attribute',
        confidence: 0.95,
        turnStateHit: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses follow_up_refinement intent with followUpRefinement and followUpMeta', () => {
    const result = ConversationMessageDataSchema.safeParse({
      intent: 'follow_up_refinement',
      actorId: 'fd000000-0001-4000-a000-000000000001',
      activeContext: null,
      followUpRefinement: {
        originalQuery: 'paella valenciana',
        mergedQuery: 'paella valenciana de pollo',
        estimation: VALID_ESTIMATE_DATA_WITH_RESULT,
      },
      followUpMeta: {
        classifierType: 'refinement',
        confidence: 0.85,
        turnStateHit: true,
      },
    });
    expect(result.success).toBe(true);
  });
});
