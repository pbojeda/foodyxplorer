// Integration tests for POST /ingest/pdf-url
//
// Uses buildApp() + .inject() to test the full route pipeline.
// Mocks pdfDownloader.downloadPdf and pdfParser.extractText via vi.mock.
// Uses real test DB for DB existence checks and upsert verification.
//
// vi.mock must be at the top level before any imports.

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mock pdfDownloader.downloadPdf — avoids real HTTP requests
// ---------------------------------------------------------------------------

vi.mock('../../../lib/pdfDownloader.js', () => ({
  downloadPdf: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock pdfParser.extractText — avoids real pdf-parse invocation
// ---------------------------------------------------------------------------

vi.mock('../../../lib/pdfParser.js', () => ({
  extractText: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../app.js';
import { downloadPdf } from '../../../lib/pdfDownloader.js';
import { extractText } from '../../../lib/pdfParser.js';

const mockDownloadPdf = downloadPdf as ReturnType<typeof vi.fn>;
const mockExtractText = extractText as ReturnType<typeof vi.fn>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../fixtures/pdf');

function loadFixtureLines(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), 'utf-8');
  return content.split('\n');
}

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

// Deterministic UUIDs in e200 namespace (distinct from e000 and e100)
const TEST_RESTAURANT_ID = 'e2000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e2000000-0000-4000-a000-000000000002';
const NONEXISTENT_ID = 'f2000000-0000-4000-a000-000000000099';

// Minimal PDF magic bytes — passes the %PDF- check
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake content for testing');
const FAKE_PNG_BUFFER = Buffer.from('\x89PNG\r\n\x1a\n fake png content');

// ---------------------------------------------------------------------------
// Fixtures setup/teardown
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  // Clean up any leftovers from previous test runs
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });

  // Create test fixtures
  await prisma.dataSource.create({
    data: {
      id: TEST_SOURCE_ID,
      name: 'PDF URL Ingest Test Source',
      type: 'scraped',
    },
  });

  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'PDF URL Test Restaurant',
      chainSlug: 'pdf-url-test-restaurant',
      countryCode: 'ES',
    },
  });

  app = await buildApp({ prisma });
});

afterAll(async () => {
  // Reverse FK order cleanup
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });
  await prisma.$disconnect();
  await app.close();
});

afterEach(async () => {
  mockDownloadPdf.mockReset();
  mockExtractText.mockReset();
  // Clean up any dishes created in previous tests
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
});

// ---------------------------------------------------------------------------
// Helper to make a JSON POST request to /ingest/pdf-url
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    url: '/ingest/pdf-url',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /ingest/pdf-url', () => {
  it('1. Happy path — valid URL, nutritional table → 200 with dishes upserted', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const pdfUrl = 'https://example.com/menu.pdf';
    const response = await app.inject(makeRequest({
      url: pdfUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        dishesFound: number;
        dishesUpserted: number;
        dryRun: boolean;
        sourceUrl: string;
        dishes: unknown[];
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.dishesFound).toBeGreaterThanOrEqual(1);
    expect(body.data.dishesUpserted).toBeGreaterThanOrEqual(1);
    expect(body.data.dryRun).toBe(false);
    expect(body.data.sourceUrl).toBe(pdfUrl);

    // Verify at least one Dish row exists in DB
    const dishes = await prisma.dish.findMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    expect(dishes.length).toBeGreaterThanOrEqual(1);
  });

  it('2. dryRun: true — 200, dishesUpserted === 0, no DB writes', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      data: { dishesUpserted: number; dryRun: boolean; dishes: unknown[] };
    };

    expect(body.data.dishesUpserted).toBe(0);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.dishes.length).toBeGreaterThanOrEqual(1);

    // Verify no Dish row in DB
    const dishes = await prisma.dish.findMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    expect(dishes.length).toBe(0);
  });

  it('3. Missing url field → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('4. url is not a valid URL string → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'not-a-url',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('5. url with file:// scheme → 422 INVALID_URL (no downloadPdf call)', async () => {
    const response = await app.inject(makeRequest({
      url: 'file:///etc/passwd',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('6. url resolving to localhost → 422 INVALID_URL (no downloadPdf call)', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://localhost/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('7. Non-existent restaurantId → 404 NOT_FOUND (no downloadPdf call)', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('8. Non-existent sourceId → 404 NOT_FOUND', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: NONEXISTENT_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('9. downloadPdf throws FETCH_FAILED → 422 FETCH_FAILED', async () => {
    mockDownloadPdf.mockRejectedValue(
      Object.assign(new Error('Failed to download PDF: HTTP 403'), {
        statusCode: 422,
        code: 'FETCH_FAILED',
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('10. downloadPdf throws INVALID_PDF (bad Content-Type) → 422 INVALID_PDF', async () => {
    mockDownloadPdf.mockRejectedValue(
      Object.assign(new Error('URL did not return a PDF (Content-Type: text/html)'), {
        statusCode: 422,
        code: 'INVALID_PDF',
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PDF');
  });

  it('11. downloadPdf throws PAYLOAD_TOO_LARGE → 413', async () => {
    mockDownloadPdf.mockRejectedValue(
      Object.assign(new Error('PDF exceeds the 20 MB size limit'), {
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/large.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(413);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('12. downloadPdf returns non-PDF buffer (fails magic bytes) → 422 INVALID_PDF', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PNG_BUFFER);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PDF');
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it('13. extractText throws UNSUPPORTED_PDF (image-based PDF) → 422 UNSUPPORTED_PDF', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockRejectedValue(
      Object.assign(new Error('PDF contains no extractable text'), {
        statusCode: 422,
        code: 'UNSUPPORTED_PDF',
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/scanned.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_PDF');
  });

  it('14. extractText returns lines with no nutritional table → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    const lines = loadFixtureLines('no-nutrients.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  it('15. Partial success — some dishes valid, some skipped → 200 with skippedReasons', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([
      [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
        'Mega Combo 9999 100 200 300 5', // calories > 9000 — skipped by normalizeNutrients
      ].join('\n'),
    ]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      data: {
        dishesFound: number;
        dishesSkipped: number;
        skippedReasons: Array<{ dishName: string; reason: string }>;
      };
    };

    expect(body.data.dishesSkipped).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data.skippedReasons)).toBe(true);
    expect(body.data.skippedReasons.length).toBeGreaterThanOrEqual(1);

    const firstSkip = body.data.skippedReasons[0];
    expect(firstSkip).toHaveProperty('dishName');
    expect(firstSkip).toHaveProperty('reason');
  });

  it('16. Simulated PROCESSING_TIMEOUT → 408 PROCESSING_TIMEOUT', async () => {
    // Simulate timeout by having downloadPdf throw PROCESSING_TIMEOUT
    mockDownloadPdf.mockRejectedValue(
      Object.assign(new Error('Processing timeout'), {
        statusCode: 408,
        code: 'PROCESSING_TIMEOUT',
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/slow.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(408);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('PROCESSING_TIMEOUT');
  });
});
