// F-H7 — Q494 Path B unit test: deterministic H7-P5 retry seam verification.
//
// Tests the H7-P5 seam in runEstimationCascade() with mocked level1Lookup.
// Allows precise control of L1 Pass 1 (miss) + L1 Pass 2 (retry hit) behaviour,
// independent of actual DB state.
//
// This is separate from fH7.engineRouter.integration.test.ts (real DB, Cat A/C probes)
// and the "soft assertion" portion of Edge Case 9 in fH7.edge-cases.test.ts.
//
// Path B: L1 Pass 1 returns null → H7-P5 strip fires → L1 Pass 2 returns non-null → hit.
//
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const { mockLevel1Lookup } = vi.hoisted(() => ({
  mockLevel1Lookup: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — MUST appear before module-under-test import
// ---------------------------------------------------------------------------

vi.mock('../estimation/level1Lookup.js', () => ({
  level1Lookup: mockLevel1Lookup,
  offFallbackFoodMatch: vi.fn().mockResolvedValue(undefined),
}));

// Also mock L2/L3/L4 to prevent real DB calls on fallback paths
vi.mock('../estimation/level2Lookup.js', () => ({
  level2Lookup: vi.fn().mockResolvedValue(null),
}));

vi.mock('../estimation/level3Lookup.js', () => ({
  level3Lookup: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Imports — AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import { runEstimationCascade } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Mock DB + Prisma stubs (never called in L1-hit path)
// ---------------------------------------------------------------------------

const mockDb = {} as unknown as Kysely<DB>;
const mockPrisma = {} as unknown as PrismaClient;

// ---------------------------------------------------------------------------
// Fixture: mock Level1Result for "nigiris de pez mantequilla"
// ---------------------------------------------------------------------------

const MOCK_LEVEL1_RESULT = {
  matchType: 'exact_dish' as const,
  result: {
    entityType: 'dish' as const,
    entityId: 'f7000000-00f7-4000-a000-000000000099',
    name: 'nigiris de pez mantequilla',
    nameEs: 'nigiris de pez mantequilla',
    restaurantId: null,
    chainSlug: null,
    portionGrams: 200,
    nutrients: {
      calories: 300, proteins: 15, carbohydrates: 30, sugars: 2,
      fats: 8, saturatedFats: 2, fiber: 1, salt: 0.5, sodium: 200,
      transFats: 0, cholesterol: 20, potassium: 250,
      monounsaturatedFats: 3, polyunsaturatedFats: 2, alcohol: 0,
      referenceBasis: 'per_serving' as const,
    },
    confidenceLevel: 'high' as const,
    estimationMethod: 'official',
    source: { id: 'f7000000-00f7-4000-a000-000000000098', name: 'Test', type: 'official' as const, url: null },
    similarityDistance: null,
  },
  rawFoodGroup: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('H7-P5 Path B unit test — Q494 deterministic retry seam', () => {
  beforeEach(() => {
    mockLevel1Lookup.mockReset();
  });

  it('Path B: L1 Pass 1 null → Cat C strip fires → L1 Pass 2 hits → levelHit: 1', async () => {
    // Q494 analog: "nigiris de pez mantequilla con trufa"
    // L1 Pass 1: full text → null (not in catalog)
    // H7-P5 Cat C strip: lastIndexOf(" con ") → "nigiris de pez mantequilla"
    //   (pre-con tokens: ["nigiris", "de", "pez", "mantequilla"] → 4 ≥ 2 guard passes)
    // L1 Pass 2: stripped text → non-null
    mockLevel1Lookup
      .mockResolvedValueOnce(null)                // Pass 1: full text miss
      .mockResolvedValueOnce(MOCK_LEVEL1_RESULT); // Pass 2: stripped text hit

    const result = await runEstimationCascade({
      db: mockDb,
      query: 'nigiris de pez mantequilla con trufa',
      prisma: mockPrisma,
    });

    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    // Raw query echoed — engineRouter echo invariant
    expect(result.data.query).toBe('nigiris de pez mantequilla con trufa');
    // Verify mockLevel1Lookup was called twice: once with full text, once with stripped
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(2);
    // Second call uses the H7-P5 stripped query (without "con trufa")
    const secondCallQuery = mockLevel1Lookup.mock.calls[1]?.[1] as string;
    expect(secondCallQuery).toBe('nigiris de pez mantequilla');
    expect(secondCallQuery).not.toContain('con trufa');
  });

  it('Path B short-circuit: L1 Pass 1 hits → seam never reached → levelHit: 1 with 1 L1 call', async () => {
    // "bacalao al pil-pil" is a catalog dish — L1 Pass 1 hits immediately
    // H7-P5 seam is never reached (only fires after Pass 1 null)
    mockLevel1Lookup.mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const result = await runEstimationCascade({
      db: mockDb,
      query: 'bacalao al pil-pil',
      prisma: mockPrisma,
    });

    expect(result.levelHit).toBe(1);
    expect(result.data.level1Hit).toBe(true);
    // Only one L1 call — seam never fired
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
  });

  it('Path B both miss: L1 Pass 1 null → strip → L1 Pass 2 null → levelHit not 1', async () => {
    // "manjar desconocido con salsa rara"
    // L1 Pass 1: null; Cat C strips "con salsa rara" → "manjar desconocido"
    // L1 Pass 2: also null → fall through to L2+
    mockLevel1Lookup
      .mockResolvedValueOnce(null)  // Pass 1 miss
      .mockResolvedValueOnce(null); // Pass 2 miss

    const result = await runEstimationCascade({
      db: mockDb,
      query: 'manjar desconocido con salsa rara',
      prisma: mockPrisma,
    });

    // Must NOT be levelHit 1
    expect(result.levelHit).not.toBe(1);
    // Two L1 calls were made (Pass 1 + Pass 2)
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(2);
  });

  it('Path B no-strip: "arroz con leche" Cat C guard (1 pre-con token) → no retry → levelHit not 1', async () => {
    // "arroz" is only 1 pre-con token → Cat C guard fails → no retry call
    // L1 Pass 1: null; strip not applied → no Pass 2
    mockLevel1Lookup.mockResolvedValueOnce(null); // Pass 1 miss; no Pass 2 expected

    const result = await runEstimationCascade({
      db: mockDb,
      query: 'arroz con leche',
      prisma: mockPrisma,
    });

    expect(result.levelHit).not.toBe(1);
    // Only one L1 call: Cat C guard prevented retry
    expect(mockLevel1Lookup).toHaveBeenCalledTimes(1);
  });

  it('Path B observability: logger.debug called with wrapperPattern: "H7-P5" when seam fires', async () => {
    mockLevel1Lookup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MOCK_LEVEL1_RESULT);

    const debugCalls: Array<Record<string, unknown>> = [];
    const mockLogger = {
      debug: (obj: Record<string, unknown>) => { debugCalls.push(obj); },
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    await runEstimationCascade({
      db: mockDb,
      query: 'tataki de atún con sésamo',
      prisma: mockPrisma,
      logger: mockLogger,
    });

    const h7Call = debugCalls.find(c => c['wrapperPattern'] === 'H7-P5');
    expect(h7Call).toBeDefined();
    expect(h7Call?.['original']).toBe('tataki de atún con sésamo');
    expect(h7Call?.['stripped']).toBe('tataki de atún');
  });
});
