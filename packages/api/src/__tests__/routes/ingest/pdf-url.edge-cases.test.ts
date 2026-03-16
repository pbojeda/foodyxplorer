// Edge-case integration tests for POST /ingest/pdf-url
//
// Complements pdf-url.test.ts by covering:
//   - Zod validation gaps (missing restaurantId, missing sourceId, non-UUID fields,
//     url too long, dryRun as wrong type)
//   - dryRun: true still enforces DB existence checks
//   - Upsert idempotency (second run on same data updates, not errors)
//   - dishesFound === rawDishes.length (includes skipped dishes)
//   - Response envelope structure (success: true wrapper)
//   - SSRF bypass attempts at the route level (decimal IP, hex IP, 0.0.0.0)
//   - Empty JSON body
//   - downloadPdf not called when SSRF guard fires before DB checks
//   - Content-Type guard: buffer passes magic bytes but content-type was rejected by downloader

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mocks — must be at the top level before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('../../../lib/pdfDownloader.js', () => ({
  downloadPdf: vi.fn(),
}));

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
// Test DB setup — uses e3xxx namespace to avoid conflicts with other test files
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const TEST_RESTAURANT_ID = 'e3000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e3000000-0000-4000-a000-000000000002';
const NONEXISTENT_ID = 'f3000000-0000-4000-a000-000000000099';

const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake content for edge case testing');

let app: FastifyInstance;

beforeAll(async () => {
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });

  await prisma.dataSource.create({
    data: {
      id: TEST_SOURCE_ID,
      name: 'PDF URL Edge Case Test Source',
      type: 'scraped',
    },
  });

  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'PDF URL Edge Case Restaurant',
      chainSlug: 'pdf-url-edge-case-restaurant',
      countryCode: 'ES',
    },
  });

  app = await buildApp({ prisma });
});

afterAll(async () => {
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
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
});

function makeRequest(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    url: '/ingest/pdf-url',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /ingest/pdf-url — edge cases', () => {
  // ---------------------------------------------------------------------------
  // Zod validation gaps
  // ---------------------------------------------------------------------------

  it('EC-R1. Empty JSON body {} → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({}));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R2. Missing restaurantId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R3. Missing sourceId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R4. restaurantId is a string but not a UUID → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: 'not-a-uuid',
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R5. sourceId is a string but not a UUID → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: 'not-a-uuid',
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R6. url exactly 2048 chars (max boundary) → passes Zod validation (no 400)', async () => {
    // Build a valid https URL that is exactly 2048 characters long.
    // We expect 422 INVALID_URL or 404 (depending on SSRF / DB) but NOT 400 VALIDATION_ERROR.
    const base = 'https://example.com/';
    const padding = 'a'.repeat(2048 - base.length);
    const longUrl = base + padding;
    expect(longUrl.length).toBe(2048);

    mockDownloadPdf.mockRejectedValue(
      Object.assign(new Error('FETCH_FAILED'), { statusCode: 422, code: 'FETCH_FAILED' }),
    );

    const response = await app.inject(makeRequest({
      url: longUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    // Should NOT be a Zod validation error — the URL is within the 2048 char limit
    expect(response.statusCode).not.toBe(400);
    const body = JSON.parse(response.body) as { error?: { code: string } };
    expect(body.error?.code).not.toBe('VALIDATION_ERROR');
  });

  it('EC-R7. url 2049 chars (one over max) → 400 VALIDATION_ERROR', async () => {
    const base = 'https://example.com/';
    const padding = 'a'.repeat(2049 - base.length);
    const tooLongUrl = base + padding;
    expect(tooLongUrl.length).toBe(2049);

    const response = await app.inject(makeRequest({
      url: tooLongUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R8. dryRun as string "true" (wrong type) → 400 VALIDATION_ERROR', async () => {
    // Unlike POST /ingest/pdf (multipart), this endpoint uses JSON body.
    // dryRun must be a boolean; the string "true" should fail Zod z.boolean().
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 'true',
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R9. dryRun as number 1 (wrong type) → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 1,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // SSRF bypass attempts at route level
  // ---------------------------------------------------------------------------

  it('EC-R10. Decimal IP 2130706433 URL — SSRF guard fires before downloadPdf', async () => {
    // Node may reject the URL at parse time (invalid hostname) or the guard fires.
    // Either way the response must not be 200 and downloadPdf must not be called.
    const response = await app.inject(makeRequest({
      url: 'http://2130706433/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    // 400 (Zod rejects as invalid URL) or 422 (guard rejects)
    expect([400, 422]).toContain(response.statusCode);
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R11. http://0.0.0.0/menu.pdf → 422 INVALID_URL, no downloadPdf call', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://0.0.0.0/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R12. http://[fe80::1]/menu.pdf → 422 INVALID_URL (link-local IPv6)', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://[fe80::1]/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // dryRun: true still enforces DB existence checks
  // ---------------------------------------------------------------------------

  it('EC-R13. dryRun: true with non-existent restaurantId → 404 NOT_FOUND (DB checked first)', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('EC-R14. dryRun: true with non-existent sourceId → 404 NOT_FOUND', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: NONEXISTENT_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Upsert idempotency — second call on same data must not throw
  // ---------------------------------------------------------------------------

  it('EC-R15. Second ingest with same URL and same restaurant → 200, dishes updated (idempotent)', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const requestBody = {
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    };

    // First ingest
    const first = await app.inject(makeRequest(requestBody));
    expect(first.statusCode).toBe(200);

    const firstBody = JSON.parse(first.body) as {
      data: { dishesUpserted: number };
    };
    const firstUpserted = firstBody.data.dishesUpserted;
    expect(firstUpserted).toBeGreaterThanOrEqual(1);

    // Count DB rows after first ingest
    const dishCountAfterFirst = await prisma.dish.count({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });

    // Reset mocks and run again
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const second = await app.inject(makeRequest(requestBody));
    expect(second.statusCode).toBe(200);

    const secondBody = JSON.parse(second.body) as {
      data: { dishesUpserted: number };
    };
    expect(secondBody.data.dishesUpserted).toBeGreaterThanOrEqual(1);

    // No new rows should have been created — it's an upsert
    const dishCountAfterSecond = await prisma.dish.count({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    expect(dishCountAfterSecond).toBe(dishCountAfterFirst);
  });

  // ---------------------------------------------------------------------------
  // dishesFound reflects rawDishes.length (spec §9.1 — includes skipped dishes)
  // ---------------------------------------------------------------------------

  it('EC-R16. dishesFound equals total parsed dishes including skipped ones', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([
      [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
        'Mega Combo 9999 100 200 300 5', // calories > 9000 — skipped
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
        dishesUpserted: number;
        dishesSkipped: number;
      };
    };

    // dishesFound must equal dishesUpserted + dishesSkipped (all parsed dishes)
    expect(body.data.dishesFound).toBe(body.data.dishesUpserted + body.data.dishesSkipped);
    expect(body.data.dishesSkipped).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Response envelope structure
  // ---------------------------------------------------------------------------

  it('EC-R17. Success response has correct envelope: { success: true, data: {...} }', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const pdfUrl = 'https://example.com/menu-envelope.pdf';
    const response = await app.inject(makeRequest({
      url: pdfUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;

    // Top-level envelope
    expect(body['success']).toBe(true);
    expect(typeof body['data']).toBe('object');
    expect(body['data']).not.toBeNull();

    // All spec-required fields present
    const data = body['data'] as Record<string, unknown>;
    expect(typeof data['dishesFound']).toBe('number');
    expect(typeof data['dishesUpserted']).toBe('number');
    expect(typeof data['dishesSkipped']).toBe('number');
    expect(typeof data['dryRun']).toBe('boolean');
    expect(typeof data['sourceUrl']).toBe('string');
    expect(Array.isArray(data['dishes'])).toBe(true);
    expect(Array.isArray(data['skippedReasons'])).toBe(true);

    // sourceUrl must echo the submitted URL (spec §9.1 and §3.3)
    expect(data['sourceUrl']).toBe(pdfUrl);

    // dryRun echoed back
    expect(data['dryRun']).toBe(true);
  });

  it('EC-R18. Error response has correct envelope: { success: false, error: { message, code } }', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(body['success']).toBe(false);
    expect(typeof body['error']).toBe('object');
    expect(body['error']).not.toBeNull();

    const error = body['error'] as Record<string, unknown>;
    expect(typeof error['message']).toBe('string');
    expect(typeof error['code']).toBe('string');
  });

  // ---------------------------------------------------------------------------
  // All-dishes-skipped → 422 NO_NUTRITIONAL_DATA_FOUND
  // ---------------------------------------------------------------------------

  it('EC-R19. All parsed dishes fail normalization → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    // Only one dish with calories > 9000 → normalizeNutrients returns null → validDishes empty
    mockExtractText.mockResolvedValue([
      [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Mega Combo 9999 100 200 300 5',
        'Ultra Combo 9001 80 150 250 4',
      ].join('\n'),
    ]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  // ---------------------------------------------------------------------------
  // SSRF guard runs BEFORE DB checks (order verification)
  // ---------------------------------------------------------------------------

  it('EC-R20. Private IP with non-existent restaurantId → 422 INVALID_URL (SSRF checked first)', async () => {
    // Even though restaurantId doesn't exist, the SSRF guard should fire first
    // (DB check comes after SSRF guard in the processing pipeline — Step 2 vs Step 3)
    const response = await app.inject(makeRequest({
      url: 'http://192.168.1.1/menu.pdf',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Spec §18: Content-Type: text/html from login redirect
  // ---------------------------------------------------------------------------

  it('EC-R21. downloadPdf throws INVALID_PDF with text/html content-type → 422 INVALID_PDF', async () => {
    mockDownloadPdf.mockRejectedValue(
      Object.assign(
        new Error('URL did not return a PDF (Content-Type: text/html; charset=utf-8)'),
        { statusCode: 422, code: 'INVALID_PDF' },
      ),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/login-redirect.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PDF');
  });

  // ---------------------------------------------------------------------------
  // Spec §18: PDF with valid Content-Type but body starts with <html (misconfigured server)
  // ---------------------------------------------------------------------------

  it('EC-R22. Buffer passes magic bytes check only for %PDF- prefix (HTML masquerading as PDF)', async () => {
    // A buffer that does NOT start with %PDF- but with HTML
    const htmlBuffer = Buffer.from('<html><body>Not a PDF</body></html>');
    mockDownloadPdf.mockResolvedValue(htmlBuffer);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/misconfigured.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PDF');
    // extractText must not be called — we reject at magic bytes
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Spec §5.1: dryRun defaults to false (omitted → false)
  // ---------------------------------------------------------------------------

  it('EC-R23. dryRun omitted defaults to false — DB write performed', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      // dryRun intentionally omitted
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      data: { dryRun: boolean; dishesUpserted: number };
    };

    expect(body.data.dryRun).toBe(false);
    expect(body.data.dishesUpserted).toBeGreaterThanOrEqual(1);

    // Verify DB write happened
    const count = await prisma.dish.count({ where: { restaurantId: TEST_RESTAURANT_ID } });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
