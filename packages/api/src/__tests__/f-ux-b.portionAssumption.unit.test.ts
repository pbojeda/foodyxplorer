// F-UX-B — Unit tests for resolvePortionAssumption + determineFallbackReason
//
// Uses mocked Prisma. Covers:
// - Tier 1: exact DB lookup hit (per_dish, with and without pieces)
// - Tier 2: media_racion arithmetic from ración row
// - Tier 2 non-rule: tapa query + ración row → Tier 3 (tier2_rejected_tapa)
// - Tier 2 non-rule: pintxo query + ración row → Tier 3 (tier2_rejected_pintxo)
// - Tier 3: no row exists (no_row)
// - computeDisplayPieces boundary cases (already tested in portionUtils.test.ts — reused here as integration)
// - determineFallbackReason 3 paths
// - low-multiplier fall-through: pieces dropped when basePieces × multiplier < 0.75
// - absence of portionAssumption when dishId is null (food-level entity)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePortionAssumption, determineFallbackReason } from '../estimation/portionAssumption';
import type { PortionSizing } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISH_UUID = '00000000-0000-e073-0007-00000000001a';

function tapaPortionSizing(): PortionSizing {
  return { term: 'tapa', gramsMin: 50, gramsMax: 80, description: 'Tapa individual estándar' };
}

function racionPortionSizing(): PortionSizing {
  return { term: 'ración', gramsMin: 200, gramsMax: 250, description: 'Ración estándar española' };
}

function mediaRacionPortionSizing(): PortionSizing {
  return { term: 'media ración', gramsMin: 100, gramsMax: 125, description: 'Media ración estándar española' };
}

function pintxoPortionSizing(): PortionSizing {
  return { term: 'pintxo', gramsMin: 30, gramsMax: 60, description: 'Pintxo / pincho individual' };
}

// StandardPortion DB row shapes
const TAPA_ROW = {
  id: 'row-uuid-tapa',
  dishId: DISH_UUID,
  term: 'tapa',
  grams: 50,
  pieces: 2,
  pieceName: 'croquetas',
  confidence: 'high' as const,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const RACION_ROW = {
  id: 'row-uuid-racion',
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

const RACION_NO_PIECES_ROW = {
  ...RACION_ROW,
  pieces: null,
  pieceName: null,
};

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function makePrisma(findUnique: ReturnType<typeof vi.fn>) {
  return {
    standardPortion: { findUnique },
  } as never;
}

// ---------------------------------------------------------------------------
// determineFallbackReason
// ---------------------------------------------------------------------------

describe('determineFallbackReason', () => {
  it('returns "no_row" when no ración row exists for the dish', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await determineFallbackReason(makePrisma(findUnique), DISH_UUID, 'tapa');
    expect(result).toBe('no_row');
    expect(findUnique).toHaveBeenCalledWith({
      where: { dishId_term: { dishId: DISH_UUID, term: 'racion' } },
    });
  });

  it('returns "tier2_rejected_tapa" when a ración row exists and query term is tapa', async () => {
    const findUnique = vi.fn().mockResolvedValue(RACION_ROW);
    const result = await determineFallbackReason(makePrisma(findUnique), DISH_UUID, 'tapa');
    expect(result).toBe('tier2_rejected_tapa');
  });

  it('returns "tier2_rejected_pintxo" when a ración row exists and query term is pintxo', async () => {
    const findUnique = vi.fn().mockResolvedValue(RACION_ROW);
    const result = await determineFallbackReason(makePrisma(findUnique), DISH_UUID, 'pintxo');
    expect(result).toBe('tier2_rejected_pintxo');
  });
});

// ---------------------------------------------------------------------------
// resolvePortionAssumption — Tier 1
// ---------------------------------------------------------------------------

describe('resolvePortionAssumption — Tier 1 (exact DB lookup)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Tier 1: returns per_dish when exact (dishId, term) row exists', async () => {
    const findUnique = vi.fn().mockResolvedValue(TAPA_ROW);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'tapa de croquetas', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.term).toBe('tapa');
    expect(result.portionAssumption?.grams).toBe(50);
    expect(result.portionAssumption?.pieces).toBe(2);
    expect(result.portionAssumption?.pieceName).toBe('croquetas');
    expect(result.portionAssumption?.confidence).toBe('high');
    expect(result.portionAssumption?.fallbackReason).toBeNull();
    expect(result.portionAssumption?.termDisplay).toBe('tapa');
  });

  it('Tier 1 with multiplier 1.5: scales grams and pieces correctly', async () => {
    const findUnique = vi.fn().mockResolvedValue(TAPA_ROW);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'ración grande de croquetas', 1.5,
    );

    expect(result.portionAssumption?.grams).toBe(75); // 50 * 1.5
    expect(result.portionAssumption?.pieces).toBe(3); // round(2 * 1.5) = 3
  });

  it('Tier 1 low-multiplier fall-through: multiplier=0.3, basePieces=2 → pieces dropped', async () => {
    const findUnique = vi.fn().mockResolvedValue(TAPA_ROW);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'tapa de croquetas', 0.3,
    );

    expect(result.portionAssumption?.pieces).toBeNull(); // 2 * 0.3 = 0.6 < 0.75 → fall-through
    expect(result.portionAssumption?.pieceName).toBeNull();
    expect(result.portionAssumption?.grams).toBe(15); // round(50 * 0.3)
  });

  it('Tier 1 multiplier=0.4, basePieces=2: scaledPieces=0.8 >= 0.75 → pieces=1', async () => {
    const findUnique = vi.fn().mockResolvedValue(TAPA_ROW);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'tapa de croquetas', 0.4,
    );

    expect(result.portionAssumption?.pieces).toBe(1); // round(2 * 0.4) = round(0.8) = 1
  });
});

// ---------------------------------------------------------------------------
// resolvePortionAssumption — Tier 2
// ---------------------------------------------------------------------------

describe('resolvePortionAssumption — Tier 2 (media_racion arithmetic)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Tier 2: media_racion + ración row → derived per_dish (grams = ración * 0.5)', async () => {
    // First call (media_racion lookup) → null; second call (ración lookup) → RACION_ROW
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)    // media_racion exact lookup miss
      .mockResolvedValueOnce(RACION_ROW); // ración row found

    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, mediaRacionPortionSizing(), 'media ración de croquetas', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('per_dish');
    expect(result.portionAssumption?.term).toBe('media_racion');
    expect(result.portionAssumption?.grams).toBe(100); // round(200 * 0.5)
    expect(result.portionAssumption?.pieces).toBe(4);  // round(8 * 0.5)
    expect(result.portionAssumption?.pieceName).toBe('croquetas');
    expect(result.portionAssumption?.fallbackReason).toBeNull();
  });

  it('Tier 2 with pieces=null ración row: media_racion inherits pieces=null', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(RACION_NO_PIECES_ROW);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, mediaRacionPortionSizing(), 'media ración de gazpacho', 1.0,
    );

    expect(result.portionAssumption?.pieces).toBeNull();
    expect(result.portionAssumption?.pieceName).toBeNull();
  });

  it('Tier 2 non-rule: tapa query + ración row → Tier 3 (tier2_rejected_tapa)', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)   // tapa exact lookup miss
      .mockResolvedValueOnce(RACION_ROW); // ración row exists (but Tier 2 doesn't apply for tapa)

    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'tapa de croquetas', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.fallbackReason).toBe('tier2_rejected_tapa');
  });

  it('Tier 2 non-rule: pintxo query + ración row → Tier 3 (tier2_rejected_pintxo)', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)   // pintxo exact lookup miss
      .mockResolvedValueOnce(RACION_ROW);

    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, pintxoPortionSizing(), 'pintxo de croquetas', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.fallbackReason).toBe('tier2_rejected_pintxo');
  });
});

// ---------------------------------------------------------------------------
// resolvePortionAssumption — Tier 3
// ---------------------------------------------------------------------------

describe('resolvePortionAssumption — Tier 3 (F085 generic fallback)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Tier 3: no row exists → generic with F085 range', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, tapaPortionSizing(), 'tapa de paella', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.gramsRange).toEqual([50, 80]);
    expect(result.portionAssumption?.grams).toBe(65); // round((50+80)/2)
    expect(result.portionAssumption?.pieces).toBeNull();
    expect(result.portionAssumption?.confidence).toBeNull();
    expect(result.portionAssumption?.fallbackReason).toBe('no_row');
  });

  it('Tier 3: ración query with no rows → generic (no_row)', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, racionPortionSizing(), 'ración de lentejas', 1.0,
    );

    expect(result.portionAssumption?.source).toBe('generic');
    expect(result.portionAssumption?.fallbackReason).toBe('no_row');
    expect(result.portionAssumption?.gramsRange).toEqual([200, 250]);
    expect(result.portionAssumption?.grams).toBe(225); // round((200+250)/2)
  });
});

// ---------------------------------------------------------------------------
// resolvePortionAssumption — null inputs
// ---------------------------------------------------------------------------

describe('resolvePortionAssumption — null inputs', () => {
  it('returns empty object when dishId is null (food-level entity)', async () => {
    const findUnique = vi.fn();
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), null, tapaPortionSizing(), 'tapa de paella', 1.0,
    );
    expect(result).toEqual({});
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns empty object when detectedTerm is null (no portion term in query)', async () => {
    const findUnique = vi.fn();
    const result = await resolvePortionAssumption(
      makePrisma(findUnique), DISH_UUID, null, 'croquetas', 1.0,
    );
    expect(result).toEqual({});
    expect(findUnique).not.toHaveBeenCalled();
  });
});
