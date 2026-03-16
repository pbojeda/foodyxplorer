// Unit/integration tests for POST /ingest/image-url
//
// Uses buildApp({ prisma: mockPrisma }) + app.inject() — no real HTTP, no real DB.
// All pipeline dependencies are mocked via vi.mock.
//
// vi.mock must be at the top level, before any imports.

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — top-level, before imports
// ---------------------------------------------------------------------------

vi.mock('../lib/imageDownloader.js', () => ({
  downloadImage: vi.fn(),
}));

vi.mock('../lib/imageOcrExtractor.js', () => ({
  extractTextFromImage: vi.fn(),
}));

vi.mock('../lib/ssrfGuard.js', () => ({
  assertNotSsrf: vi.fn(),
}));

vi.mock('../ingest/nutritionTableParser.js', () => ({
  parseNutritionTable: vi.fn(),
}));

vi.mock('../ingest/chainTextPreprocessor.js', () => ({
  preprocessChainText: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { buildApp } from '../app.js';
import { downloadImage } from '../lib/imageDownloader.js';
import { extractTextFromImage } from '../lib/imageOcrExtractor.js';
import { assertNotSsrf } from '../lib/ssrfGuard.js';
import { parseNutritionTable } from '../ingest/nutritionTableParser.js';
import { preprocessChainText } from '../ingest/chainTextPreprocessor.js';

const mockDownloadImage        = downloadImage as ReturnType<typeof vi.fn>;
const mockExtractTextFromImage = extractTextFromImage as ReturnType<typeof vi.fn>;
const mockAssertNotSsrf        = assertNotSsrf as ReturnType<typeof vi.fn>;
const mockParseNutritionTable  = parseNutritionTable as ReturnType<typeof vi.fn>;
const mockPreprocessChainText  = preprocessChainText as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_RESTAURANT_ID = 'e9000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'e9000000-0000-4000-a000-000000000002';
const JPEG_MAGIC_BYTES   = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);

const testConfig: Config = {
  NODE_ENV:           'test',
  PORT:               3001,
  DATABASE_URL:       'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST:  'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL:          'info',
  REDIS_URL:          'redis://localhost:6380',
};

// ---------------------------------------------------------------------------
// Mock Prisma client — configurable per test
// ---------------------------------------------------------------------------

const mockRestaurantFindUnique = vi.fn();
const mockDataSourceFindUnique = vi.fn();
const mockTransaction          = vi.fn();
const mockDishFindFirst        = vi.fn();
const mockDishCreate           = vi.fn();
const mockDishUpdate           = vi.fn();
const mockDishNutrientFindFirst = vi.fn();
const mockDishNutrientCreate   = vi.fn();
const mockDishNutrientUpdate   = vi.fn();

const mockPrisma: PrismaClient = {
  restaurant:  { findUnique: mockRestaurantFindUnique },
  dataSource:  { findUnique: mockDataSourceFindUnique },
  dish:        { findFirst: mockDishFindFirst, create: mockDishCreate, update: mockDishUpdate },
  dishNutrient: { findFirst: mockDishNutrientFindFirst, create: mockDishNutrientCreate, update: mockDishNutrientUpdate },
  $transaction: mockTransaction,
} as unknown as PrismaClient;

// ---------------------------------------------------------------------------
// A valid raw dish returned by parseNutritionTable
// ---------------------------------------------------------------------------

const RAW_DISH = {
  name: 'Margherita',
  nutrients: {
    calories: 500,
    proteins: 20,
    carbohydrates: 60,
    sugars: 5,
    fats: 15,
    saturatedFats: 6,
    fiber: 3,
    salt: 1.2,
    sodium: 0.48,
  },
  sourceUrl: 'https://example.com/img.jpg',
  scrapedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Default mock setups — reset in beforeEach
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config: testConfig, prisma: mockPrisma });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: DB finds both records
  mockRestaurantFindUnique.mockResolvedValue({ id: TEST_RESTAURANT_ID });
  mockDataSourceFindUnique.mockResolvedValue({ id: TEST_SOURCE_ID });

  // Default: downloadImage returns a JPEG buffer
  mockDownloadImage.mockResolvedValue({ buffer: JPEG_MAGIC_BYTES, contentType: 'image/jpeg' });

  // Default: OCR returns a list of lines
  mockExtractTextFromImage.mockResolvedValue([
    'Calorías Grasas Proteínas',
    'Margherita 500 15 20',
  ]);

  // Default: parseNutritionTable returns one dish
  mockParseNutritionTable.mockReturnValue([RAW_DISH]);

  // Default: preprocessChainText returns lines unchanged
  mockPreprocessChainText.mockImplementation((_slug: string, lines: string[]) => lines);

  // Default: assertNotSsrf does nothing
  mockAssertNotSsrf.mockReturnValue(undefined);

  // Default: $transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const txMock = {
      dish:        { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'new-dish-id' }), update: vi.fn().mockResolvedValue(undefined) },
      dishNutrient: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) },
    };
    return fn(txMock);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    method:  'POST' as const,
    url:     '/ingest/image-url',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  };
}

function validBody(): Record<string, unknown> {
  return {
    url:          'https://example.com/img.jpg',
    restaurantId: TEST_RESTAURANT_ID,
    sourceId:     TEST_SOURCE_ID,
    dryRun:       true,
  };
}

// ---------------------------------------------------------------------------
// 400 VALIDATION_ERROR
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 400 VALIDATION_ERROR', () => {
  it('returns 400 when url field is missing', async () => {
    const body = { restaurantId: TEST_RESTAURANT_ID, sourceId: TEST_SOURCE_ID };
    const res  = await app.inject(makeRequest(body));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 when restaurantId is not a valid UUID', async () => {
    const body = { url: 'https://example.com/img.jpg', restaurantId: 'not-a-uuid', sourceId: TEST_SOURCE_ID };
    const res  = await app.inject(makeRequest(body));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 when url is not a valid URL string', async () => {
    const body = { url: 'not-a-url', restaurantId: TEST_RESTAURANT_ID, sourceId: TEST_SOURCE_ID };
    const res  = await app.inject(makeRequest(body));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// 422 INVALID_URL — SSRF guard
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 422 INVALID_URL', () => {
  it('returns 422 INVALID_URL when assertNotSsrf throws INVALID_URL', async () => {
    mockAssertNotSsrf.mockImplementation(() => {
      throw Object.assign(new Error('URL targets a private address'), { statusCode: 422, code: 'INVALID_URL' });
    });

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_URL' } });
  });
});

// ---------------------------------------------------------------------------
// 404 NOT_FOUND
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 404 NOT_FOUND', () => {
  it('returns 404 when restaurantId not in DB', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 when sourceId not in DB', async () => {
    mockDataSourceFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// 422 FETCH_FAILED
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 422 FETCH_FAILED', () => {
  it('returns 422 FETCH_FAILED when downloadImage throws FETCH_FAILED', async () => {
    mockDownloadImage.mockRejectedValue(
      Object.assign(new Error('Failed to download image: HTTP 404'), { statusCode: 422, code: 'FETCH_FAILED' }),
    );

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'FETCH_FAILED' } });
  });
});

// ---------------------------------------------------------------------------
// 413 PAYLOAD_TOO_LARGE
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 413 PAYLOAD_TOO_LARGE', () => {
  it('returns 413 PAYLOAD_TOO_LARGE when downloadImage throws PAYLOAD_TOO_LARGE', async () => {
    mockDownloadImage.mockRejectedValue(
      Object.assign(new Error('Image exceeds the 10 MB size limit'), { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' }),
    );

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});

// ---------------------------------------------------------------------------
// 422 INVALID_IMAGE
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 422 INVALID_IMAGE', () => {
  it('returns 422 INVALID_IMAGE when magic bytes are not JPEG or PNG', async () => {
    // Return a buffer with non-image magic bytes
    mockDownloadImage.mockResolvedValue({
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
      contentType: 'image/jpeg',
    });

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_IMAGE' } });
  });

  it('returns 422 INVALID_IMAGE when downloadImage throws INVALID_IMAGE (content-type check)', async () => {
    mockDownloadImage.mockRejectedValue(
      Object.assign(new Error('URL did not return an image'), { statusCode: 422, code: 'INVALID_IMAGE' }),
    );

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_IMAGE' } });
  });

  it('accepts PNG magic bytes (89504E47)', async () => {
    // PNG magic bytes: \x89 P N G
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    mockDownloadImage.mockResolvedValue({ buffer: pngBuffer, contentType: 'image/png' });

    const res = await app.inject(makeRequest(validBody()));
    // Should NOT be 422 INVALID_IMAGE — passes magic bytes check
    expect(res.statusCode).not.toBe(422);
    // (may be 422 NO_NUTRITIONAL_DATA_FOUND if parseNutritionTable returns [])
  });
});

// ---------------------------------------------------------------------------
// 422 OCR_FAILED
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 422 OCR_FAILED', () => {
  it('returns 422 OCR_FAILED when extractTextFromImage throws OCR_FAILED', async () => {
    mockExtractTextFromImage.mockRejectedValue(
      Object.assign(new Error('OCR extraction failed: WASM error'), { statusCode: 422, code: 'OCR_FAILED' }),
    );

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'OCR_FAILED' } });
  });
});

// ---------------------------------------------------------------------------
// 422 NO_NUTRITIONAL_DATA_FOUND
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 422 NO_NUTRITIONAL_DATA_FOUND', () => {
  it('returns 422 when parseNutritionTable returns empty array', async () => {
    mockParseNutritionTable.mockReturnValue([]);

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NO_NUTRITIONAL_DATA_FOUND' } });
  });

  it('returns 422 when all dishes fail normalization', async () => {
    // Return a dish with calories > 9000 — normalizeNutrients returns null
    mockParseNutritionTable.mockReturnValue([{
      ...RAW_DISH,
      nutrients: { ...RAW_DISH.nutrients, calories: 99999 },
    }]);

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NO_NUTRITIONAL_DATA_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// 200 Happy path — dryRun: true
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 200 success', () => {
  it('returns 200 with correct payload on dryRun: true (no DB write)', async () => {
    const res = await app.inject(makeRequest({ ...validBody(), dryRun: true }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['success']).toBe(true);

    const data = body['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(true);
    expect(data['dishesUpserted']).toBe(0);
    expect(typeof data['dishesFound']).toBe('number');
    expect(Array.isArray(data['dishes'])).toBe(true);
    expect(Array.isArray(data['skippedReasons'])).toBe(true);

    // DB transaction should NOT have been called
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 200 and writes to DB on dryRun: false', async () => {
    const res = await app.inject(makeRequest({ ...validBody(), dryRun: false }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['success']).toBe(true);

    const data = body['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(false);
    expect(data['dishesUpserted']).toBeGreaterThan(0);

    // DB transaction should have been called
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chainSlug — preprocessChainText
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — chainSlug preprocessing', () => {
  it('calls preprocessChainText when chainSlug is provided', async () => {
    const res = await app.inject(makeRequest({ ...validBody(), chainSlug: 'dominos-es' }));
    expect(res.statusCode).toBe(200);
    expect(mockPreprocessChainText).toHaveBeenCalledWith('dominos-es', expect.any(Array));
  });

  it('does not call preprocessChainText when chainSlug is absent', async () => {
    // validBody() does not include chainSlug
    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(200);
    expect(mockPreprocessChainText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 500 DB_UNAVAILABLE
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — 500 DB_UNAVAILABLE', () => {
  it('returns 500 DB_UNAVAILABLE when Prisma $transaction throws non-domain error', async () => {
    mockTransaction.mockRejectedValue(new Error('Connection refused'));

    const res = await app.inject(makeRequest({ ...validBody(), dryRun: false }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'DB_UNAVAILABLE' } });
  });
});

// ---------------------------------------------------------------------------
// sourceUrl in response
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — response fields', () => {
  it('includes sourceUrl equal to the submitted url', async () => {
    const url = 'https://example.com/nutritional-img.jpg';
    const res = await app.inject(makeRequest({ ...validBody(), url, dryRun: true }));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['sourceUrl']).toBe(url);
  });
});
