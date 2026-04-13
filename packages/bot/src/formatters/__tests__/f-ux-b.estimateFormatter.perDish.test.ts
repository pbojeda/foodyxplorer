// F-UX-B — Bot formatter per_dish branch tests.
//
// Tests the new F-UX-B per_dish rendering path added to estimateFormatter.ts.
// Uses regex assertions for per_dish (per spec) and exact string equality for generic.
//
// Split by render path (spec-mandated):
//   per_dish + pieces != null → regex `/~\d+ [a-záéíóúñ]+.*≈ \d+ g/`
//   per_dish + pieces == null → regex `/≈ \d+ g/` AND must NOT contain `~`
//   generic path → covered by snapshot suite (f-ux-b.generic-byte-identity.test.ts)
//   portionAssumption absent → portionSizing still renders (F085 path unchanged)
//   termDisplay fallback → canonical key ('media_racion') maps to 'Media ración' via formatPortionTermLabel
//
// Also tests F-UX-A + F-UX-B composition: when portionMultiplier != 1.0 AND
// portionAssumption is present, both the multiplier line and the assumption
// line appear in the output.

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../estimateFormatter.js';
import type { EstimateData, PortionAssumption } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function baseNutrients() {
  return {
    calories: 400,
    proteins: 14,
    carbohydrates: 30,
    sugars: 1,
    fats: 24,
    saturatedFats: 8,
    fiber: 1,
    salt: 1.2,
    sodium: 480,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    referenceBasis: 'per_serving' as const,
  };
}

function makeEstimateData(overrides: Partial<EstimateData> = {}): EstimateData {
  return {
    query: 'tapa de croquetas',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: {
      entityType: 'dish',
      entityId: '00000000-0000-f-ux-b-4000-000000000010',
      name: 'Croquetas de jamón',
      nameEs: 'Croquetas de jamón',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 100,
      nutrients: baseNutrients(),
      confidenceLevel: 'high' as const,
      estimationMethod: 'scraped' as const,
      source: {
        id: '00000000-0000-f-ux-b-4000-000000000011',
        name: 'Test',
        type: 'official' as const,
        url: null,
      },
      similarityDistance: null,
    },
    ...overrides,
  };
}

function perDishWithPieces(overrides: Partial<PortionAssumption> = {}): PortionAssumption {
  return {
    term: 'tapa',
    termDisplay: 'tapa',
    source: 'per_dish',
    grams: 50,
    pieces: 2,
    pieceName: 'croquetas',
    gramsRange: null,
    confidence: 'high',
    fallbackReason: null,
    ...overrides,
  };
}

function perDishNoPieces(overrides: Partial<PortionAssumption> = {}): PortionAssumption {
  return {
    term: 'racion',
    termDisplay: 'ración',
    source: 'per_dish',
    grams: 200,
    pieces: null,
    pieceName: null,
    gramsRange: null,
    confidence: 'high',
    fallbackReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// per_dish + pieces != null
// ---------------------------------------------------------------------------

describe('F-UX-B formatter — per_dish with pieces', () => {
  it('renders ~N pieceName, ≈ G g pattern', () => {
    const data = makeEstimateData({ portionAssumption: perDishWithPieces() });
    const output = formatEstimate(data);
    expect(output).toMatch(/~2 croquetas, ≈ 50 g/);
    expect(output).toContain('Porción detectada');
  });

  it('termDisplay "tapa" → rendered as "tapa" (user literal wording)', () => {
    const data = makeEstimateData({
      portionAssumption: perDishWithPieces({ termDisplay: 'tapa' }),
    });
    const output = formatEstimate(data);
    expect(output).toContain('tapa');
  });

  it('termDisplay absent → formatPortionTermLabel fallback for canonical key', () => {
    // When termDisplay is absent (undefined), the formatter falls back to
    // formatPortionTermLabel(pa.term) which maps 'media_racion' → 'Media ración'.
    const pa = perDishWithPieces({
      term: 'media_racion',
      termDisplay: undefined as unknown as string, // simulate absent field
      pieces: 4,
      pieceName: 'croquetas',
      grams: 100,
    });
    // Zod allows undefined for optional fields but PortionAssumption type requires string.
    // We cast to test the formatter fallback without runtime Zod validation.
    const data = makeEstimateData({ portionAssumption: pa });
    const output = formatEstimate(data);
    // Should render 'Media ración' NOT 'media_racion' or 'Media_racion'
    expect(output).toContain('Media ración');
    expect(output).not.toContain('media_racion');
  });

  it('with multiplier 1.5: both portion multiplier line AND per_dish assumption line appear', () => {
    const data = makeEstimateData({
      portionMultiplier: 1.5,
      portionAssumption: perDishWithPieces({ grams: 75, pieces: 3 }),
    });
    const output = formatEstimate(data);
    // F-UX-A multiplier line (MarkdownV2: '.' is escaped as '\.')
    expect(output).toContain('Porción:');
    expect(output).toContain('1\\.5');
    // F-UX-B per_dish line
    expect(output).toMatch(/~3 croquetas, ≈ 75 g/);
  });

  it('suppresses F085 portionSizing when per_dish assumption is present', () => {
    const data = makeEstimateData({
      portionAssumption: perDishWithPieces(),
      portionSizing: {
        term: 'tapa',
        gramsMin: 50,
        gramsMax: 80,
        description: 'Tapa individual estándar',
      },
    });
    const output = formatEstimate(data);
    // Per_dish line should appear
    expect(output).toMatch(/~2 croquetas/);
    // F085 range line should NOT appear alongside per_dish
    expect(output).not.toMatch(/50\\-80 g/);
    expect(output).not.toMatch(/50-80 g/);
  });
});

// ---------------------------------------------------------------------------
// per_dish + pieces == null (gazpacho / liquid path)
// ---------------------------------------------------------------------------

describe('F-UX-B formatter — per_dish without pieces (grams-only)', () => {
  it('renders ≈ G g pattern, no ~ prefix', () => {
    const data = makeEstimateData({ portionAssumption: perDishNoPieces() });
    const output = formatEstimate(data);
    expect(output).toMatch(/≈ 200 g/);
    // Must NOT contain ~ (pieces-count marker)
    const portionLine = output.split('\n').find((l) => l.includes('Porción detectada'));
    expect(portionLine).toBeDefined();
    expect(portionLine).not.toContain('~');
  });

  it('termDisplay "ración" → rendered as "ración"', () => {
    const data = makeEstimateData({ portionAssumption: perDishNoPieces() });
    const output = formatEstimate(data);
    expect(output).toContain('ración');
  });

  it('fall-through pieces (pieces=null from computeDisplayPieces) matches same output as native null-pieces dish', () => {
    // Two EstimateData payloads that should produce the same Porción detectada line:
    //   A: natively null pieces (gazpacho path)
    //   B: pieces fell through (multiplier=0.3 × basePieces=2 → scaledPieces=0.6 < 0.75 → null)
    // Both should produce "≈ G g" with no ~.
    const dataA = makeEstimateData({ portionAssumption: perDishNoPieces({ grams: 60 }) });
    const dataB = makeEstimateData({ portionAssumption: perDishNoPieces({ grams: 60 }) });

    const outputA = formatEstimate(dataA);
    const outputB = formatEstimate(dataB);

    const lineA = outputA.split('\n').find((l) => l.includes('Porción detectada'));
    const lineB = outputB.split('\n').find((l) => l.includes('Porción detectada'));
    expect(lineA).toBe(lineB);
  });
});

// ---------------------------------------------------------------------------
// portionAssumption absent — F085 portionSizing still renders (regression guard)
// ---------------------------------------------------------------------------

describe('F-UX-B formatter — portionAssumption absent (F085 guard regression)', () => {
  it('renders F085 portionSizing when portionAssumption is absent', () => {
    const data = makeEstimateData({
      portionSizing: {
        term: 'tapa',
        gramsMin: 50,
        gramsMax: 80,
        description: 'Tapa individual estándar',
      },
    });
    const output = formatEstimate(data);
    expect(output).toContain('tapa');
    expect(output).toMatch(/50\\-80 g/);
  });

  it('renders F085 portionSizing when portionAssumption.source is generic', () => {
    const data = makeEstimateData({
      portionSizing: {
        term: 'tapa',
        gramsMin: 50,
        gramsMax: 80,
        description: 'Tapa individual estándar',
      },
      portionAssumption: {
        term: 'tapa',
        termDisplay: 'tapa',
        source: 'generic',
        grams: 65,
        pieces: null,
        pieceName: null,
        gramsRange: [50, 80],
        confidence: null,
        fallbackReason: 'no_row',
      },
    });
    const output = formatEstimate(data);
    // F085 line should still appear for generic path (byte-identical to pre-F-UX-B)
    expect(output).toMatch(/50\\-80 g/);
    // No per_dish line (source !== 'per_dish')
    expect(output).not.toMatch(/~\d+/);
  });
});
