// F-UX-B — Bot snapshot baseline (commit 7 of F-UX-B TDD order).
//
// PURPOSE: These snapshots are generated ONCE against the current (pre-F-UX-B)
// formatter output. After F-UX-B bot formatter changes (commit 8), the generic
// branch MUST remain byte-identical to this golden file.
//
// HOW TO REGENERATE (only when generic path intentionally changes):
//   npx vitest run packages/bot/src/formatters/__tests__/f-ux-b.generic-byte-identity.test.ts -u
//   Document the change in docs/project_notes/decisions.md.
//
// All 7 queries target un-seeded dishes (NOT in the priority-30 seed or using
// variants that guarantee Tier 3 generic). The EstimateData passed here has
// portionSizing (F085) present WITHOUT portionAssumption, representing the
// pre-F-UX-B state and the expected post-F-UX-B generic-path output.
//
// After commit 8 adds the F-UX-B formatter block:
//   - per_dish branch → NEW output (NOT tested here)
//   - generic branch → portionSizing still rendered (UNCHANGED from today)
//     because the guard `(!data.portionAssumption || data.portionAssumption.source === 'generic')`
//     allows the F085 block to render when portionAssumption is absent or generic.

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../estimateFormatter.js';
import type { EstimateData, PortionSizing } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Shared fixture factory
// ---------------------------------------------------------------------------

function baseNutrients() {
  return {
    calories: 250,
    proteins: 12,
    carbohydrates: 20,
    sugars: 2,
    fats: 12,
    saturatedFats: 3,
    fiber: 1,
    salt: 0.8,
    sodium: 320,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    referenceBasis: 'per_serving' as const,
  };
}

function makeGenericEstimateData(
  query: string,
  portionSizing: PortionSizing,
): EstimateData {
  return {
    query,
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: false,
    level2Hit: false,
    level3Hit: true,
    level4Hit: false,
    matchType: 'fts_food',
    cachedAt: null,
    result: {
      entityType: 'food',
      entityId: '00000000-0000-f-ux-b-4000-000000000001',
      name: 'Generic Food',
      nameEs: 'Plato genérico',
      restaurantId: null,
      chainSlug: null,
      portionGrams: null,
      nutrients: baseNutrients(),
      confidenceLevel: 'low' as const,
      estimationMethod: 'llm_estimated' as const,
      source: {
        id: '00000000-0000-f-ux-b-4000-000000000002',
        name: 'LLM',
        type: 'llm_generated' as const,
        url: null,
      },
      similarityDistance: null,
    },
    portionSizing,
  };
}

// ---------------------------------------------------------------------------
// F-UX-B generic snapshot suite
// All 7 queries target un-seeded dishes → portionSizing only, no portionAssumption
// ---------------------------------------------------------------------------

describe('F-UX-B — generic branch byte-identity (snapshot baseline, pre-formatter)', () => {
  it('1. tapa de paella — paella not in priority-30', () => {
    const data = makeGenericEstimateData('tapa de paella', {
      term: 'tapa',
      gramsMin: 50,
      gramsMax: 80,
      description: 'Tapa individual estándar',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('2. media ración de gambas al horno — "al horno" variant not seeded', () => {
    const data = makeGenericEstimateData('media ración de gambas al horno', {
      term: 'media ración',
      gramsMin: 100,
      gramsMax: 125,
      description: 'Media ración estándar española',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('3. ración de lentejas — lentejas not in priority-30', () => {
    const data = makeGenericEstimateData('ración de lentejas', {
      term: 'ración',
      gramsMin: 200,
      gramsMax: 250,
      description: 'Ración estándar española',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('4. tapa de solomillo — solomillo not in priority-30', () => {
    const data = makeGenericEstimateData('tapa de solomillo', {
      term: 'tapa',
      gramsMin: 50,
      gramsMax: 80,
      description: 'Tapa individual estándar',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('5. pintxo de txipiron — unambiguous un-seeded Basque spelling', () => {
    const data = makeGenericEstimateData('pintxo de txipiron', {
      term: 'pintxo',
      gramsMin: 30,
      gramsMax: 60,
      description: 'Pintxo / pincho individual',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('6. ración de cocido — cocido not in priority-30', () => {
    const data = makeGenericEstimateData('ración de cocido', {
      term: 'ración',
      gramsMin: 200,
      gramsMax: 250,
      description: 'Ración estándar española',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });

  it('7. tapa de manchego curado — "curado" variant not seeded', () => {
    const data = makeGenericEstimateData('tapa de manchego curado', {
      term: 'tapa',
      gramsMin: 50,
      gramsMax: 80,
      description: 'Tapa individual estándar',
    });
    expect(formatEstimate(data)).toMatchSnapshot();
  });
});
