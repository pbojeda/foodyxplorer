// Edge-case tests for POST /ingest/image-url
//
// Covers gaps not addressed in the developer-written route test:
//   EC-R1  Empty JSON body {} → 400 VALIDATION_ERROR
//   EC-R2  url exactly 2048 chars → passes Zod validation
//   EC-R3  url 2049 chars → 400 VALIDATION_ERROR
//   EC-R4  dryRun omitted → defaults to false (DB write performed)
//   EC-R5  dryRun: "true" (string) → 400 VALIDATION_ERROR
//   EC-R6  chainSlug with uppercase → 400 VALIDATION_ERROR
//   EC-R7  chainSlug with underscore → 400 VALIDATION_ERROR
//   EC-R8  chainSlug with spaces → 400 VALIDATION_ERROR
//   EC-R9  chainSlug exactly 100 chars → passes Zod
//   EC-R10 chainSlug exactly 101 chars → 400 VALIDATION_ERROR
//   EC-R11 SSRF guard fires BEFORE DB existence check (ordering)
//   EC-R12 dishesFound counts ALL raw dishes (including skipped ones)
//   EC-R13 Error response envelope shape: { success: false, error: { message, code } }
//   EC-R14 Second identical request is idempotent (upsert updates, not duplicates)
//   EC-R15 PROCESSING_TIMEOUT (408) when pipeline exceeds 60 seconds
//   EC-R16 DB_UNAVAILABLE is NOT triggered when $transaction throws a domain error
//   EC-R17 sourceUrl in response matches submitted url (not modified)
//   EC-R18 skippedReasons array contains per-dish details when dishes fail normalization

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

const TEST_RESTAURANT_ID = 'ec000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'ec000000-0000-4000-a000-000000000002';
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
// Mock Prisma
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
// A valid raw dish
// ---------------------------------------------------------------------------

const RAW_DISH = {
  name: 'Margarita',
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

  // Default DB mocks
  mockRestaurantFindUnique.mockResolvedValue({ id: TEST_RESTAURANT_ID });
  mockDataSourceFindUnique.mockResolvedValue({ id: TEST_SOURCE_ID });

  // Default pipeline mocks
  mockDownloadImage.mockResolvedValue({ buffer: JPEG_MAGIC_BYTES, contentType: 'image/jpeg' });
  mockExtractTextFromImage.mockResolvedValue(['Calorías Grasas Proteínas', 'Margarita 500 15 20']);
  mockParseNutritionTable.mockReturnValue([RAW_DISH]);
  mockPreprocessChainText.mockImplementation((_slug: string, lines: string[]) => lines);
  mockAssertNotSsrf.mockReturnValue(undefined);

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
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    method:  'POST' as const,
    url:     '/ingest/image-url',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url:          'https://example.com/img.jpg',
    restaurantId: TEST_RESTAURANT_ID,
    sourceId:     TEST_SOURCE_ID,
    dryRun:       true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EC-R1: Empty JSON body
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R1: empty body', () => {
  it('returns 400 VALIDATION_ERROR for an empty JSON body {}', async () => {
    const res = await app.inject(makeRequest({}));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-R2 & EC-R3: url field length boundary
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R2/R3: url length boundary (max 2048)', () => {
  it('EC-R2: url exactly 2048 characters passes Zod validation (no 400)', async () => {
    // Build a valid URL exactly 2048 chars: https://example.com/ + 'a'.repeat(padding)
    const base   = 'https://example.com/';
    const path   = 'a'.repeat(2048 - base.length);
    const url2048 = base + path;
    expect(url2048.length).toBe(2048);

    const res = await app.inject(makeRequest(validBody({ url: url2048 })));
    // Should NOT be 400 (may be 404/422 etc. from downstream, but not Zod rejection)
    expect(res.statusCode).not.toBe(400);
  });

  it('EC-R3: url exactly 2049 characters fails Zod (400 VALIDATION_ERROR)', async () => {
    const base   = 'https://example.com/';
    const path   = 'a'.repeat(2049 - base.length);
    const url2049 = base + path;
    expect(url2049.length).toBe(2049);

    const res = await app.inject(makeRequest(validBody({ url: url2049 })));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-R4: dryRun omitted defaults to false (DB write performed)
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R4: dryRun defaults to false when omitted', () => {
  it('performs DB write when dryRun is omitted (defaults to false)', async () => {
    const body = {
      url:          'https://example.com/img.jpg',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId:     TEST_SOURCE_ID,
      // dryRun intentionally omitted
    };

    const res = await app.inject(makeRequest(body));
    expect(res.statusCode).toBe(200);

    const resBody = JSON.parse(res.body) as Record<string, unknown>;
    const data    = resBody['data'] as Record<string, unknown>;
    // dryRun should default to false → DB write should happen
    expect(data['dryRun']).toBe(false);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-R5: dryRun as string "true" → 400
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R5: dryRun type validation', () => {
  it('returns 400 VALIDATION_ERROR when dryRun is the string "true"', async () => {
    const res = await app.inject(makeRequest(validBody({ dryRun: 'true' })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 400 VALIDATION_ERROR when dryRun is the number 1', async () => {
    const res = await app.inject(makeRequest(validBody({ dryRun: 1 })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-R6 through EC-R10: chainSlug validation (regex ^[a-z0-9-]+$, max 100)
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R6–R10: chainSlug validation', () => {
  it('EC-R6: chainSlug with uppercase letters → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject(makeRequest(validBody({ chainSlug: 'Dominos-ES' })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('EC-R7: chainSlug with underscore → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject(makeRequest(validBody({ chainSlug: 'dominos_es' })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('EC-R8: chainSlug with space → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject(makeRequest(validBody({ chainSlug: 'dominos es' })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('EC-R9: chainSlug exactly 100 chars (all lowercase alphanumeric) → passes Zod', async () => {
    const slug100 = 'a'.repeat(100);
    const res     = await app.inject(makeRequest(validBody({ chainSlug: slug100 })));
    // Should NOT fail Zod (may fail downstream but not 400 VALIDATION_ERROR)
    expect(res.statusCode).not.toBe(400);
  });

  it('EC-R10: chainSlug exactly 101 chars → 400 VALIDATION_ERROR', async () => {
    const slug101 = 'a'.repeat(101);
    const res     = await app.inject(makeRequest(validBody({ chainSlug: slug101 })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('EC-R6b: chainSlug as empty string → 400 VALIDATION_ERROR (min length 1)', async () => {
    const res = await app.inject(makeRequest(validBody({ chainSlug: '' })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-R11: Step ordering — SSRF guard fires BEFORE DB check
//
// Spec pipeline order: (1) parse body → (2) assertNotSsrf → (3) DB checks
// If SSRF fires, the DB should NOT be queried.
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R11: SSRF guard ordering', () => {
  it('does not query DB when SSRF guard throws INVALID_URL', async () => {
    mockAssertNotSsrf.mockImplementation(() => {
      throw Object.assign(new Error('SSRF blocked'), { statusCode: 422, code: 'INVALID_URL' });
    });

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_URL' } });

    // DB should NOT have been queried
    expect(mockRestaurantFindUnique).not.toHaveBeenCalled();
    expect(mockDataSourceFindUnique).not.toHaveBeenCalled();
  });

  it('DB check happens AFTER SSRF — non-existent restaurant with valid URL returns 404, not SSRF error', async () => {
    // assertNotSsrf does NOT throw (URL is valid public URL)
    mockAssertNotSsrf.mockReturnValue(undefined);
    mockRestaurantFindUnique.mockResolvedValue(null); // restaurant not found

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// EC-R12: dishesFound counts ALL raw dishes (including those that fail normalization)
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R12: dishesFound vs dishesUpserted', () => {
  it('dishesFound equals total raw dishes including skipped (failed normalization) ones', async () => {
    const badDish = { ...RAW_DISH, name: 'BadDish', nutrients: { ...RAW_DISH.nutrients, calories: 99999 } };
    mockParseNutritionTable.mockReturnValue([RAW_DISH, badDish]);

    const res = await app.inject(makeRequest(validBody({ dryRun: true })));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    // dishesFound = 2 (all raw), dishesSkipped = 1 (bad dish), dishesUpserted = 0 (dry run)
    expect(data['dishesFound']).toBe(2);
    expect(data['dishesSkipped']).toBe(1);
    expect(data['dishesUpserted']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EC-R13: Error response envelope shape
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R13: error response envelope', () => {
  it('error response has correct envelope: { success: false, error: { message, code } }', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res  = await app.inject(makeRequest(validBody()));
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(body['success']).toBe(false);
    expect(typeof (body['error'] as Record<string, unknown>)['message']).toBe('string');
    expect(typeof (body['error'] as Record<string, unknown>)['code']).toBe('string');
  });

  it('400 error response has correct envelope with VALIDATION_ERROR code', async () => {
    const res  = await app.inject(makeRequest({}));
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(body['success']).toBe(false);
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
    expect(typeof (body['error'] as Record<string, unknown>)['message']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// EC-R14: Idempotency — second identical request updates (upserts), no duplicate
//
// When the same image-url is ingested twice, the dish should be updated
// (tx.dish.update path) rather than created again.
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R14: idempotent upsert on second request', () => {
  it('uses dish.update when existing dish found in transaction', async () => {
    const existingDishId = 'existing-dish-id-001';

    // Second run: dish already exists
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const txMock = {
        dish: {
          findFirst: vi.fn().mockResolvedValue({ id: existingDishId }), // EXISTING
          create:    vi.fn().mockResolvedValue({ id: 'should-not-be-called' }),
          update:    vi.fn().mockResolvedValue(undefined),
        },
        dishNutrient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-nutrient-id' }), // EXISTING
          create:    vi.fn().mockResolvedValue(undefined),
          update:    vi.fn().mockResolvedValue(undefined),
        },
      };
      await fn(txMock);
      // Verify update was used, not create
      expect(txMock.dish.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: existingDishId } }),
      );
      expect(txMock.dish.create).not.toHaveBeenCalled();
    });

    const res = await app.inject(makeRequest(validBody({ dryRun: false })));
    expect(res.statusCode).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-R15: PROCESSING_TIMEOUT (408) when pipeline exceeds 60 seconds
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R15: PROCESSING_TIMEOUT', () => {
  it('returns 408 PROCESSING_TIMEOUT when downloadImage never resolves within timeout', async () => {
    vi.useFakeTimers();

    // downloadImage hangs forever
    mockDownloadImage.mockImplementation(() => new Promise(() => undefined));

    const responsePromise = app.inject(makeRequest(validBody()));

    // Advance timer past the 60-second route timeout
    await vi.advanceTimersByTimeAsync(61_000);

    const res = await responsePromise;
    expect(res.statusCode).toBe(408);
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error:   { code: 'PROCESSING_TIMEOUT' },
    });

    vi.useRealTimers();
  }, 10_000);
});

// ---------------------------------------------------------------------------
// EC-R16: DB_UNAVAILABLE is NOT triggered for domain errors thrown inside $transaction
//
// If the $transaction throws an error with a domain code (e.g. FETCH_FAILED),
// it should be re-thrown as-is, NOT wrapped as DB_UNAVAILABLE.
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R16: domain errors inside $transaction are not swallowed', () => {
  it('re-throws domain error from $transaction without wrapping as DB_UNAVAILABLE', async () => {
    // Simulate a domain error thrown from within the transaction callback
    mockTransaction.mockRejectedValue(
      Object.assign(new Error('No nutritional data'), {
        statusCode: 422,
        code:       'NO_NUTRITIONAL_DATA_FOUND',
      }),
    );

    const res = await app.inject(makeRequest(validBody({ dryRun: false })));
    // Should be 422 NO_NUTRITIONAL_DATA_FOUND, NOT 500 DB_UNAVAILABLE
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error:   { code: 'NO_NUTRITIONAL_DATA_FOUND' },
    });
  });
});

// ---------------------------------------------------------------------------
// EC-R17: sourceUrl in response matches submitted url exactly
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R17: sourceUrl field', () => {
  it('sourceUrl in data matches the submitted url with query params intact', async () => {
    const url = 'https://example.com/nutritional.jpg?v=2&lang=es';
    const res = await app.inject(makeRequest(validBody({ url, dryRun: true })));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['sourceUrl']).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// EC-R18: skippedReasons array carries per-dish details
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R18: skippedReasons detail', () => {
  it('skippedReasons contains dishName and reason for each skipped dish', async () => {
    const badDish = {
      ...RAW_DISH,
      name:      'BadCalorieDish',
      nutrients: { ...RAW_DISH.nutrients, calories: 99999 }, // exceeds 9000 → normalizeNutrients returns null
    };
    mockParseNutritionTable.mockReturnValue([RAW_DISH, badDish]);

    const res = await app.inject(makeRequest(validBody({ dryRun: true })));
    expect(res.statusCode).toBe(200);

    const data          = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    const skippedReasons = data['skippedReasons'] as Array<Record<string, unknown>>;
    expect(skippedReasons).toHaveLength(1);
    expect(skippedReasons[0]?.['dishName']).toBe('BadCalorieDish');
    expect(typeof skippedReasons[0]?.['reason']).toBe('string');
    expect((skippedReasons[0]?.['reason'] as string).length).toBeGreaterThan(0);
  });

  it('skippedReasons is empty array when all dishes pass normalization', async () => {
    const res = await app.inject(makeRequest(validBody({ dryRun: true })));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['skippedReasons']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EC-R19: PNG magic bytes are accepted (not just JPEG)
// This is a confirmatory test — the developer test is non-assertive
// ("may be 422 NO_NUTRITIONAL_DATA_FOUND"). We make it precise.
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R19: PNG magic bytes accepted', () => {
  it('accepts PNG buffer (89 50 4E 47) and proceeds to OCR', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    mockDownloadImage.mockResolvedValue({ buffer: pngBuffer, contentType: 'image/png' });

    const res = await app.inject(makeRequest(validBody({ dryRun: true })));
    // Should reach the OCR step — NOT fail at magic bytes check
    expect(mockExtractTextFromImage).toHaveBeenCalledWith(pngBuffer);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a GIF buffer (47 49 46 38) as INVALID_IMAGE (not JPEG or PNG)', async () => {
    // GIF magic: GIF87a = 0x47 0x49 0x46 0x38 0x37 0x61
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    mockDownloadImage.mockResolvedValue({ buffer: gifBuffer, contentType: 'image/gif' });

    const res = await app.inject(makeRequest(validBody({ dryRun: true })));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'INVALID_IMAGE' } });
    // OCR should NOT have been called for an invalid magic bytes format
    expect(mockExtractTextFromImage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-R20: sourceId not found — DB query order (restaurant checked first)
// ---------------------------------------------------------------------------

describe('POST /ingest/image-url — EC-R20: DB query order (restaurant before sourceId)', () => {
  it('returns NOT_FOUND for restaurantId without querying sourceId', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeRequest(validBody()));
    expect(res.statusCode).toBe(404);

    // sourceId should NOT have been queried since restaurant check failed first
    expect(mockDataSourceFindUnique).not.toHaveBeenCalled();
  });
});
