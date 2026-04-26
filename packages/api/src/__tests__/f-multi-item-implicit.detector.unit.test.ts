// F-MULTI-ITEM-IMPLICIT — Unit tests for detectImplicitMultiItem, splitOnCommasThenYRecursive,
// normalizeFragment (no real DB — level1Lookup is mocked).
//
// ADR-021: Unit tests mock all external dependencies.
// Vitest globals NOT enabled — import everything explicitly.
//
// Mock pattern (f034.edge-cases.test.ts:12-100 + f076.menuAggregation.unit.test.ts:5-50):
//   1. import vi from 'vitest' FIRST
//   2. optional vi.hoisted() for shared symbols
//   3. vi.mock() BEFORE module-under-test import
//   4. import module under test

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Level1Result } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Mock level1Lookup — must be declared BEFORE the module-under-test import
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn<Parameters<typeof import('../estimation/level1Lookup.js')['level1Lookup']>, ReturnType<typeof import('../estimation/level1Lookup.js')['level1Lookup']>>(),
}));

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER vi.mock)
// ---------------------------------------------------------------------------

import {
  detectImplicitMultiItem,
  splitOnCommasThenYRecursive,
  normalizeFragment,
} from '../conversation/implicitMultiItemDetector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(): Level1Result {
  return {
    matchType: 'exact_dish',
    result: {
      query: 'mock',
      nameEs: null,
      dishId: 'fb000000-00fb-4000-a000-000000000001',
      dataSourceId: null,
      chainSlug: null,
      restaurantId: null,
      level: 1,
      calories: 100,
      proteins: 5,
      carbohydrates: 20,
      sugars: 5,
      fats: 3,
      saturatedFats: 1,
      fiber: 2,
      salt: 0.5,
      sodium: 200,
      transFats: 0,
      cholesterol: 20,
      potassium: 100,
      monounsaturatedFats: 1,
      polyunsaturatedFats: 0.5,
      alcohol: 0,
      referenceBasis: 'per_100g',
      portionGrams: null,
      portionMl: null,
      estimationMethod: null,
    },
  };
}

// Minimal Kysely-like db mock (Guard 0 test needs a truthy db value)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional test double for Guard 0
const mockDb = {} as any;

// ---------------------------------------------------------------------------
// Phase 1 — Helpers: splitOnCommasThenYRecursive
// ---------------------------------------------------------------------------

describe('splitOnCommasThenYRecursive', () => {
  it('comma + y: "paella, vino y flan" → ["paella", "vino", "flan"]', () => {
    expect(splitOnCommasThenYRecursive('paella, vino y flan')).toEqual(['paella', 'vino', 'flan']);
  });

  it('y-only recursive: "paella y vino y flan" → ["paella", "vino", "flan"]', () => {
    expect(splitOnCommasThenYRecursive('paella y vino y flan')).toEqual(['paella', 'vino', 'flan']);
  });

  it('single term: "paella" → ["paella"]', () => {
    expect(splitOnCommasThenYRecursive('paella')).toEqual(['paella']);
  });

  it('double y same fragment: "a y b y c" → ["a", "b", "c"]', () => {
    expect(splitOnCommasThenYRecursive('a y b y c')).toEqual(['a', 'b', 'c']);
  });

  it('comma-only: "paella, vino" → ["paella", "vino"]', () => {
    expect(splitOnCommasThenYRecursive('paella, vino')).toEqual(['paella', 'vino']);
  });

  it('conjunction within compound dish: "café con leche y tostada" → ["café con leche", "tostada"]', () => {
    // last-y strategy: split at last ' y ' → left = "café con leche", right = "tostada"
    expect(splitOnCommasThenYRecursive('café con leche y tostada')).toEqual(['café con leche', 'tostada']);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — Helpers: normalizeFragment
// ---------------------------------------------------------------------------

describe('normalizeFragment', () => {
  it('"una copa de vino" → "vino" — strips article + serving prefix', () => {
    expect(normalizeFragment('una copa de vino')).toBe('vino');
  });

  it('"unas bravas" → "bravas" — strips plural article', () => {
    expect(normalizeFragment('unas bravas')).toBe('bravas');
  });

  it('"ración de paella" → "paella" — strips serving prefix only', () => {
    expect(normalizeFragment('ración de paella')).toBe('paella');
  });

  it('"café con leche" → "café con leche" — no-op (no article or serving prefix)', () => {
    expect(normalizeFragment('café con leche')).toBe('café con leche');
  });

  it('"una ración de paella" → "paella" — strips both article and serving prefix', () => {
    expect(normalizeFragment('una ración de paella')).toBe('paella');
  });

  it('"el gazpacho" → "gazpacho" — strips masculine article', () => {
    expect(normalizeFragment('el gazpacho')).toBe('gazpacho');
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: Guard 0 — db unavailable (AC16)
// ---------------------------------------------------------------------------

describe('Guard 0 — db unavailable (AC16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null immediately when db is falsy — no level1Lookup calls', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing Guard 0 safety check
    const result = await detectImplicitMultiItem('paella y vino', undefined as any);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: Guard 1 — no conjunction (AC7, EC-8, EC-9)
// ---------------------------------------------------------------------------

describe('Guard 1 — no conjunction (AC7, EC-8, EC-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"café con leche" → null (no y or ,) — zero DB calls', async () => {
    const result = await detectImplicitMultiItem('café con leche', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });

  it('"paella" → null (no y or ,) — zero DB calls', async () => {
    const result = await detectImplicitMultiItem('paella', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });

  it('"arroz con pollo" → null — zero DB calls', async () => {
    const result = await detectImplicitMultiItem('arroz con pollo', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: Guard 2 — whole-text catalog match (AC8–AC11)
// ---------------------------------------------------------------------------

describe('Guard 2 — whole-text catalog match (AC8–AC11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"tostada con tomate y aceite" → null (Guard 2 whole-text L1 hit)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // whole-text hit
    const result = await detectImplicitMultiItem('tostada con tomate y aceite', mockDb);
    expect(result).toBeNull();
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
  });

  it('"bocadillo de bacon y queso" → null (y-only landmine)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('bocadillo de bacon y queso', mockDb);
    expect(result).toBeNull();
  });

  it('"hamburguesa con huevo y patatas" → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('hamburguesa con huevo y patatas', mockDb);
    expect(result).toBeNull();
  });

  it('"arroz con verduras y huevo" → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('arroz con verduras y huevo', mockDb);
    expect(result).toBeNull();
  });

  it('"lomo con pimientos y patatas" → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('lomo con pimientos y patatas', mockDb);
    expect(result).toBeNull();
  });

  it('"pan con mantequilla y mermelada" → null', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('pan con mantequilla y mermelada', mockDb);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: Step 1+2 — split and normalize path
// ---------------------------------------------------------------------------

describe('Step 1+2 — split and normalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('"paella y vino" splits and validates → ["paella", "vino"]', async () => {
    // Guard 2: whole-text miss
    mockLevel1Lookup.mockResolvedValueOnce(null);
    // Fragment 1: "paella" hit
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    // Fragment 2: "vino" hit
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    const result = await detectImplicitMultiItem('paella y vino', mockDb);
    expect(result).toEqual(['paella', 'vino']);
  });

  it('"un bocadillo y nada más" → null ("nada más" fails L1 lookup)', async () => {
    // Guard 2: whole-text miss
    mockLevel1Lookup.mockResolvedValueOnce(null);
    // Fragment 1: "bocadillo" hit
    mockLevel1Lookup.mockResolvedValueOnce(makeHit());
    // Fragment 2: "nada más" miss
    mockLevel1Lookup.mockResolvedValueOnce(null);
    const result = await detectImplicitMultiItem('un bocadillo y nada más', mockDb);
    expect(result).toBeNull();
  });

  it('single fragment after split → null (EC-5)', async () => {
    // Input with comma but resulting in a single non-empty fragment
    // "paella," → comma split → ["paella"] → length < 2 → null
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    const result = await detectImplicitMultiItem('paella,', mockDb);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: MAX_MENU_ITEMS cap (AC15)
// ---------------------------------------------------------------------------

describe('MAX_MENU_ITEMS cap (AC15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('10-item input → returns exactly 8 items (items 9+10 silently dropped)', async () => {
    // Construct a string of 10 tokens joined with ' y '
    const items = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7', 'item8', 'item9', 'item10'];
    const input = items.join(' y ');
    // Guard 2: whole-text miss
    mockLevel1Lookup.mockResolvedValueOnce(null);
    // Exactly 8 fragment hits (items 9 and 10 are never validated)
    mockLevel1Lookup.mockResolvedValue(makeHit());

    const result = await detectImplicitMultiItem(input, mockDb);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Detector: Step 3 — per-fragment catalog validation (positive, AC1–AC5)
// ---------------------------------------------------------------------------

describe('Step 3 — per-fragment catalog validation (positive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1 — "paella y una copa de vino" (pre-normalized) → ["paella", "vino"]', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "paella"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "vino"
    const result = await detectImplicitMultiItem('paella y una copa de vino', mockDb);
    expect(result).toEqual(['paella', 'vino']);
  });

  it('AC2 — "café con leche y tostada" → ["café con leche", "tostada"]', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "café con leche"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "tostada"
    const result = await detectImplicitMultiItem('café con leche y tostada', mockDb);
    expect(result).toEqual(['café con leche', 'tostada']);
  });

  it('AC3 — "caña y unas bravas" → ["caña", "bravas"]', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "caña"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "bravas"
    const result = await detectImplicitMultiItem('caña y unas bravas', mockDb);
    expect(result).toEqual(['caña', 'bravas']);
  });

  it('AC4 — "paella, vino y flan" → ["paella", "vino", "flan"]', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "paella"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "vino"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "flan"
    const result = await detectImplicitMultiItem('paella, vino y flan', mockDb);
    expect(result).toEqual(['paella', 'vino', 'flan']);
  });

  it('AC5 — "paella y vino y flan" → ["paella", "vino", "flan"] (recursive y-split)', async () => {
    mockLevel1Lookup.mockResolvedValueOnce(null); // Guard 2 miss
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "paella"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "vino"
    mockLevel1Lookup.mockResolvedValueOnce(makeHit()); // "flan"
    const result = await detectImplicitMultiItem('paella y vino y flan', mockDb);
    expect(result).toEqual(['paella', 'vino', 'flan']);
  });
});
