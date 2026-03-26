// Edge-case tests for POST /ingest/image
//
// Covers gaps not addressed in the developer-written route test:
//   EC-I1   dryRun omitted → defaults to 'false' string transform → DB write performed
//   EC-I2   dryRun set to "true" (string) → accepted, no DB write
//   EC-I3   chainSlug with uppercase → 400 VALIDATION_ERROR
//   EC-I4   chainSlug with underscore → 400 VALIDATION_ERROR
//   EC-I5   chainSlug exactly 100 chars → passes Zod
//   EC-I6   chainSlug exactly 101 chars → 400 VALIDATION_ERROR
//   EC-I7   dishesFound counts ALL raw dishes (including those that fail normalization)
//   EC-I8   skippedReasons contains dishName + reason for each skipped dish
//   EC-I9   Response data does NOT contain a sourceUrl field
//   EC-I10  DB query order — restaurant checked first; sourceId NOT queried if restaurant missing
//   EC-I11  PROCESSING_TIMEOUT (408) when extractTextFromImage hangs > 60 s
//   EC-I12  Domain error from $transaction is re-thrown as-is, not wrapped as DB_UNAVAILABLE
//   EC-I13  Idempotent upsert — dish.update called when dish already exists
//   EC-I14  Error response envelope shape: { success: false, error: { message, code } }

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

const TEST_RESTAURANT_ID = 'f3100000-0000-4000-a000-000000000011';
const TEST_SOURCE_ID     = 'f3100000-0000-4000-a000-000000000012';
const TEST_API_KEY       = 'test-admin-key-ec';

const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);

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
// Mock Prisma
// ---------------------------------------------------------------------------

const mockRestaurantFindUnique = vi.fn();
const mockDataSourceFindUnique = vi.fn();
const mockTransaction          = vi.fn();

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

  // Default DB mocks
  mockRestaurantFindUnique.mockResolvedValue({ id: TEST_RESTAURANT_ID });
  mockDataSourceFindUnique.mockResolvedValue({ id: TEST_SOURCE_ID });

  // Default pipeline mocks
  mockExtractTextFromImage.mockResolvedValue(['Calorías Grasas Proteínas', 'Margarita 500 15 20']);
  mockParseNutritionTable.mockReturnValue([RAW_DISH]);
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
// Helper — build multipart request
// ---------------------------------------------------------------------------

function makeMultipartRequest(
  fields: Record<string, string>,
  fileBuffer?: Buffer,
  filename = 'photo.jpg',
): InjectOptions {
  const boundary = '----ECBoundary456';
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

  return {
    method:  'POST',
    url:     '/ingest/image',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-api-key':    TEST_API_KEY,
    },
    payload: Buffer.concat(parts),
  };
}

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    restaurantId: TEST_RESTAURANT_ID,
    sourceId:     TEST_SOURCE_ID,
    dryRun:       'false',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EC-I1: dryRun omitted → defaults to false → DB write performed
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I1: dryRun defaults to false when omitted', () => {
  it('performs DB write when dryRun is omitted from multipart fields', async () => {
    const fields = { restaurantId: TEST_RESTAURANT_ID, sourceId: TEST_SOURCE_ID };
    const res    = await app.inject(makeMultipartRequest(fields, JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(false);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-I2: dryRun "true" (string) → accepted by multipart schema → no DB write
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I2: dryRun string "true" is accepted', () => {
  it('accepts dryRun="true" string (multipart schema uses string transform) and skips DB write', async () => {
    const res = await app.inject(makeMultipartRequest(validFields({ dryRun: 'true' }), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['dryRun']).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-I3 & EC-I4: chainSlug validation
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I3/I4: chainSlug validation (invalid chars)', () => {
  it('EC-I3: chainSlug with uppercase letters → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject(makeMultipartRequest(
      validFields({ chainSlug: 'Dominos-ES' }),
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('EC-I4: chainSlug with underscore → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject(makeMultipartRequest(
      validFields({ chainSlug: 'dominos_es' }),
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-I5 & EC-I6: chainSlug length boundary (max 100 chars)
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I5/I6: chainSlug length boundary', () => {
  it('EC-I5: chainSlug exactly 100 chars → passes Zod validation', async () => {
    const slug100 = 'a'.repeat(100);
    const res     = await app.inject(makeMultipartRequest(
      validFields({ chainSlug: slug100, dryRun: 'true' }),
      JPEG_MAGIC_BYTES,
    ));
    // Should NOT be 400 VALIDATION_ERROR
    expect(res.statusCode).not.toBe(400);
  });

  it('EC-I6: chainSlug exactly 101 chars → 400 VALIDATION_ERROR', async () => {
    const slug101 = 'a'.repeat(101);
    const res     = await app.inject(makeMultipartRequest(
      validFields({ chainSlug: slug101 }),
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

// ---------------------------------------------------------------------------
// EC-I7: dishesFound counts ALL raw dishes (including those that fail normalization)
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I7: dishesFound counts all raw dishes', () => {
  it('dishesFound equals total raw dishes including skipped ones', async () => {
    const badDish = {
      ...RAW_DISH,
      name:      'BadDish',
      nutrients: { ...RAW_DISH.nutrients, calories: 99999 },
    };
    mockParseNutritionTable.mockReturnValue([RAW_DISH, badDish]);

    const res = await app.inject(makeMultipartRequest(validFields({ dryRun: 'true' }), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['dishesFound']).toBe(2);
    expect(data['dishesSkipped']).toBe(1);
    expect(data['dishesUpserted']).toBe(0); // dryRun
  });
});

// ---------------------------------------------------------------------------
// EC-I8: skippedReasons contains per-dish details
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I8: skippedReasons per-dish details', () => {
  it('skippedReasons contains dishName and reason for each skipped dish', async () => {
    const badDish = {
      ...RAW_DISH,
      name:      'BadCalorieDish',
      nutrients: { ...RAW_DISH.nutrients, calories: 99999 },
    };
    mockParseNutritionTable.mockReturnValue([RAW_DISH, badDish]);

    const res = await app.inject(makeMultipartRequest(validFields({ dryRun: 'true' }), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data          = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    const skippedReasons = data['skippedReasons'] as Array<Record<string, unknown>>;
    expect(skippedReasons).toHaveLength(1);
    expect(skippedReasons[0]?.['dishName']).toBe('BadCalorieDish');
    expect(typeof skippedReasons[0]?.['reason']).toBe('string');
    expect((skippedReasons[0]?.['reason'] as string).length).toBeGreaterThan(0);
  });

  it('skippedReasons is empty array when all dishes pass normalization', async () => {
    const res = await app.inject(makeMultipartRequest(validFields({ dryRun: 'true' }), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(data['skippedReasons']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EC-I9: Response data does NOT contain a sourceUrl field
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I9: no sourceUrl in response', () => {
  it('response data does not include sourceUrl field (key difference from /ingest/image-url)', async () => {
    const res = await app.inject(makeMultipartRequest(validFields({ dryRun: 'true' }), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(200);

    const data = (JSON.parse(res.body) as Record<string, unknown>)['data'] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(data, 'sourceUrl')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EC-I10: DB query order — restaurant checked first
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I10: DB query order (restaurant before sourceId)', () => {
  it('does not query dataSource when restaurant is not found', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });

    // dataSource should NOT have been queried since restaurant check failed first
    expect(mockDataSourceFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-I11: PROCESSING_TIMEOUT (408) when pipeline hangs > 60 s
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I11: PROCESSING_TIMEOUT', () => {
  it('returns 408 PROCESSING_TIMEOUT when extractTextFromImage never resolves within timeout', async () => {
    vi.useFakeTimers();

    // extractTextFromImage hangs forever
    mockExtractTextFromImage.mockImplementation(() => new Promise(() => undefined));

    const responsePromise = app.inject(makeMultipartRequest(
      validFields({ dryRun: 'false' }),
      JPEG_MAGIC_BYTES,
    ));

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
// EC-I12: Domain error from $transaction is re-thrown as-is (not DB_UNAVAILABLE)
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I12: domain errors inside $transaction not swallowed', () => {
  it('re-throws domain error from $transaction without wrapping as DB_UNAVAILABLE', async () => {
    mockTransaction.mockRejectedValue(
      Object.assign(new Error('No nutritional data'), {
        statusCode: 422,
        code:       'NO_NUTRITIONAL_DATA_FOUND',
      }),
    );

    const res = await app.inject(makeMultipartRequest(
      validFields({ dryRun: 'false' }),
      JPEG_MAGIC_BYTES,
    ));
    // Should be 422 NO_NUTRITIONAL_DATA_FOUND, NOT 500 DB_UNAVAILABLE
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({
      success: false,
      error:   { code: 'NO_NUTRITIONAL_DATA_FOUND' },
    });
  });
});

// ---------------------------------------------------------------------------
// EC-I13: Idempotent upsert — dish.update called when dish already exists
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I13: idempotent upsert on second request', () => {
  it('uses dish.update when existing dish found in transaction (not dish.create)', async () => {
    const existingDishId = 'existing-dish-id-f31';

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

    const res = await app.inject(makeMultipartRequest(
      validFields({ dryRun: 'false' }),
      JPEG_MAGIC_BYTES,
    ));
    expect(res.statusCode).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EC-I14: Error response envelope shape
// ---------------------------------------------------------------------------

describe('POST /ingest/image — EC-I14: error response envelope shape', () => {
  it('404 error has envelope: { success: false, error: { message, code } }', async () => {
    mockRestaurantFindUnique.mockResolvedValue(null);

    const res  = await app.inject(makeMultipartRequest(validFields(), JPEG_MAGIC_BYTES));
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(body['success']).toBe(false);
    expect(typeof (body['error'] as Record<string, unknown>)['message']).toBe('string');
    expect((body['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND');
  });

  it('400 error has correct envelope with VALIDATION_ERROR code', async () => {
    // Missing file part
    const res  = await app.inject(makeMultipartRequest(validFields()));
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(body['success']).toBe(false);
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
    expect(typeof (body['error'] as Record<string, unknown>)['message']).toBe('string');
  });
});
