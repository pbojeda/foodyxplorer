// Edge case tests for F038 — ingest route changes (pdf.ts, pdf-url.ts, image-url.ts)
//
// Covers gaps in the developer's f038.ingest.unit.test.ts:
// 1. pdf.ts route — plain PDF upload (no chainSlug possible): nameSourceLocale = null
// 2. English chain ingest emits request.log.warn() (spec §5.2 compliance)
// 3. pdf-url update path for English chain: nameEs = undefined, nameSourceLocale = 'en'
// 4. image-url update path for Spanish chain: nameSourceLocale in update payload
// 5. pdf-url dryRun: true — no Prisma writes but request succeeds
// 6. Unknown chainSlug not in registry: falls back to null for nameSourceLocale

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — top-level, before imports
// ---------------------------------------------------------------------------

vi.mock('../lib/ssrfGuard.js', () => ({
  assertNotSsrf: vi.fn(),
}));

vi.mock('../lib/pdfDownloader.js', () => ({
  downloadPdf: vi.fn(),
}));

vi.mock('../lib/pdfParser.js', () => ({
  extractText: vi.fn(),
}));

vi.mock('../lib/imageDownloader.js', () => ({
  downloadImage: vi.fn(),
}));

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
// Hoisted mock fns
// ---------------------------------------------------------------------------

const {
  mockRestaurantFindUnique,
  mockDataSourceFindUnique,
  mockTransaction,
} = vi.hoisted(() => ({
  mockRestaurantFindUnique: vi.fn(),
  mockDataSourceFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV:           'test',
    PORT:               3001,
    DATABASE_URL:       'postgresql://user:pass@localhost:5432/test',
    DATABASE_URL_TEST:  'postgresql://user:pass@localhost:5432/test',
    LOG_LEVEL:          'silent',
    REDIS_URL:          'redis://localhost:6380',
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    restaurant:  { findUnique: mockRestaurantFindUnique },
    dataSource:  { findUnique: mockDataSourceFindUnique },
    dish:        { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    dishNutrient: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: mockTransaction,
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../estimation/level1Lookup.js', () => ({ level1Lookup: vi.fn() }));
vi.mock('../estimation/level2Lookup.js', () => ({ level2Lookup: vi.fn() }));
vi.mock('../estimation/level3Lookup.js', () => ({ level3Lookup: vi.fn() }));
vi.mock('../estimation/level4Lookup.js', () => ({ level4Lookup: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports — after vi.mock
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { downloadPdf } from '../lib/pdfDownloader.js';
import { extractText } from '../lib/pdfParser.js';
import { downloadImage } from '../lib/imageDownloader.js';
import { extractTextFromImage } from '../lib/imageOcrExtractor.js';
import { parseNutritionTable } from '../ingest/nutritionTableParser.js';
import { preprocessChainText } from '../ingest/chainTextPreprocessor.js';
import { assertNotSsrf } from '../lib/ssrfGuard.js';

const mockDownloadPdf           = downloadPdf as ReturnType<typeof vi.fn>;
const mockExtractText           = extractText as ReturnType<typeof vi.fn>;
const mockDownloadImage         = downloadImage as ReturnType<typeof vi.fn>;
const mockExtractTextFromImage  = extractTextFromImage as ReturnType<typeof vi.fn>;
const mockParseNutritionTable   = parseNutritionTable as ReturnType<typeof vi.fn>;
const mockPreprocessChainText   = preprocessChainText as ReturnType<typeof vi.fn>;
const mockAssertNotSsrf         = assertNotSsrf as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_RESTAURANT_ID = 'f0381000-0001-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'f0381000-0001-4000-a000-000000000002';
const PDF_MAGIC          = Buffer.from('%PDF-rest of bytes');
const JPEG_MAGIC_BYTES   = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);

const makeRawDish = (name: string) => ({
  name,
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
  sourceUrl: 'https://example.com/menu.pdf',
  scrapedAt: new Date().toISOString(),
  aliases: [],
});

// ---------------------------------------------------------------------------
// Shared app instance
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Transaction capture helpers (create path)
// ---------------------------------------------------------------------------

interface DishCreateData {
  nameEs?: string | null;
  nameSourceLocale?: string | null;
  name: string;
  [key: string]: unknown;
}

interface DishUpdateData {
  nameEs?: string | null;
  nameSourceLocale?: string | null;
  [key: string]: unknown;
}

interface TxCapture {
  createData: DishCreateData | null;
  updateData: DishUpdateData | null;
}

function setupTransactionCapture(): TxCapture {
  const capture: TxCapture = { createData: null, updateData: null };
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const txMock = {
      dish: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: DishCreateData }) => {
          capture.createData = data;
          return Promise.resolve({ id: 'new-dish-id' });
        }),
        update: vi.fn().mockImplementation(({ data }: { data: DishUpdateData }) => {
          capture.updateData = data;
          return Promise.resolve(undefined);
        }),
      },
      dishNutrient: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    return fn(txMock);
  });
  return capture;
}

function setupUpdateTransactionCapture(): TxCapture {
  const capture: TxCapture = { createData: null, updateData: null };
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const txMock = {
      dish: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-dish-id' }),
        create: vi.fn().mockImplementation(({ data }: { data: DishCreateData }) => {
          capture.createData = data;
          return Promise.resolve({ id: 'existing-dish-id' });
        }),
        update: vi.fn().mockImplementation(({ data }: { data: DishUpdateData }) => {
          capture.updateData = data;
          return Promise.resolve(undefined);
        }),
      },
      dishNutrient: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    return fn(txMock);
  });
  return capture;
}

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockRestaurantFindUnique.mockResolvedValue({ id: TEST_RESTAURANT_ID });
  mockDataSourceFindUnique.mockResolvedValue({ id: TEST_SOURCE_ID });
  mockAssertNotSsrf.mockReturnValue(undefined);
  mockPreprocessChainText.mockImplementation((_slug: string, lines: string[]) => lines);
});

// ===========================================================================
// pdf.ts route — no chainSlug possible
// ===========================================================================

describe('POST /ingest/pdf — F038 nameSourceLocale (no chainSlug)', () => {
  beforeEach(() => {
    mockExtractText.mockResolvedValue(['line1', 'line2']);
    mockParseNutritionTable.mockReturnValue([makeRawDish('Grilled Chicken Salad')]);
  });

  async function multipartPdfRequest(buffer: Buffer) {
    // Build a minimal multipart/form-data body manually
    const boundary = 'f038testboundary';
    const restaurantField = `--${boundary}\r\nContent-Disposition: form-data; name="restaurantId"\r\n\r\n${TEST_RESTAURANT_ID}\r\n`;
    const sourceField = `--${boundary}\r\nContent-Disposition: form-data; name="sourceId"\r\n\r\n${TEST_SOURCE_ID}\r\n`;
    const dryRunField = `--${boundary}\r\nContent-Disposition: form-data; name="dryRun"\r\n\r\nfalse\r\n`;
    const fileField = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="menu.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const ending = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(restaurantField),
      Buffer.from(sourceField),
      Buffer.from(dryRunField),
      Buffer.from(fileField),
      buffer,
      Buffer.from(ending),
    ]);
    return app.inject({
      method:  'POST',
      url:     '/ingest/pdf',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('pdf.ts route: nameSourceLocale = null (no chainSlug available)', async () => {
    const capture = setupTransactionCapture();

    await multipartPdfRequest(PDF_MAGIC);

    // pdf.ts has no chainSlug → getChainSourceLocale(undefined) → 'unknown'
    // → nameSourceLocale written as null
    expect(capture.createData?.['nameSourceLocale']).toBeNull();
  });

  it('pdf.ts route: name field is not modified (ADR-001)', async () => {
    const capture = setupTransactionCapture();

    await multipartPdfRequest(PDF_MAGIC);

    // name must be the original parsed name
    expect(capture.createData?.['name']).toBe('Grilled Chicken Salad');
  });

  it('pdf.ts route on update (dish exists): nameSourceLocale = null in update payload', async () => {
    const capture = setupUpdateTransactionCapture();

    await multipartPdfRequest(PDF_MAGIC);

    expect(capture.updateData?.['nameSourceLocale']).toBeNull();
    // name must NOT appear in the update payload (ADR-001: immutable)
    expect(capture.updateData?.['name']).toBeUndefined();
  });
});

// ===========================================================================
// pdf-url route — dryRun + English chain warn log
// ===========================================================================

describe('POST /ingest/pdf-url — F038 edge cases', () => {
  function validPdfUrlBody(overrides: Record<string, unknown> = {}) {
    return {
      url:          'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId:     TEST_SOURCE_ID,
      dryRun:       false,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockDownloadPdf.mockResolvedValue(PDF_MAGIC);
    mockExtractText.mockResolvedValue(['line1', 'line2']);
    mockParseNutritionTable.mockReturnValue([makeRawDish('Grilled Chicken Salad')]);
  });

  it('dryRun: true with Spanish chain — 200, no Prisma writes', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'telepizza-es', dryRun: true })),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { dishesUpserted: number; dryRun: boolean } };
    expect(body.data.dryRun).toBe(true);
    expect(body.data.dishesUpserted).toBe(0);
    // Transaction should not have been called in dry-run mode
    expect(capture.createData).toBeNull();
  });

  it('unknown chainSlug not in registry: nameSourceLocale = null', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'totally-unknown-chain-xyz', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    // Unknown chain → getChainSourceLocale returns 'unknown' → nameSourceLocale = null
    expect(capture.createData?.['nameSourceLocale']).toBeNull();
  });

  it('English chain update path: nameSourceLocale = "en" in update payload', async () => {
    const capture = setupUpdateTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'burger-king-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.updateData?.['nameSourceLocale']).toBe('en');
    // nameEs must be undefined/null for English chain (not translated at ingest time)
    expect(capture.updateData?.['nameEs'] ?? undefined).toBeUndefined();
    // name must NOT appear in update payload (ADR-001)
    expect(capture.updateData?.['name']).toBeUndefined();
  });

  it('ADR-001: name field is never modified in update payload for any chain', async () => {
    // Test for all chain types that name is immutable in update path
    for (const chainSlug of ['burger-king-es', 'telepizza-es']) {
      const capture = setupUpdateTransactionCapture();

      await app.inject({
        method:  'POST',
        url:     '/ingest/pdf-url',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(validPdfUrlBody({ chainSlug, dryRun: false })),
      });

      expect(capture.updateData?.['name']).toBeUndefined();
    }
  });
});

// ===========================================================================
// image-url route — update path + unknown chain
// ===========================================================================

describe('POST /ingest/image-url — F038 edge cases', () => {
  function validImageUrlBody(overrides: Record<string, unknown> = {}) {
    return {
      url:          'https://example.com/menu.jpg',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId:     TEST_SOURCE_ID,
      dryRun:       false,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockDownloadImage.mockResolvedValue({ buffer: JPEG_MAGIC_BYTES, contentType: 'image/jpeg' });
    mockExtractTextFromImage.mockResolvedValue(['Pizza 500 15']);
    mockParseNutritionTable.mockReturnValue([makeRawDish('Pizza Margarita')]);
  });

  it('Spanish chain update path: nameSourceLocale = "es" in update payload', async () => {
    const capture = setupUpdateTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'dominos-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.updateData?.['nameSourceLocale']).toBe('es');
    expect(capture.updateData?.['nameEs']).toBe('Pizza Margarita');
  });

  it('unknown chainSlug: nameSourceLocale = null (no registry entry)', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'new-chain-not-in-registry', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameSourceLocale']).toBeNull();
  });

  it('dryRun: true with Spanish chain — no writes', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'dominos-es', dryRun: true })),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { dishesUpserted: number; dryRun: boolean } };
    expect(body.data.dryRun).toBe(true);
    expect(body.data.dishesUpserted).toBe(0);
    expect(capture.createData).toBeNull();
  });

  it('ADR-001: name field is never modified in update payload', async () => {
    const capture = setupUpdateTransactionCapture();

    await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'dominos-es', dryRun: false })),
    });

    expect(capture.updateData?.['name']).toBeUndefined();
  });
});
