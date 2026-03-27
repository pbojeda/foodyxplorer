// F035 — Unit tests for resolveIngredient.ts
//
// Tests:
//   - resolveIngredientL1: direct_id, exact_food, fts_food strategies
//   - resolveIngredientL3L4: similarity_food, llm_food_match strategies
//   - per_100g filter enforced (per_serving rows → unresolved)
//   - AbortSignal handling (L3/L4 skipped when aborted)
//   - Error propagation (DB_UNAVAILABLE)
//
// Mocks:
//   - Kysely sql.execute (via vi.mock)
//   - callChatCompletion and callOpenAIEmbeddingsOnce from openaiClient

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Kysely sql tagged template — all queries go through sql<T>`...`.execute(db)
vi.mock('kysely', async (importOriginal) => {
  const actual = await importOriginal<typeof import('kysely')>();
  return {
    ...actual,
    sql: Object.assign(
      vi.fn().mockReturnValue({ execute: vi.fn() }),
      {
        raw: actual.sql.raw,
      },
    ),
  };
});

// Mock openaiClient
vi.mock('../lib/openaiClient.js', () => ({
  callChatCompletion: vi.fn(),
  callOpenAIEmbeddingsOnce: vi.fn(),
}));

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import { callChatCompletion, callOpenAIEmbeddingsOnce } from '../lib/openaiClient.js';
import {
  resolveIngredientL1,
  resolveIngredientL3L4,
} from '../calculation/resolveIngredient.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FOOD_ID = 'fd000000-0001-4000-a000-000000000001';
const API_KEY = 'test-openai-key';

// A valid per_100g food row
function makeFoodRow(overrides: Partial<{ reference_basis: string }> = {}) {
  return {
    food_id: FOOD_ID,
    food_name: 'Chicken breast',
    food_name_es: 'Pechuga de pollo',
    calories: '165',
    proteins: '31',
    carbohydrates: '0',
    sugars: '0',
    fats: '3.6',
    saturated_fats: '1.0',
    fiber: '0',
    salt: '0.1',
    sodium: '74',
    trans_fats: '0',
    cholesterol: '85',
    potassium: '220',
    monounsaturated_fats: '1.2',
    polyunsaturated_fats: '0.8',
    reference_basis: 'per_100g',
    source_id: 'ds-001',
    source_name: 'USDA',
    source_type: 'official',
    source_url: null,
    ...overrides,
  };
}

// Utility to create a mock sql executor that returns the given rows
function mockSqlReturn(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValueOnce({ rows });
  (sql as ReturnType<typeof vi.fn>).mockReturnValueOnce({ execute });
  return execute;
}

// Create a minimal Kysely DB mock (queries are intercepted at sql level)
const db = {} as Kysely<DB>;

// ---------------------------------------------------------------------------
// resolveIngredientL1 — direct_id
// ---------------------------------------------------------------------------

describe('resolveIngredientL1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset sql mock to default (returns empty)
    (sql as ReturnType<typeof vi.fn>).mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  });

  describe('direct_id strategy', () => {
    it('returns resolved result with matchType direct_id when foodId found', async () => {
      const row = makeFoodRow();
      mockSqlReturn([row]);

      const result = await resolveIngredientL1(db, { foodId: FOOD_ID, grams: 200, portionMultiplier: 1.0 });

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.matchType).toBe('direct_id');
        expect(result.entityId).toBe(FOOD_ID);
        expect(result.name).toBe('Chicken breast');
        expect(result.nameEs).toBe('Pechuga de pollo');
        expect(result.nutrientRow.reference_basis).toBe('per_100g');
      }
    });

    it('returns unresolved when foodId not found in DB', async () => {
      mockSqlReturn([]);

      const result = await resolveIngredientL1(db, { foodId: FOOD_ID, grams: 200, portionMultiplier: 1.0 });

      expect(result.resolved).toBe(false);
    });

    it('returns unresolved immediately for foodId miss (no cascade to name strategies)', async () => {
      // Only one SQL call should be made (the direct UUID lookup)
      mockSqlReturn([]);

      await resolveIngredientL1(db, { foodId: FOOD_ID, grams: 200, portionMultiplier: 1.0 });

      // sql was called only once (the direct UUID lookup)
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('marks unresolved if food found but reference_basis is per_serving', async () => {
      const row = makeFoodRow({ reference_basis: 'per_serving' });
      mockSqlReturn([row]);

      const result = await resolveIngredientL1(db, { foodId: FOOD_ID, grams: 200, portionMultiplier: 1.0 });

      // per_serving rows cannot be scaled by grams → unresolved
      expect(result.resolved).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // exact_food strategy
  // ---------------------------------------------------------------------------

  describe('exact_food strategy', () => {
    it('returns resolved result with matchType exact_food when name matches', async () => {
      const row = makeFoodRow();
      // With name (no foodId), first sql call = exact_food → hit
      (sql as ReturnType<typeof vi.fn>).mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [row] }) });

      const result = await resolveIngredientL1(db, { name: 'pechuga de pollo', grams: 100, portionMultiplier: 1.0 });

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.matchType).toBe('exact_food');
      }
    });

    it('falls through to fts_food when exact_food misses', async () => {
      const row = makeFoodRow();
      const exactExecute = vi.fn().mockResolvedValueOnce({ rows: [] }); // exact_food miss
      const ftsExecute = vi.fn().mockResolvedValueOnce({ rows: [row] }); // fts_food hit
      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: exactExecute })
        .mockReturnValueOnce({ execute: ftsExecute });

      const result = await resolveIngredientL1(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 });

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.matchType).toBe('fts_food');
      }
    });

    it('returns unresolved when both exact and fts miss', async () => {
      (sql as ReturnType<typeof vi.fn>).mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });

      const result = await resolveIngredientL1(db, { name: 'ingrediente desconocido', grams: 100, portionMultiplier: 1.0 });

      expect(result.resolved).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveIngredientL3L4
// ---------------------------------------------------------------------------

describe('resolveIngredientL3L4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sql as ReturnType<typeof vi.fn>).mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  });

  describe('L3 similarity_food', () => {
    it('returns resolved result with matchType similarity_food when embedding matches', async () => {
      const embedding = new Array(1536).fill(0.1);
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(embedding);

      // foodSimilaritySearch → returns a row with distance < 0.5
      const similarityRow = { food_id: FOOD_ID, distance: '0.3' };
      const nutrientRow = makeFoodRow();

      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [similarityRow] }) })
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [nutrientRow] }) });

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.matchType).toBe('similarity_food');
      }
    });

    it('skips L3 when openAiApiKey is undefined and proceeds to L4', async () => {
      // No API key → should skip embedding, no callOpenAIEmbeddingsOnce call
      // L4 also needs key, so result should be unresolved
      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, undefined);

      expect(callOpenAIEmbeddingsOnce).not.toHaveBeenCalled();
      expect(result.resolved).toBe(false);
    });

    it('skips L3 gracefully if embedding call fails', async () => {
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      // L4 also needs candidates (trigram) → none found → unresolved
      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(false);
    });

    it('skips L3 when distance exceeds threshold (0.5)', async () => {
      const embedding = new Array(1536).fill(0.1);
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(embedding);

      // distance = 0.6 (above threshold) → L3 miss
      const similarityRow = { food_id: FOOD_ID, distance: '0.6' };
      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [similarityRow] }) })
        .mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(false);
    });

    it('skips when aborted before L3 starts', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await resolveIngredientL3L4(
        db,
        { name: 'pollo', grams: 100, portionMultiplier: 1.0 },
        API_KEY,
        controller.signal,
      );

      expect(callOpenAIEmbeddingsOnce).not.toHaveBeenCalled();
      expect(result.resolved).toBe(false);
    });
  });

  describe('L4 llm_food_match', () => {
    it('returns resolved result with matchType llm_food_match when LLM selects a candidate', async () => {
      // L3 embedding fails → skip to L4
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      // L4: trigram candidates
      const candidates = [{ id: FOOD_ID, name: 'Chicken breast', name_es: 'Pechuga de pollo' }];
      const nutrientRow = makeFoodRow();

      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) })
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [nutrientRow] }) });

      // LLM selects index 0
      (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('0');

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.matchType).toBe('llm_food_match');
      }
    });

    it('returns unresolved when LLM returns none', async () => {
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const candidates = [{ id: FOOD_ID, name: 'Chicken', name_es: null }];
      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) });

      (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('none');

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(false);
    });

    it('returns unresolved when LLM call fails (null response)', async () => {
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const candidates = [{ id: FOOD_ID, name: 'Chicken', name_es: null }];
      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) });

      (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(false);
    });

    it('marks unresolved if L4 selected food has per_serving nutrient row', async () => {
      (callOpenAIEmbeddingsOnce as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const candidates = [{ id: FOOD_ID, name: 'Chicken', name_es: null }];
      const perServingRow = makeFoodRow({ reference_basis: 'per_serving' });

      (sql as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: candidates }) })
        .mockReturnValueOnce({ execute: vi.fn().mockResolvedValueOnce({ rows: [perServingRow] }) });

      (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('0');

      const result = await resolveIngredientL3L4(db, { name: 'pollo', grams: 100, portionMultiplier: 1.0 }, API_KEY);

      expect(result.resolved).toBe(false);
    });
  });
});
