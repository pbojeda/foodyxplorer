// Route tests for POST /embeddings/generate
//
// Uses buildApp().inject(). Mocks runEmbeddingPipeline at module level.
// No real DB or OpenAI calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { EmbeddingGenerateResponseSchema } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Mock runEmbeddingPipeline and prisma
// ---------------------------------------------------------------------------

const { mockRunPipeline } = vi.hoisted(() => ({
  mockRunPipeline: vi.fn(),
}));

vi.mock('../embeddings/pipeline.js', () => ({
  runEmbeddingPipeline: mockRunPipeline,
}));

// Mock prisma and redis to prevent real connections
vi.mock('../lib/prisma.js', () => ({
  prisma: {} as PrismaClient,
}));

vi.mock('../lib/redis.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) } as unknown as Redis,
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Mock pipeline result
// ---------------------------------------------------------------------------

const MOCK_PIPELINE_RESULT = {
  target: 'all' as const,
  dryRun: false,
  processedFoods: 5,
  processedDishes: 10,
  skippedFoods: 0,
  skippedDishes: 0,
  errorCount: 0,
  errors: [],
  estimatedTokens: 1500,
  durationMs: 2000,
  completedAt: '2026-03-17T14:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /embeddings/generate', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // resetAllMocks clears both call history AND implementation queues
  });

  it('returns 200 with success:true and dryRun data for valid body', async () => {
    const dryRunResult = { ...MOCK_PIPELINE_RESULT, dryRun: true, processedFoods: 0, processedDishes: 0 };
    mockRunPipeline.mockResolvedValueOnce(dryRunResult);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'all', dryRun: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: boolean; data: unknown }>();
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>)['dryRun']).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for invalid target', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'invalid' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when target is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 EMBEDDING_PROVIDER_UNAVAILABLE when pipeline throws that code', async () => {
    mockRunPipeline.mockRejectedValueOnce(
      Object.assign(
        new Error('OPENAI_API_KEY is not configured'),
        { code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
      ),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'all', dryRun: false },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE');
  });

  it('returns 500 DB_UNAVAILABLE when pipeline throws DB_UNAVAILABLE', async () => {
    // dryRun:true bypasses the API key check so the pipeline is actually called
    mockRunPipeline.mockRejectedValueOnce(
      Object.assign(
        new Error('Database query failed'),
        { code: 'DB_UNAVAILABLE' },
      ),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'all', dryRun: true },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('response shape matches EmbeddingGenerateResponseSchema', async () => {
    // dryRun:true bypasses the API key check
    const dryResult = { ...MOCK_PIPELINE_RESULT, dryRun: true, processedFoods: 0, processedDishes: 0 };
    mockRunPipeline.mockResolvedValueOnce(dryResult);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'all', dryRun: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = EmbeddingGenerateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('applies default values: force=false, dryRun=false when OPENAI_API_KEY is set', async () => {
    // Temporarily set OPENAI_API_KEY so the route doesn't throw 422
    const originalKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-key';

    mockRunPipeline.mockResolvedValueOnce(MOCK_PIPELINE_RESULT);

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'foods' },
    });

    process.env['OPENAI_API_KEY'] = originalKey;

    // Verify the pipeline was called with force:false and dryRun:false
    const callArg = mockRunPipeline.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg?.['force']).toBe(false);
    expect(callArg?.['dryRun']).toBe(false);
  });

  it('passes batchSize from request body to pipeline', async () => {
    // Use dryRun:true to bypass the API key check
    const dryResult = { ...MOCK_PIPELINE_RESULT, dryRun: true };
    mockRunPipeline.mockResolvedValueOnce(dryResult);

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/embeddings/generate',
      payload: { target: 'foods', batchSize: 50, dryRun: true },
    });

    const callArg = mockRunPipeline.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg?.['batchSize']).toBe(50);
  });
});
