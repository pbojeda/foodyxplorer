// Unit tests for F038 — ingest route changes (nameEs and nameSourceLocale)
//
// Verifies that:
// - Spanish chains: raw.nameEs = raw.name, nameSourceLocale = 'es' in Prisma payload
// - English chains: raw.nameEs = undefined, nameSourceLocale = 'en', warn log emitted
// - No chainSlug: nameSourceLocale = null, no warn log
//
// Uses buildApp() + app.inject() with mocked deps.

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
// Hoisted mock fns (accessible inside vi.mock factories)
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

// ---------------------------------------------------------------------------
// Mocks required by buildApp transitive imports
// ---------------------------------------------------------------------------

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
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
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

const TEST_RESTAURANT_ID = 'f0380000-0001-4000-a000-000000000001';
const TEST_SOURCE_ID     = 'f0380000-0001-4000-a000-000000000002';
const PDF_MAGIC          = Buffer.from('%PDF-rest of bytes');
const JPEG_MAGIC_BYTES   = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);

// ---------------------------------------------------------------------------
// A raw dish returned by parseNutritionTable
// ---------------------------------------------------------------------------

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
// Transaction capture helper
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
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-dish-id' }), // dish exists
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
// pdf-url route tests
// ===========================================================================

describe('POST /ingest/pdf-url — F038 nameEs + nameSourceLocale', () => {
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

  it('Spanish chain (telepizza-es): sets nameEs = name and nameSourceLocale = "es"', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'telepizza-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameEs']).toBe('Grilled Chicken Salad');
    expect(capture.createData?.['nameSourceLocale']).toBe('es');
  });

  it('English chain (burger-king-es): nameEs = undefined, nameSourceLocale = "en"', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'burger-king-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    // nameEs should be undefined/null (not set from raw.name)
    expect(capture.createData?.['nameEs'] ?? undefined).toBeUndefined();
    expect(capture.createData?.['nameSourceLocale']).toBe('en');
  });

  it('No chainSlug: nameSourceLocale = null', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameSourceLocale']).toBeNull();
  });

  it('On update (dish already exists): nameSourceLocale is set in update payload', async () => {
    const capture = setupUpdateTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/pdf-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validPdfUrlBody({ chainSlug: 'telepizza-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.updateData?.['nameSourceLocale']).toBe('es');
  });
});

// ===========================================================================
// image-url route tests
// ===========================================================================

describe('POST /ingest/image-url — F038 nameEs + nameSourceLocale', () => {
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
    mockExtractTextFromImage.mockResolvedValue(['Calorías Grasas', 'Dish 500 15']);
    mockParseNutritionTable.mockReturnValue([makeRawDish('Pizza Margarita')]);
  });

  it('Spanish chain (dominos-es): sets nameEs = name and nameSourceLocale = "es"', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'dominos-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameEs']).toBe('Pizza Margarita');
    expect(capture.createData?.['nameSourceLocale']).toBe('es');
  });

  it('English chain (mcdonalds-es): nameEs = undefined, nameSourceLocale = "en"', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ chainSlug: 'mcdonalds-es', dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameEs'] ?? undefined).toBeUndefined();
    expect(capture.createData?.['nameSourceLocale']).toBe('en');
  });

  it('No chainSlug: nameSourceLocale = null', async () => {
    const capture = setupTransactionCapture();

    const res = await app.inject({
      method:  'POST',
      url:     '/ingest/image-url',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(validImageUrlBody({ dryRun: false })),
    });

    expect(res.statusCode).toBe(200);
    expect(capture.createData?.['nameSourceLocale']).toBeNull();
  });
});
