// Unit tests for followUpClassifier.ts (F-MULTITURN-001, Step 3)
//
// Covers AC-01 (detectAttributeFollowUp), AC-02 (detectRefinementFollowUp),
// AC-03 (pure/sync), AC-07 (applyRefinement — all 4 branches), AC-14 (NUTRIENT_ALIASES).
// No Redis, no DB — pure classifier functions.

import { describe, it, expect } from 'vitest';
import {
  detectAttributeFollowUp,
  detectRefinementFollowUp,
  applyRefinement,
  ATTRIBUTE_CONFIDENCE_THRESHOLD,
  REFINEMENT_CONFIDENCE_THRESHOLD,
  NUTRIENT_ALIASES,
} from '../conversation/followUpClassifier.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ATTRIBUTE_CONFIDENCE_THRESHOLD', () => {
  it('equals 0.75', () => {
    expect(ATTRIBUTE_CONFIDENCE_THRESHOLD).toBe(0.75);
  });
});

describe('REFINEMENT_CONFIDENCE_THRESHOLD', () => {
  it('equals 0.70', () => {
    expect(REFINEMENT_CONFIDENCE_THRESHOLD).toBe(0.70);
  });
});

// ---------------------------------------------------------------------------
// AC-03: pure / synchronous (no async, no I/O)
// ---------------------------------------------------------------------------

describe('AC-03: pure / synchronous', () => {
  it('detectAttributeFollowUp returns synchronously without async', () => {
    const result = detectAttributeFollowUp('y los carbs?');
    // Must be a plain value (not a Promise)
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('detectRefinementFollowUp returns synchronously', () => {
    const result = detectRefinementFollowUp('hazlo de pollo en vez de cerdo');
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('applyRefinement returns synchronously', () => {
    const result = applyRefinement('paella valenciana', 'de pollo en vez de cerdo');
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// AC-01: detectAttributeFollowUp — positive cases
// ---------------------------------------------------------------------------

describe('detectAttributeFollowUp — positive cases (AC-01)', () => {
  it('"y los carbs?" → carbohydrates', () => {
    const result = detectAttributeFollowUp('y los carbs?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('carbohydrates');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"y la proteína?" → proteins', () => {
    const result = detectAttributeFollowUp('y la proteína?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('proteins');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"cuánta fibra tiene?" → fiber', () => {
    const result = detectAttributeFollowUp('cuánta fibra tiene?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('fiber');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"y la sal?" → salt', () => {
    const result = detectAttributeFollowUp('y la sal?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('salt');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"dame las grasas" → fats', () => {
    const result = detectAttributeFollowUp('dame las grasas');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('fats');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"y las calorías?" → calories', () => {
    const result = detectAttributeFollowUp('y las calorías?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('calories');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"cuánto sodio tiene?" → sodium', () => {
    const result = detectAttributeFollowUp('cuánto sodio tiene?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('sodium');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"y el colesterol?" → cholesterol', () => {
    const result = detectAttributeFollowUp('y el colesterol?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('cholesterol');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"y el potasio?" → potassium', () => {
    const result = detectAttributeFollowUp('y el potasio?');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('potassium');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });

  it('"dime los hidratos" → carbohydrates', () => {
    const result = detectAttributeFollowUp('dime los hidratos');
    expect(result).not.toBeNull();
    expect(result!['nutrientKey']).toBe('carbohydrates');
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.75);
  });
});

// ---------------------------------------------------------------------------
// AC-01: detectAttributeFollowUp — negative cases (standalone queries)
// ---------------------------------------------------------------------------

describe('detectAttributeFollowUp — negative cases (AC-01)', () => {
  it('"paella valenciana" → null (standalone query)', () => {
    expect(detectAttributeFollowUp('paella valenciana')).toBeNull();
  });

  it('"big mac" → null', () => {
    expect(detectAttributeFollowUp('big mac')).toBeNull();
  });

  it('"estoy en mcdonalds" → null (context-set, not follow-up)', () => {
    expect(detectAttributeFollowUp('estoy en mcdonalds')).toBeNull();
  });

  it('"hazlo de pollo" → null (refinement, not attribute)', () => {
    expect(detectAttributeFollowUp('hazlo de pollo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-14: NUTRIENT_ALIASES — all alias groups resolve to correct nutrientKey
// ---------------------------------------------------------------------------

describe('AC-14: NUTRIENT_ALIASES alias groups', () => {
  const aliasTestCases: Array<[string, string]> = [
    // calories group
    ['calorías', 'calories'],
    ['kcal', 'calories'],
    ['cal', 'calories'],
    ['energía', 'calories'],
    // proteins group
    ['proteínas', 'proteins'],
    ['proteína', 'proteins'],
    ['prot', 'proteins'],
    // carbohydrates group
    ['carbohidratos', 'carbohydrates'],
    ['hidratos', 'carbohydrates'],
    ['carbs', 'carbohydrates'],
    ['hc', 'carbohydrates'],
    // sugars group
    ['azúcar', 'sugars'],
    ['azúcares', 'sugars'],
    // fats group
    ['grasas', 'fats'],
    ['grasa', 'fats'],
    // fiber
    ['fibra', 'fiber'],
    // salt
    ['sal', 'salt'],
    // sodium
    ['sodio', 'sodium'],
    // cholesterol
    ['colesterol', 'cholesterol'],
    // potassium
    ['potasio', 'potassium'],
  ];

  for (const [alias, expectedKey] of aliasTestCases) {
    it(`alias "${alias}" → nutrientKey "${expectedKey}"`, () => {
      const meta = NUTRIENT_ALIASES[alias];
      expect(meta).toBeDefined();
      expect(meta!['nutrientKey']).toBe(expectedKey);
    });
  }

  it('NUTRIENT_ALIASES is a flat alias-to-metadata Record (O(1) lookup)', () => {
    expect(typeof NUTRIENT_ALIASES).toBe('object');
    // Each value should have nutrientKey, label, unit
    for (const [, meta] of Object.entries(NUTRIENT_ALIASES)) {
      expect(meta).toHaveProperty('nutrientKey');
      expect(meta).toHaveProperty('label');
      expect(meta).toHaveProperty('unit');
    }
  });
});

// AC-14: verify detectAttributeFollowUp resolves all alias groups
describe('AC-14: detectAttributeFollowUp resolves all alias groups via patterns', () => {
  const detectAliasTestCases: Array<[string, string]> = [
    ['y las calorías?', 'calories'],
    ['y el kcal?', 'calories'],
    ['y las proteínas?', 'proteins'],
    ['y el prot?', 'proteins'],
    ['y los carbohidratos?', 'carbohydrates'],
    ['y los hidratos?', 'carbohydrates'],
    ['y los carbs?', 'carbohydrates'],
    ['y el hc?', 'carbohydrates'],
    ['y el azúcar?', 'sugars'],
    ['y las grasas?', 'fats'],
    ['y la fibra?', 'fiber'],
    ['y la sal?', 'salt'],
    ['y el sodio?', 'sodium'],
  ];

  for (const [text, expectedKey] of detectAliasTestCases) {
    it(`"${text}" → ${expectedKey}`, () => {
      const result = detectAttributeFollowUp(text);
      expect(result).not.toBeNull();
      expect(result!['nutrientKey']).toBe(expectedKey);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-02: detectRefinementFollowUp — positive cases
// ---------------------------------------------------------------------------

describe('detectRefinementFollowUp — positive cases (AC-02)', () => {
  it('"hazlo de pollo en vez de cerdo" → detects refinement', () => {
    const result = detectRefinementFollowUp('hazlo de pollo en vez de cerdo');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"menos cantidad" → detects refinement', () => {
    const result = detectRefinementFollowUp('menos cantidad');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"sin azúcar" → detects refinement', () => {
    const result = detectRefinementFollowUp('sin azúcar');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"una ración pequeña" → detects refinement', () => {
    const result = detectRefinementFollowUp('una ración pequeña');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"más cantidad" → detects refinement', () => {
    const result = detectRefinementFollowUp('más cantidad');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"sin sal" → detects refinement', () => {
    const result = detectRefinementFollowUp('sin sal');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });

  it('"ponlo de ternera" → detects refinement', () => {
    const result = detectRefinementFollowUp('ponlo de ternera');
    expect(result).not.toBeNull();
    expect(result!['confidence']).toBeGreaterThanOrEqual(0.70);
  });
});

// ---------------------------------------------------------------------------
// AC-02: detectRefinementFollowUp — negative cases
// ---------------------------------------------------------------------------

describe('detectRefinementFollowUp — negative cases (AC-02)', () => {
  it('"y los carbs?" → null (attribute follow-up, not refinement)', () => {
    expect(detectRefinementFollowUp('y los carbs?')).toBeNull();
  });

  it('"paella valenciana" → null (standalone query)', () => {
    expect(detectRefinementFollowUp('paella valenciana')).toBeNull();
  });

  it('"big mac" → null', () => {
    expect(detectRefinementFollowUp('big mac')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-07: applyRefinement — 4-branch decision tree
// ---------------------------------------------------------------------------

describe('applyRefinement — 4-branch decision tree (AC-07)', () => {
  // Branch 1 — APPEND-AFTER-STRIP: "de X en vez de Y" where Y NOT in originalQuery
  it('Branch 1 append-after-strip: ("paella valenciana", "de pollo en vez de cerdo") → "paella valenciana de pollo"', () => {
    const result = applyRefinement('paella valenciana', 'de pollo en vez de cerdo');
    expect(result.mergedQuery).toBe('paella valenciana de pollo');
    expect(result.portionMultiplierOverride).toBeUndefined();
  });

  // Branch 1 — REPLACE: "de X en vez de Y" where Y IS in originalQuery (Plan-R1 fix)
  it('Branch 1 REPLACE: ("lomo de cerdo", "de pollo en vez de cerdo") → "lomo de pollo"', () => {
    const result = applyRefinement('lomo de cerdo', 'de pollo en vez de cerdo');
    expect(result.mergedQuery).toBe('lomo de pollo');
    expect(result.portionMultiplierOverride).toBeUndefined();
  });

  // Branch 2 — Portion-only: "menos cantidad"
  it('Branch 2 portion-only: ("paella valenciana", "menos cantidad") → { mergedQuery: "paella valenciana", portionMultiplierOverride: 0.5 }', () => {
    const result = applyRefinement('paella valenciana', 'menos cantidad');
    expect(result.mergedQuery).toBe('paella valenciana');
    expect(result.portionMultiplierOverride).toBe(0.5);
  });

  // Branch 2 — Portion-only: "una ración pequeña"
  it('Branch 2 portion-only: ("paella valenciana", "una ración pequeña") → { mergedQuery: "paella valenciana", portionMultiplierOverride: 0.7 }', () => {
    const result = applyRefinement('paella valenciana', 'una ración pequeña');
    expect(result.mergedQuery).toBe('paella valenciana');
    expect(result.portionMultiplierOverride).toBe(0.7);
  });

  // Branch 2 — Portion-only: "más cantidad"
  it('Branch 2 portion-only: ("paella valenciana", "más cantidad") → portionMultiplierOverride: 1.5', () => {
    const result = applyRefinement('paella valenciana', 'más cantidad');
    expect(result.mergedQuery).toBe('paella valenciana');
    expect(result.portionMultiplierOverride).toBe(1.5);
  });

  // Branch 3 — sin X → APPEND
  it('Branch 3 sin: ("paella valenciana", "sin azúcar") → "paella valenciana sin azúcar"', () => {
    const result = applyRefinement('paella valenciana', 'sin azúcar');
    expect(result.mergedQuery).toBe('paella valenciana sin azúcar');
    expect(result.portionMultiplierOverride).toBeUndefined();
  });

  // Branch 4 — default APPEND
  it('Branch 4 default append: ("solomillo", "de pollo") → "solomillo de pollo"', () => {
    const result = applyRefinement('solomillo', 'de pollo');
    expect(result.mergedQuery).toBe('solomillo de pollo');
    expect(result.portionMultiplierOverride).toBeUndefined();
  });
});
