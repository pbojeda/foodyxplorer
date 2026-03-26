// F034 — Route-level integration tests for POST /analyze/menu
//
// Uses buildApp().inject() with mocked Redis, analyzeMenu service,
// Prisma, and config. Tests the full request/response lifecycle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import FormData from 'form-data';

// ---------------------------------------------------------------------------
// Mock Redis (incl. incr/expire for rate limit counter)
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet, mockRedisIncr, mockRedisExpire } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
  mockRedisIncr: vi.fn().mockResolvedValue(1),
  mockRedisExpire: vi.fn().mockResolvedValue(1),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const { mockApikeyFindUnique } = vi.hoisted(() => ({
  mockApikeyFindUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: mockApikeyFindUnique },
    $executeRaw: vi.fn().mockResolvedValue(0),
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely sql
// ---------------------------------------------------------------------------

const { mockSqlFn } = vi.hoisted(() => {
  const mockSqlFn = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
  return { mockSqlFn };
});

vi.mock('kysely', async (importOriginal) => {
  const actual = await importOriginal<typeof import('kysely')>();
  return {
    ...actual,
    sql: Object.assign(mockSqlFn, { raw: actual.sql.raw }),
  };
});

// ---------------------------------------------------------------------------
// Mock analyzeMenu service
// ---------------------------------------------------------------------------

const { mockAnalyzeMenu } = vi.hoisted(() => ({
  mockAnalyzeMenu: vi.fn(),
}));

vi.mock('../analyze/menuAnalyzer.js', () => ({
  analyzeMenu: mockAnalyzeMenu,
  detectFileType: vi.fn().mockReturnValue('jpeg'),
  stripMarkdownJson: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock openaiClient (used by estimation engine in background)
// ---------------------------------------------------------------------------

vi.mock('../lib/openaiClient.js', () => ({
  callVisionCompletion: vi.fn(),
  callChatCompletion: vi.fn().mockResolvedValue(null),
  callOpenAIEmbeddingsOnce: vi.fn().mockResolvedValue(null),
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn().mockReturnValue(false),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    NODE_ENV: 'test' as const,
    PORT: 3001,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    LOG_LEVEL: 'silent' as const,
    REDIS_URL: 'redis://localhost:6380',
    OPENAI_API_KEY: 'test-openai-key' as string | undefined,
    OPENAI_CHAT_MODEL: 'gpt-4o-mini',
    OPENAI_CHAT_MAX_TOKENS: 512,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OPENAI_EMBEDDING_BATCH_SIZE: 100,
    OPENAI_EMBEDDING_RPM: 3000,
    BOT_KEY_ID: undefined as string | undefined,
  },
}));

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal JPEG buffer (magic bytes only) */
function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

/** Build a minimal PDF buffer (magic bytes only) */
function makePdfBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46;
  return buf;
}

/** Build a valid API key DB row (active, non-expired) */
function makeApiKeyRow(id: string, tier: 'free' | 'pro' = 'free') {
  return {
    id,
    keyHash: 'hash',
    tier,
    isActive: true,
    expiresAt: null,
  };
}

const TEST_KEY_ID = 'aaaaaaaa-aaaa-4000-a000-000000000001';
const TEST_API_KEY = 'test-api-key-12345';
const BOT_KEY_ID = 'bbbbbbbb-bbbb-4000-b000-000000000002';

/** A simple successful analyzeMenu result */
function makeAnalyzeResult(mode = 'auto') {
  return {
    mode,
    dishes: [{ dishName: 'Big Mac', estimate: null }],
    partial: false,
  };
}

/** Build a FormData payload for multipart/form-data injection */
function buildFormData(fileBuffer: Buffer, mode?: string): { body: Buffer; headers: Record<string, string> } {
  const form = new FormData();
  form.append('file', fileBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  if (mode !== undefined) {
    form.append('mode', mode);
  }
  return {
    body: form.getBuffer(),
    headers: form.getHeaders(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /analyze/menu', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockApikeyFindUnique.mockResolvedValue(makeApiKeyRow(TEST_KEY_ID));
    mockAnalyzeMenu.mockResolvedValue(makeAnalyzeResult());
    mockConfig.BOT_KEY_ID = undefined;

    app = await buildApp();
  });

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  it('returns 401 UNAUTHORIZED for anonymous request (no API key)', async () => {
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers },
      body,
    });

    expect(response.statusCode).toBe(401);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('returns 200 with MenuAnalysisResponse for valid JPEG + auto mode', async () => {
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.mode).toBe('auto');
    expect(json.data.dishCount).toBe(1);
    expect(json.data.dishes).toHaveLength(1);
    expect(json.data.partial).toBe(false);
  });

  it('returns 200 for PDF + mode=ocr', async () => {
    mockAnalyzeMenu.mockResolvedValue(makeAnalyzeResult('ocr'));
    const { body, headers } = buildFormData(makePdfBuffer(), 'ocr');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.mode).toBe('ocr');
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------

  it('returns 400 VALIDATION_ERROR when no file part is present', async () => {
    const form = new FormData();
    form.append('mode', 'auto');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...form.getHeaders(), 'x-api-key': TEST_API_KEY },
      body: form.getBuffer(),
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid mode value', async () => {
    const { body, headers } = buildFormData(makeJpegBuffer(), 'invalid_mode');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  // ---------------------------------------------------------------------------
  // Service error passthrough
  // ---------------------------------------------------------------------------

  it('returns 422 INVALID_IMAGE when analyzeMenu throws INVALID_IMAGE', async () => {
    mockAnalyzeMenu.mockRejectedValue(
      Object.assign(new Error('Unsupported file type'), { code: 'INVALID_IMAGE' })
    );
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_IMAGE');
  });

  it('returns 422 VISION_API_UNAVAILABLE when analyzeMenu throws VISION_API_UNAVAILABLE', async () => {
    mockAnalyzeMenu.mockRejectedValue(
      Object.assign(new Error('Vision unavailable'), { code: 'VISION_API_UNAVAILABLE' })
    );
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VISION_API_UNAVAILABLE');
  });

  it('returns 422 MENU_ANALYSIS_FAILED when analyzeMenu throws MENU_ANALYSIS_FAILED', async () => {
    mockAnalyzeMenu.mockRejectedValue(
      Object.assign(new Error('No dish names found'), { code: 'MENU_ANALYSIS_FAILED' })
    );
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('MENU_ANALYSIS_FAILED');
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  it('returns 429 RATE_LIMIT_EXCEEDED when hourly counter exceeds 10', async () => {
    mockRedisIncr.mockResolvedValue(11); // Counter over limit
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('skips hourly rate limit check for bot key', async () => {
    mockConfig.BOT_KEY_ID = BOT_KEY_ID;
    mockApikeyFindUnique.mockResolvedValue(makeApiKeyRow(BOT_KEY_ID));
    // Counter would be over limit but should be skipped for bot
    mockRedisIncr.mockResolvedValue(999);

    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': 'bot-api-key-123' },
      body,
    });

    expect(response.statusCode).toBe(200);
    // incr should not have been called at all for the analysis rate limit
    // (Note: the global rate limit incr from @fastify/rate-limit may fire, but our analyze-specific counter should not)
    expect(mockAnalyzeMenu).toHaveBeenCalledOnce();
  });

  it('fails open when Redis incr throws (allows request)', async () => {
    mockRedisIncr.mockRejectedValue(new Error('Redis unavailable'));
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    // Should allow through (fail-open)
    expect(response.statusCode).toBe(200);
    expect(mockAnalyzeMenu).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Partial results
  // ---------------------------------------------------------------------------

  it('returns partial: true when analyzeMenu returns partial result', async () => {
    mockAnalyzeMenu.mockResolvedValue({
      mode: 'auto',
      dishes: [{ dishName: 'Burger', estimate: null }],
      partial: true,
    });
    const { body, headers } = buildFormData(makeJpegBuffer());
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.partial).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Response shape verification
  // ---------------------------------------------------------------------------

  it('response data.mode echoes the requested mode (auto stays auto)', async () => {
    mockAnalyzeMenu.mockResolvedValue(makeAnalyzeResult('auto'));
    const { body, headers } = buildFormData(makeJpegBuffer(), 'auto');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.json().data.mode).toBe('auto');
  });

  it('response data.dishCount equals dishes array length', async () => {
    mockAnalyzeMenu.mockResolvedValue({
      mode: 'ocr',
      dishes: [
        { dishName: 'Pasta', estimate: null },
        { dishName: 'Pizza', estimate: null },
      ],
      partial: false,
    });
    const { body, headers } = buildFormData(makePdfBuffer(), 'ocr');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    const json = response.json();
    expect(json.data.dishCount).toBe(2);
    expect(json.data.dishes).toHaveLength(2);
  });
});
