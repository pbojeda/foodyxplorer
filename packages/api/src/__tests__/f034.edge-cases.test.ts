// F034 — Edge-case tests for POST /analyze/menu
//
// Tests scenarios that require specific combinations of inputs or error conditions:
//   - PDF magic bytes detection → OCR (not extractTextFromImage)
//   - Vision empty response → OCR fallback for vision mode
//   - Vision empty response → MENU_ANALYSIS_FAILED for identify mode (no fallback)
//   - Vision API absent + PDF + auto → OCR succeeds (no VISION_API_UNAVAILABLE)
//   - All-null cascade → 200 with estimate: null per dish
//   - Duplicate dish names → separate cascade calls (no deduplication)
//   - Redis INCR failure → fail-open (request proceeds)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import FormData from 'form-data';

// ---------------------------------------------------------------------------
// Mocks
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

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    queryLog: { create: vi.fn() },
    apiKey: { findUnique: vi.fn().mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4000-a000-000000000001',
      keyHash: 'hash',
      tier: 'free',
      isActive: true,
      expiresAt: null,
    }) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  } as unknown as PrismaClient,
}));

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

const { mockCallVisionCompletion } = vi.hoisted(() => ({
  mockCallVisionCompletion: vi.fn(),
}));

const { mockExtractText } = vi.hoisted(() => ({
  mockExtractText: vi.fn(),
}));

const { mockExtractTextFromImage } = vi.hoisted(() => ({
  mockExtractTextFromImage: vi.fn(),
}));

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../lib/openaiClient.js', () => ({
  callVisionCompletion: mockCallVisionCompletion,
  callChatCompletion: vi.fn().mockResolvedValue(null),
  callOpenAIEmbeddingsOnce: vi.fn().mockResolvedValue(null),
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn().mockReturnValue(false),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/pdfParser.js', () => ({
  extractText: mockExtractText,
}));

vi.mock('../lib/imageOcrExtractor.js', () => ({
  extractTextFromImage: mockExtractTextFromImage,
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

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
import type { EngineRouterResult } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

function makePdfBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46;
  return buf;
}

function buildFormData(fileBuffer: Buffer, mode?: string, filename = 'photo.jpg', contentType = 'image/jpeg') {
  const form = new FormData();
  form.append('file', fileBuffer, { filename, contentType });
  if (mode !== undefined) form.append('mode', mode);
  return { body: form.getBuffer(), headers: form.getHeaders() };
}

const TEST_API_KEY = 'test-api-key-12345';

function makeMissCascadeResult(dishName: string): EngineRouterResult {
  return {
    levelHit: null,
    data: {
      query: dishName,
      chainSlug: null,
      level1Hit: false, level2Hit: false, level3Hit: false, level4Hit: false,
      matchType: null, result: null, cachedAt: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F034 edge cases', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockConfig.OPENAI_API_KEY = 'test-openai-key';
    mockConfig.BOT_KEY_ID = undefined;

    app = await buildApp();
  });

  // ---------------------------------------------------------------------------
  // PDF detection routes to extractText (pdf-parse), not extractTextFromImage
  // ---------------------------------------------------------------------------

  it('PDF magic bytes + mode=ocr → uses extractText (pdf-parse), not OCR', async () => {
    mockExtractText.mockResolvedValue(['Burger\nFries\nSalad']);
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Burger'));

    const { body, headers } = buildFormData(makePdfBuffer(), 'ocr', 'menu.pdf', 'application/pdf');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(mockExtractText).toHaveBeenCalledOnce();
    expect(mockExtractTextFromImage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Vision empty response → OCR fallback for vision mode
  // ---------------------------------------------------------------------------

  it('vision mode + empty Vision response ("[]") → OCR fallback', async () => {
    mockCallVisionCompletion.mockResolvedValue('[]');
    mockExtractTextFromImage.mockResolvedValue(['Paella', 'Gazpacho', 'Croquetas']);
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Paella'));

    const { body, headers } = buildFormData(makeJpegBuffer(), 'vision');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(mockExtractTextFromImage).toHaveBeenCalledOnce();
    expect(response.json().data.dishes).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Vision empty response → MENU_ANALYSIS_FAILED for identify mode (no fallback)
  // ---------------------------------------------------------------------------

  it('identify mode + Vision returns null → MENU_ANALYSIS_FAILED (no OCR fallback)', async () => {
    mockCallVisionCompletion.mockResolvedValue(null);

    const { body, headers } = buildFormData(makeJpegBuffer(), 'identify');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('MENU_ANALYSIS_FAILED');
    expect(mockExtractTextFromImage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Vision API absent + PDF + auto → OCR succeeds (no VISION_API_UNAVAILABLE)
  // ---------------------------------------------------------------------------

  it('auto + PDF + no OpenAI key → OCR pipeline succeeds without VISION_API_UNAVAILABLE', async () => {
    mockConfig.OPENAI_API_KEY = undefined;
    mockExtractText.mockResolvedValue(['Pizza Margherita\nCalzone\nLasagna']);
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Pizza Margherita'));

    const { body, headers } = buildFormData(makePdfBuffer(), 'auto', 'menu.pdf', 'application/pdf');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(mockCallVisionCompletion).not.toHaveBeenCalled();
    expect(mockExtractText).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // All-null cascade → 200 with estimate: null per dish
  // ---------------------------------------------------------------------------

  it('all cascade misses → 200 with estimate: null for all dishes', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Unknown Dish 1", "Unknown Dish 2"]');
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Unknown'));

    const { body, headers } = buildFormData(makeJpegBuffer(), 'vision');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.dishes).toHaveLength(2);
    expect(json.data.dishes[0].estimate).toBeNull();
    expect(json.data.dishes[1].estimate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Duplicate dish names → separate cascade calls (no deduplication)
  // ---------------------------------------------------------------------------

  it('duplicate dish names → each passed to cascade separately', async () => {
    // OCR returns duplicates
    mockExtractTextFromImage.mockResolvedValue(['Burger', 'Burger', 'Pizza']);
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Burger'));

    const { body, headers } = buildFormData(makeJpegBuffer(), 'ocr');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
    // 3 cascade calls (no deduplication)
    expect(mockRunEstimationCascade).toHaveBeenCalledTimes(3);
    expect(response.json().data.dishes).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Redis INCR failure → fail-open (request proceeds)
  // ---------------------------------------------------------------------------

  it('Redis INCR throws → fail-open (request proceeds, not blocked)', async () => {
    mockRedisIncr.mockRejectedValue(new Error('Connection refused'));
    mockCallVisionCompletion.mockResolvedValue('["Taco"]');
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('Taco'));

    const { body, headers } = buildFormData(makeJpegBuffer(), 'vision');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // PDF + vision/identify → INVALID_IMAGE
  // ---------------------------------------------------------------------------

  it('PDF + vision mode → 422 INVALID_IMAGE', async () => {
    const { body, headers } = buildFormData(makePdfBuffer(), 'vision', 'menu.pdf', 'application/pdf');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_IMAGE');
  });

  it('PDF + identify mode → 422 INVALID_IMAGE', async () => {
    const { body, headers } = buildFormData(makePdfBuffer(), 'identify', 'menu.pdf', 'application/pdf');
    const response = await app.inject({
      method: 'POST',
      url: '/analyze/menu',
      headers: { ...headers, 'x-api-key': TEST_API_KEY },
      body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_IMAGE');
  });
});
