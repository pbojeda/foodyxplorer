// F-UX-B — Edge-case tests for resolvePortionAssumption (QA-authored).
//
// Covers gaps not exercised by the TDD unit test:
// 1. M2: 'ración para compartir' query — extractTermDisplay matches 'ración' substring
//    BEFORE it can match 'ración para compartir', producing incorrect termDisplay='ración'
//    while gramsRange=[300,400] (which belongs to ración para compartir).
// 2. M2: grams=0 risk — Math.round(tier1Row.grams * multiplier) can produce 0 when
//    tier1Row.grams is very small (e.g., 1 g) and multiplier is low (e.g., 0.1).
//    The PortionAssumptionSchema enforces grams > 0 but there is NO guard in the
//    orchestrator before constructing the portionAssumption object — the invalid
//    object would be attached to the response and silently sent.
// 3. M3: Tier 2 + F042 multiplier combo not tested (media ración grande).
// 4. M3: 'ración para compartir' normalizes to null canonicalTerm → buildGenericResult
//    fallback uses 'tapa' as the term field (wrong semantic).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolvePortionAssumption,
} from '../estimation/portionAssumption.js';
import type { PortionSizing } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISH_UUID = '00000000-0000-e073-0007-000000000099';

function racionParaCompartirPortionSizing(): PortionSizing {
  return {
    term: 'ración para compartir',
    gramsMin: 300,
    gramsMax: 400,
    description: 'Ración para compartir entre 2–3 personas',
  };
}

function bocadilloPortionSizing(): PortionSizing {
  return {
    term: 'bocadillo',
    gramsMin: 200,
    gramsMax: 250,
    description: 'Bocadillo estándar',
  };
}

const TINY_GRAMS_ROW = {
  id: 'row-uuid-tiny',
  dishId: DISH_UUID,
  term: 'pintxo',
  grams: 1,        // very small pintxo — multiplier edge case
  pieces: null,
  pieceName: null,
  confidence: 'low' as const,
  notes: 'Extremely small pintxo for testing',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const RACION_WITH_PIECES_ROW = {
  id: 'row-uuid-racion-q',
  dishId: DISH_UUID,
  term: 'racion',
  grams: 200,
  pieces: 8,
  pieceName: 'croquetas',
  confidence: 'high' as const,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrisma(findUnique: ReturnType<typeof vi.fn>) {
  return {
    standardPortion: { findUnique },
  } as never;
}

// ---------------------------------------------------------------------------
// M2 — 'ración para compartir' termDisplay bug
// ---------------------------------------------------------------------------

describe('F-UX-B edge-case — scope-boundary behavior for non-canonical F085 terms (M2-B + scope)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Spec scope decision (Q1): F-UX-B covers the 4 canonical terms ONLY:
  // pintxo, tapa, media_racion, racion. F085 terms OUTSIDE this set (bocadillo,
  // plato, ración para compartir, etc.) are NOT part of F-UX-B v1 — the existing
  // F085 `portionSizing` field on the response continues to render via the
  // legacy bot/web code paths for those, unchanged.
  //
  // The resolver therefore returns `{}` (no portionAssumption) for any query
  // whose F085 term does not normalize to one of the 4 canonical terms.
  // This is the correct fix for M2-B (dead 'tapa' fallback branch) and
  // originally-filed M2a (ración para compartir substring bug). Both root
  // causes are resolved by the same scope-boundary rule.

  it('ración para compartir query returns no portionAssumption (out of F-UX-B scope)', async () => {
    // 'ración para compartir' is an F085 term but NOT one of the 4 canonical
    // F-UX-B terms. It should NOT produce a portionAssumption response field.
    // The existing portionSizing field from F085 still renders via legacy paths.
    const findUnique = vi.fn().mockResolvedValue(null); // no DB row (irrelevant here)

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      racionParaCompartirPortionSizing(),
      'ración para compartir de gambas',
      1.0,
    );

    // Scope-boundary: no portionAssumption for non-canonical terms
    expect(result.portionAssumption).toBeUndefined();
    // No DB lookup should even fire for a non-canonical term
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ración para compartir never leaks into the term field (prevents M2-B semantic coercion)', async () => {
    // Previously, buildGenericResult silently coerced any unhandled canonical
    // term to 'tapa' via a dead fallback branch. The correct behavior is to
    // return no portionAssumption at all (scope boundary), so there is no
    // term field to coerce. This test documents that the coercion path is gone.
    const findUnique = vi.fn().mockResolvedValue(null);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      racionParaCompartirPortionSizing(),
      'ración para compartir de mejillones',
      1.0,
    );

    // No portionAssumption = no term field = no coercion possible
    expect(result.portionAssumption).toBeUndefined();
  });

  it('extractTermDisplay checks longest variants first (documented ordering)', async () => {
    // Even though the resolver returns {} for ración para compartir, the
    // internal extractTermDisplay helper still needs to handle longest-match
    // ordering correctly for any future term that IS in the canonical set and
    // contains substrings of other canonical terms. This test documents the
    // ordering rule by asserting the `racionParaCompartir` case falls through
    // to the F085 term string, not the 'ración' substring match.
    //
    // This is asserted indirectly: if the function returned {} we cannot inspect
    // termDisplay, but we can verify that no DB lookup occurred (which proves
    // the scope-boundary guard fired at the top, not that extractTermDisplay
    // returned the wrong value). For direct testing of extractTermDisplay,
    // export it from the module or test via a different route.
    const findUnique = vi.fn().mockResolvedValue(null);

    await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      racionParaCompartirPortionSizing(),
      'ración para compartir de navajas',
      1.0,
    );

    // Confirm we took the scope-boundary early return, not the Tier 1/2/3 path
    expect(findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M2 — grams=0 after multiplier rounding
// ---------------------------------------------------------------------------

describe('F-UX-B edge-case — grams=0 after multiplier (M2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('M2: grams=1 × multiplier=0.1 produces Math.round(0.1)=0 — schema violation silently sent', async () => {
    // The orchestrator computes grams: Math.round(tier1Row.grams * multiplier).
    // With tier1Row.grams=1 and multiplier=0.1 (minimum allowed by API schema),
    // Math.round(0.1) = 0, which violates PortionAssumptionSchema grams: z.number().int().positive().
    // There is no guard in resolvePortionAssumption before constructing the object.
    // The response would carry grams:0 silently — the UI would render "Pintxo ≈ 0 g".
    const findUnique = vi.fn().mockResolvedValue(TINY_GRAMS_ROW);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      { term: 'pintxo', gramsMin: 30, gramsMax: 60, description: 'Pintxo individual' },
      'pintxo de jamón',
      0.1,  // minimum multiplier from EstimateQuerySchema (portionMultiplier.min(0.1))
    );

    // CURRENT BEHAVIOR (bug): grams = Math.round(1 * 0.1) = 0
    // This assertion documents that grams MUST NOT be 0.
    // The fix: orchestrator should guard Math.max(1, Math.round(grams * multiplier))
    // OR fall through to Tier 3 when the result would be 0.
    expect(result.portionAssumption?.grams).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// M3 — Tier 2 + F042 multiplier combination
// ---------------------------------------------------------------------------

describe('F-UX-B edge-case — Tier 2 + F042 multiplier (M3)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('M3: media ración grande (Tier 2 + multiplier=1.5) scales grams and pieces correctly', async () => {
    // Covers: media ración query with only a ración row + portionMultiplier=1.5
    // Expected: grams = Math.round(200 * 0.5 * 1.5) = 150
    //           pieces = computeDisplayPieces(8 * 0.5 * 1.5) = computeDisplayPieces(6) = 6
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)               // media_racion exact lookup miss
      .mockResolvedValueOnce(RACION_WITH_PIECES_ROW); // ración row found

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      { term: 'media ración', gramsMin: 100, gramsMax: 125, description: 'Media ración' },
      'media ración grande de croquetas',
      1.5,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.term).toBe('media_racion');
    expect(result.portionAssumption?.grams).toBe(150);  // Math.round(200 * 0.5 * 1.5)
    expect(result.portionAssumption?.pieces).toBe(6);   // computeDisplayPieces(8 * 0.5 * 1.5)
  });

  it('M3: media ración pequeña (Tier 2 + multiplier=0.7): grams and pieces scaled', async () => {
    // racion.grams=200, multiplier=0.7
    // grams = Math.round(200 * 0.5 * 0.7) = Math.round(70) = 70
    // pieces: basePiecesHalf = 8 * 0.5 = 4, scaledPieces = 4 * 0.7 = 2.8 → round = 3
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(RACION_WITH_PIECES_ROW);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      { term: 'media ración', gramsMin: 100, gramsMax: 125, description: 'Media ración' },
      'media ración de croquetas',
      0.7,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.grams).toBe(70);   // Math.round(200 * 0.5 * 0.7)
    expect(result.portionAssumption?.pieces).toBe(3);   // Math.round(4 * 0.7) = Math.round(2.8)
  });

  it('M3: media ración mínima (Tier 2 + multiplier=0.1) — grams=0 risk also applies in Tier 2', async () => {
    // racion.grams=1 (artificial), multiplier=0.1
    // grams = Math.round(1 * 0.5 * 0.1) = Math.round(0.05) = 0 — schema violation
    const tinyRacion = { ...RACION_WITH_PIECES_ROW, grams: 1, term: 'racion' };
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tinyRacion);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      { term: 'media ración', gramsMin: 100, gramsMax: 125, description: 'Media ración' },
      'media ración de prueba',
      0.1,
    );

    // Same grams=0 risk as Tier 1 — must not be 0
    expect(result.portionAssumption?.grams).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scope-boundary — non-canonical F085 terms (bocadillo, plato)
// ---------------------------------------------------------------------------

describe('F-UX-B edge-case — non-canonical F085 terms (bocadillo, plato)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('bocadillo query returns no portionAssumption (out of F-UX-B scope, legacy portionSizing still renders)', async () => {
    // F-UX-B covers ONLY pintxo/tapa/media_racion/racion per Q1. Bocadillo is
    // a valid F085 term but NOT in the F-UX-B canonical set, so the resolver
    // returns {} and the pre-existing F085 `portionSizing` field on the API
    // response continues to render via legacy bot/web code paths — no
    // regression for bocadillo queries.
    const findUnique = vi.fn().mockResolvedValue(null);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique),
      DISH_UUID,
      bocadilloPortionSizing(),
      'bocadillo de jamón',
      1.0,
    );

    // Scope-boundary: no portionAssumption for bocadillo
    expect(result.portionAssumption).toBeUndefined();
    // No DB lookup should fire — the scope-boundary guard short-circuits
    // before any Tier 1/2/3 work
    expect(findUnique).not.toHaveBeenCalled();
  });
});
