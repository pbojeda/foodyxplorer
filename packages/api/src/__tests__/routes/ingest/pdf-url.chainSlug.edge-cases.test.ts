// chainSlug edge-case integration tests for POST /ingest/pdf-url
//
// Covers the F011-added chainSlug body parameter:
//   - Valid chainSlug triggers preprocessChainText (integration verification)
//   - Unknown chainSlug (valid format, not in registry) passes through unchanged
//   - Invalid chainSlug format → 400 VALIDATION_ERROR
//   - chainSlug with uppercase letters → 400 VALIDATION_ERROR
//   - chainSlug with spaces → 400 VALIDATION_ERROR
//   - chainSlug exactly 100 chars (max boundary) → accepted
//   - chainSlug exactly 101 chars (over max) → 400 VALIDATION_ERROR
//   - chainSlug: null → treated as missing optional field (accepted)
//   - chainSlug with pipe or injection characters → 400 VALIDATION_ERROR

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

// ---------------------------------------------------------------------------
// Test DB setup — uses e5xxx namespace to avoid conflicts
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const TEST_RESTAURANT_ID = 'e5000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e5000000-0000-4000-a000-000000000002';

// Minimal PDF magic bytes — passes the %PDF- check
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake content for chainSlug edge case testing');

// A minimal nutritional text that the generic parser can parse without preprocessing
const GENERIC_NUTRITION_TEXT = [
  'Calorías Proteínas Hidratos Grasas Sal',
  'Pollo asado 300 28 5 15 1',
  'Ensalada mixta 120 6 8 5 0.5',
].join('\n');

let app: FastifyInstance;

beforeAll(async () => {
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });

  await prisma.dataSource.create({
    data: {
      id: TEST_SOURCE_ID,
      name: 'chainSlug edge case test source',
      type: 'scraped',
    },
  });

  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'chainSlug edge case restaurant',
      chainSlug: 'chainslug-edge-case',
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
// chainSlug validation
// ---------------------------------------------------------------------------

describe('POST /ingest/pdf-url — chainSlug edge cases', () => {
  it('CS-1. chainSlug omitted (no field) → accepted, generic parse runs, 200', async () => {
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([GENERIC_NUTRITION_TEXT]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { dishesFound: number } };
    expect(body.data.dishesFound).toBeGreaterThanOrEqual(1);
  });

  it('CS-2. chainSlug: null → 400 VALIDATION_ERROR (Zod rejects null for optional string)', async () => {
    // z.string().optional() does NOT accept null — only undefined or string.
    // Sending null should produce a VALIDATION_ERROR, not be silently treated as absent.
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
      chainSlug: null,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-3. chainSlug with uppercase letters → 400 VALIDATION_ERROR (spec pattern ^[a-z0-9-]+$)', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 'KFC-ES',  // uppercase — violates ^[a-z0-9-]+$ pattern
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-4. chainSlug with spaces → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 'burger king es',  // spaces — violates ^[a-z0-9-]+$
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-5. chainSlug with underscore → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 'kfc_es',  // underscore — violates ^[a-z0-9-]+$
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-6. chainSlug empty string → 400 VALIDATION_ERROR (minLength: 1)', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: '',
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-7. chainSlug exactly 100 chars (max boundary) → accepted by Zod validation', async () => {
    const slug = 'a'.repeat(97) + '-es';  // 100 chars, valid pattern
    expect(slug.length).toBe(100);

    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([GENERIC_NUTRITION_TEXT]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
      chainSlug: slug,
    }));

    // Should NOT be a Zod validation error — the slug is within the 100 char limit
    expect(response.statusCode).not.toBe(400);
    const body = JSON.parse(response.body) as { error?: { code: string } };
    expect(body.error?.code).not.toBe('VALIDATION_ERROR');
  });

  it('CS-8. chainSlug exactly 101 chars (one over max) → 400 VALIDATION_ERROR', async () => {
    const slug = 'a'.repeat(98) + '-es';  // 101 chars
    expect(slug.length).toBe(101);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: slug,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-9. chainSlug with pipe character → 400 VALIDATION_ERROR (injection attempt)', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 'kfc-es|evil',
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-10. chainSlug with newline character → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 'kfc-es\nevil',
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-11. Valid but unknown chainSlug → passthrough, generic parser runs, 200 if data found', async () => {
    // "dominos-es" is a valid slug format but not in CHAIN_PDF_REGISTRY.
    // preprocessChainText returns lines unchanged for unknown slugs.
    // The generic parser should still work if the text has a recognizable nutrition table.
    mockDownloadPdf.mockResolvedValue(FAKE_PDF_BUFFER);
    mockExtractText.mockResolvedValue([GENERIC_NUTRITION_TEXT]);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
      chainSlug: 'dominos-es',
    }));

    // Should succeed — unknown slug triggers passthrough, generic text is parseable
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { dishesFound: number } };
    expect(body.data.dishesFound).toBeGreaterThanOrEqual(1);
  });

  it('CS-12. chainSlug as number type → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: 42,
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });

  it('CS-13. chainSlug as array → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu.pdf',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      chainSlug: ['kfc-es'],
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockDownloadPdf).not.toHaveBeenCalled();
  });
});
