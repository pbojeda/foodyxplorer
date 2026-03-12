// Integration tests for POST /ingest/pdf
//
// Uses buildApp() + .inject() to test the full route pipeline.
// Mocks pdfParser.extractText via vi.mock to control text input.
// Uses real test DB for DB existence checks and upsert verification.
//
// vi.mock must be at the top level before any imports.

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mock pdfParser.extractText — isolates the route from the pdf-parse library
// ---------------------------------------------------------------------------

vi.mock('../../../lib/pdfParser.js', () => ({
  extractText: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../app.js';
import { extractText } from '../../../lib/pdfParser.js';

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

// Deterministic UUIDs in e000 namespace (outside existing seed namespaces)
const TEST_RESTAURANT_ID = 'e0000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e0000000-0000-4000-a000-000000000002';
const NONEXISTENT_ID = 'f0000000-0000-4000-a000-000000000099';

// Minimal PDF magic bytes — passes the %PDF- check
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake content for testing');
const FAKE_PNG_BUFFER = Buffer.from('\x89PNG\r\n\x1a\n fake png content');

// ---------------------------------------------------------------------------
// Multipart body builder
// ---------------------------------------------------------------------------

interface MultipartField {
  name: string;
  value: string;
}

interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

function buildMultipartBody(
  boundary: string,
  fields: MultipartField[],
  file?: MultipartFile,
): Buffer {
  const parts: Buffer[] = [];
  const CRLF = '\r\n';

  for (const field of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${field.name}"${CRLF}` +
        CRLF +
        `${field.value}${CRLF}`,
      ),
    );
  }

  if (file !== undefined) {
    parts.push(
      Buffer.concat([
        Buffer.from(
          `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${CRLF}` +
          `Content-Type: ${file.contentType}${CRLF}` +
          CRLF,
        ),
        file.data,
        Buffer.from(CRLF),
      ]),
    );
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  return Buffer.concat(parts);
}

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
      name: 'PDF Ingest Test Source',
      type: 'scraped',
    },
  });

  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'PDF Test Restaurant',
      chainSlug: 'pdf-test-restaurant',
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
  mockExtractText.mockReset();
  // Clean up any dishes created in previous tests
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
});

// ---------------------------------------------------------------------------
// Helper to make a valid multipart request
// ---------------------------------------------------------------------------

function makeRequest(opts: {
  restaurantId?: string;
  sourceId?: string;
  dryRun?: string;
  fileBuffer?: Buffer;
  fileContentType?: string;
  includeFile?: boolean;
}) {
  const boundary = 'test-boundary-12345';
  const fields: MultipartField[] = [];

  if (opts.restaurantId !== undefined) {
    fields.push({ name: 'restaurantId', value: opts.restaurantId });
  }
  if (opts.sourceId !== undefined) {
    fields.push({ name: 'sourceId', value: opts.sourceId });
  }
  if (opts.dryRun !== undefined) {
    fields.push({ name: 'dryRun', value: opts.dryRun });
  }

  const includeFile = opts.includeFile ?? true;
  const file: MultipartFile | undefined = includeFile
    ? {
        name: 'file',
        filename: 'menu.pdf',
        contentType: opts.fileContentType ?? 'application/pdf',
        data: opts.fileBuffer ?? FAKE_PDF_BUFFER,
      }
    : undefined;

  const body = buildMultipartBody(boundary, fields, file);

  return {
    method: 'POST' as const,
    url: '/ingest/pdf',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /ingest/pdf', () => {
  it('1. Happy path — Spanish table, live run returns 200 with dishes', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
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
        dishes: unknown[];
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.dishesFound).toBeGreaterThanOrEqual(1);
    expect(body.data.dishesUpserted).toBeGreaterThanOrEqual(1);
    expect(body.data.dryRun).toBe(false);

    // Verify at least one Dish row exists in DB
    const dishes = await prisma.dish.findMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    expect(dishes.length).toBeGreaterThanOrEqual(1);
  });

  it('2. dryRun: true — no DB writes, dishesUpserted === 0', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 'true',
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

  it('3. Missing file part → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      includeFile: false,
    }));

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('4. Missing restaurantId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      sourceId: TEST_SOURCE_ID,
      // no restaurantId
    }));

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('5. Invalid UUID for restaurantId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      restaurantId: 'not-a-uuid',
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('6. Non-existent restaurantId (valid UUID, no row) → 404 NOT_FOUND', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('7. Non-existent sourceId → 404 NOT_FOUND', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: NONEXISTENT_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('8. File is not PDF (PNG magic bytes) → 422 INVALID_PDF', async () => {
    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      fileBuffer: FAKE_PNG_BUFFER,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PDF');

    // extractText should NOT have been called
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it('9. Image-based PDF (no extractable text) → 422 UNSUPPORTED_PDF', async () => {
    mockExtractText.mockRejectedValue(
      Object.assign(new Error('PDF contains no extractable text'), {
        statusCode: 422,
        code: 'UNSUPPORTED_PDF',
      }),
    );

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_PDF');
  });

  it('10. PDF with no nutritional table → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    const lines = loadFixtureLines('no-nutrients.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  it('11. All dishes fail normalization → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    // Lines with only 3 numeric tokens each — parser returns empty array
    mockExtractText.mockResolvedValue([
      'Calorías Proteínas Hidratos Grasas Sal\nPlato A 200 10 20\nPlato B 300 15 30',
    ]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  it('12. Partial success — some dishes skipped → 200 with skippedReasons', async () => {
    // Mix of valid rows and rows without enough nutrients (missing calories etc.)
    // Valid: "Pollo asado" has 4 numeric tokens including calories, proteins, carbs, fats
    // Invalid: a row parsed by parser that fails normalizeNutrients
    // We use a fixture where some rows only have 4 tokens (will be parsed)
    // but their values will fail the normalization calorie > 9000 check
    mockExtractText.mockResolvedValue([
      [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Pollo asado 300 28 5 15 1',
        'Mega Combo 9999 100 200 300 5',  // calories > 9000 — skipped by normalizeNutrients
      ].join('\n'),
    ]);

    const response = await app.inject(makeRequest({
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
    expect(body.data.skippedReasons).toBeDefined();
    expect(Array.isArray(body.data.skippedReasons)).toBe(true);
    expect(body.data.skippedReasons.length).toBeGreaterThanOrEqual(1);

    const firstSkip = body.data.skippedReasons[0];
    expect(firstSkip).toHaveProperty('dishName');
    expect(firstSkip).toHaveProperty('reason');
  });

  it('13. Salt/sodium derivation — sal column only derives sodium', async () => {
    // Only "sal" column, no "sodio" — normalizeNutrients should derive sodium from salt
    mockExtractText.mockResolvedValue([
      [
        'Calorías Proteínas Hidratos Grasas Sal',
        'Caldo de verduras 180 6 28 5 2',
      ].join('\n'),
    ]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 'true',
    }));

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as {
      data: { dishes: Array<{ nutrients: { sodium: number; salt: number } }> };
    };

    expect(body.data.dishes.length).toBeGreaterThanOrEqual(1);

    const dish = body.data.dishes[0];
    expect(dish).toBeDefined();
    expect(dish?.nutrients.sodium).toBeGreaterThan(0);
    // salt = 2, sodium = (2 / 2.5) * 1000 = 800
    expect(dish?.nutrients.sodium).toBeCloseTo(800, 0);
  });

  it('14. MIME application/octet-stream with PDF magic bytes → accepted', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      fileContentType: 'application/octet-stream',
    }));

    expect(response.statusCode).toBe(200);
  });

  it('15. dryRun: true with non-existent restaurantId → 404', async () => {
    const lines = loadFixtureLines('sample-nutrition-table.txt');
    mockExtractText.mockResolvedValue([lines.join('\n')]);

    const response = await app.inject(makeRequest({
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 'true',
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
