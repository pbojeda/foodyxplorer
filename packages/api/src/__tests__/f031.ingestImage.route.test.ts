// Unit/integration tests for POST /ingest/image
//
// Uses buildApp({ prisma: mockPrisma }) + app.inject() — no real HTTP, no real DB.
// All pipeline dependencies are mocked via vi.mock.
//
// vi.mock must be at the top level, before any imports.

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — top-level, before imports
// ---------------------------------------------------------------------------

vi.mock('../lib/imageOcrExtractor.js', () => ({
  extractTextFromImage: vi.fn(),
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

import type { InjectOptions } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { buildApp } from '../app.js';
import { extractTextFromImage } from '../lib/imageOcrExtractor.js';
import { parseNutritionTable } from '../ingest/nutritionTableParser.js';
import { preprocessChainText } from '../ingest/chainTextPreprocessor.js';

const mockExtractTextFromImage = extractTextFromImage as ReturnType<typeof vi.fn>;
const mockParseNutritionTable  = parseNutritionTable as ReturnType<typeof vi.fn>;
const mockPreprocessChainText  = preprocessChainText as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_RESTAURANT_ID = 'f3100000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'f3100000-0000-4000-a000-000000000002';
const TEST_API_KEY       = 'test-admin-key';

const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);
const PNG_MAGIC_BYTES  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
const GIF_MAGIC_BYTES  = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]); // GIF87a

const testConfig: Config = {
  NODE_ENV:           'test',
  PORT:               3001,
  DATABASE_URL:       'postgresql://user:pass@localhost:5432/test',
  DATABASE_URL_TEST:  'postgresql://user:pass@localhost:5432/test',
  LOG_LEVEL:          'info',
  REDIS_URL:          'redis://localhost:6380',
  ADMIN_API_KEY:      TEST_API_KEY,
};

// ---------------------------------------------------------------------------
// Mock Prisma client — configurable per test
// ---------------------------------------------------------------------------

const mockRestaurantFindUnique  = vi.fn();
const mockDataSourceFindUnique  = vi.fn();
const mockTransaction           = vi.fn();

const mockPrisma: PrismaClient = {
  restaurant:   { findUnique: mockRestaurantFindUnique },
  dataSource:   { findUnique: mockDataSourceFindUnique },
  dish:         { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  dishNutrient: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: mockTransaction,
} as unknown as PrismaClient;

// ---------------------------------------------------------------------------
// A valid raw dish returned by parseNutritionTable
// ---------------------------------------------------------------------------

const RAW_DISH = {
  name: 'Margherita',
  nutrients: {
    calories:      500,
    proteins:       20,
    carbohydrates:  60,
    sugars:          5,
    fats:           15,
    saturatedFats:   6,
    fiber:           3,
    salt:          1.2,
    sodium:       0.48,
  },
  sourceUrl: 'upload://image-test',
  scrapedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// App lifecycle
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

  // Default: OCR returns a list of lines
  mockExtractTextFromImage.mockResolvedValue([
    'Calorías Grasas Proteínas',
    'Margherita 500 15 20',
  ]);

  // Default: parseNutritionTable returns one dish
  mockParseNutritionTable.mockReturnValue([RAW_DISH]);

  // Default: preprocessChainText returns lines unchanged
  mockPreprocessChainText.mockImplementation((_slug: string, lines: string[]) => lines);

  // Default: $transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const txMock = {
      dish: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    vi.fn().mockResolvedValue({ id: 'new-dish-id' }),
        update:    vi.fn().mockResolvedValue(undefined),
      },
      dishNutrient: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    vi.fn().mockResolvedValue(undefined),
        update:    vi.fn().mockResolvedValue(undefined),
      },
    };
    return fn(txMock);
  });
});

// ---------------------------------------------------------------------------
// Helper — build multipart request for app.inject()
// ---------------------------------------------------------------------------

function makeMultipartRequest(
  fields: Record<string, string>,
  fileBuffer?: Buffer,
  filename = 'photo.jpg',
  omitApiKey = false,
): InjectOptions {
  const boundary = '----FormBoundary123';
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }

  if (fileBuffer !== undefined) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const headers: Record<string, string> = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };

  if (!omitApiKey) {
    headers['x-api-key'] = TEST_API_KEY;
  }

  return {
    method:  'POST',
    url:     '/ingest/image',
    headers,
    payload: Buffer.concat(parts),
  };
}

function validFields(): Record<string, string> {
  return {
    restaurantId: TEST_RESTAURANT_ID,
    sourceId:     TEST_SOURCE_ID,
    dryRun:       'false',
  };
}

// ---------------------------------------------------------------------------
// 401 UNAUTHORIZED
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 401 UNAUTHORIZED', () => {
  it('returns 401 when X-API-Key header is absent', async () => {
    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES, 'photo.jpg', true));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });
});

// ---------------------------------------------------------------------------
// 400 VALIDATION_ERROR
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 400 VALIDATION_ERROR', () => {
  it('returns 400 when restaurantId field is missing', async () => {
    const fields = { sourceId: TEST_SOURCE_ID, dryRun: 'false' };
    const res    = await app.inject(makeMultipartRequest(fields, JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 when restaurantId is not a valid UUID', async () => {
    const fields = { restaurantId: 'not-a-uuid', sourceId: TEST_SOURCE_ID, dryRun: 'false' };
    const res    = await app.inject(makeMultipartRequest(fields, JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 when file part is missing from multipart body', async () => {
    // No fileBuffer passed → no file part in multipart
    const res = await app.inject(makeMultipartRequest(validFields()));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// 404 NOT_FOUND
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 404 NOT_FOUND', () => {
  it('returns 404 when restaurantId does not exist in DB', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 when sourceId does not exist in DB', async () => {
    mockDataSourceFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// 422 INVALID_IMAGE
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 422 INVALID_IMAGE', () => {
  it('returns 422 INVALID_IMAGE when file magic bytes are GIF (not JPEG or PNG)', async () => {
    const res = await app.inject(makeMultipartRequest(validFields(), GIF_MAGIC_BYTES));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_IMAGE' } });
  });

  it('accepts PNG magic bytes (89504E47) without returning 422 INVALID_IMAGE', async () => {
    const res = await app.inject(makeMultipartRequest(validFields(), PNG_MAGIC_BYTES));
    // Should NOT return INVALID_IMAGE — PNG is valid
    expect(res.statusCode).not.toBe(422);
  });
});

// ---------------------------------------------------------------------------
// 422 OCR_FAILED
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 422 OCR_FAILED', () => {
  it('returns 422 OCR_FAILED when extractTextFromImage throws OCR_FAILED', async () => {
    mockExtractTextFromImage.mockRejectedValue(
      Object.assign(new Error('OCR extraction failed: WASM error'), { statusCode: 422, code: 'OCR_FAILED' }),
    );

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'OCR_FAILED' } });
  });
});

// ---------------------------------------------------------------------------
// 422 NO_NUTRITIONAL_DATA_FOUND
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 422 NO_NUTRITIONAL_DATA_FOUND', () => {
  it('returns 422 when parseNutritionTable returns empty array', async () => {
    mockParseNutritionTable.mockReturnValue([]);

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NO_NUTRITIONAL_DATA_FOUND' } });
  });

  it('returns 422 when all dishes fail normalization (calories > 9000)', async () => {
    mockParseNutritionTable.mockReturnValue([{
      ...RAW_DISH,
      nutrients: { ...RAW_DISH.nutrients, calories: 99999 },
    }]);

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NO_NUTRITIONAL_DATA_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// 200 Happy path
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 200 success', () => {
  it('returns 200 with dryRun: false, writes to DB, no sourceUrl in response', async () => {
    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'false' },
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['success']).toBe(true);

    const data = body['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(false);
    expect(data['dishesUpserted']).toBeGreaterThan(0);
    expect(typeof data['dishesFound']).toBe('number');
    expect(Array.isArray(data['dishes'])).toBe(true);
    expect(Array.isArray(data['skippedReasons'])).toBe(true);

    // No sourceUrl field in response (key difference from image-url)
    expect(Object.prototype.hasOwnProperty.call(data, 'sourceUrl')).toBe(false);

    // DB transaction should have been called
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('returns 200 with dryRun: true, no DB write, no sourceUrl in response', async () => {
    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'true' },
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['success']).toBe(true);

    const data = body['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(true);
    expect(data['dishesUpserted']).toBe(0);

    // No sourceUrl field in response
    expect(Object.prototype.hasOwnProperty.call(data, 'sourceUrl')).toBe(false);

    // DB transaction should NOT have been called
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 200 with valid PNG upload', async () => {
    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'true' },
      PNG_MAGIC_BYTES,
      'photo.png',
    ));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['success']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// chainSlug — preprocessChainText
// ---------------------------------------------------------------------------

describe('POST /ingest/image — chainSlug preprocessing', () => {
  it('calls preprocessChainText when chainSlug field is present', async () => {
    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'true', chainSlug: 'dominos-es' },
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(200);
    expect(mockPreprocessChainText).toHaveBeenCalledWith('dominos-es', expect.any(Array));
  });

  it('does NOT call preprocessChainText when chainSlug is absent', async () => {
    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'true' },
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(200);
    expect(mockPreprocessChainText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 500 DB_UNAVAILABLE
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 500 DB_UNAVAILABLE', () => {
  it('returns 500 DB_UNAVAILABLE when Prisma $transaction throws non-domain error', async () => {
    mockTransaction.mockRejectedValue(new Error('Connection refused'));

    const res = await app.inject(makeMultipartRequest(
      { ...validFields(), dryRun: 'false' },
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'DB_UNAVAILABLE' } });
  });
});

// ---------------------------------------------------------------------------
// 413 PAYLOAD_TOO_LARGE — FST_REQ_FILE_TOO_LARGE mapping
// ---------------------------------------------------------------------------

describe('POST /ingest/image — 413 PAYLOAD_TOO_LARGE', () => {
  it('returns 413 PAYLOAD_TOO_LARGE when @fastify/multipart limit is exceeded', async () => {
    // Build a file larger than 10 MB (10 * 1024 * 1024 + 1 bytes)
    // Prefixed with JPEG magic bytes so magic check passes IF we get that far;
    // the multipart plugin should reject before that.
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 100);
    oversizedBuffer[0] = 0xff;
    oversizedBuffer[1] = 0xd8;
    oversizedBuffer[2] = 0xff;

    const res = await app.inject(makeMultipartRequest(validFields(), oversizedBuffer));
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});
