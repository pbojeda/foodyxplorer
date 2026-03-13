// Integration tests for POST /ingest/url
//
// Uses buildApp() + .inject() to test the full route pipeline.
// Mocks htmlFetcher.fetchHtml via vi.mock to avoid real Playwright launches.
// Uses real test DB for DB existence checks and upsert verification.
//
// vi.mock must be at the top level before any imports.

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mock fetchHtml — isolates the route from Playwright/Crawlee
// ---------------------------------------------------------------------------

vi.mock('../../../lib/htmlFetcher.js', () => ({
  fetchHtml: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../app.js';
import { fetchHtml } from '../../../lib/htmlFetcher.js';

const mockFetchHtml = fetchHtml as ReturnType<typeof vi.fn>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../fixtures/html');

function loadFixtureHtml(filename: string): string {
  return readFileSync(join(fixturesDir, filename), 'utf-8');
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

// Deterministic UUIDs in e100 namespace (distinct from e000 used by pdf.test.ts)
const TEST_RESTAURANT_ID = 'e1000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e1000000-0000-4000-a000-000000000002';
const NONEXISTENT_ID = 'f1000000-0000-4000-a000-000000000099';

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
      name: 'URL Ingest Test Source',
      type: 'scraped',
    },
  });

  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'URL Test Restaurant',
      chainSlug: 'url-test-restaurant',
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
  mockFetchHtml.mockReset();
  // Clean up any dishes created in previous tests
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
});

// ---------------------------------------------------------------------------
// Helper to make a JSON POST request
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    url: '/ingest/url',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /ingest/url', () => {
  it('1. Happy path — Spanish nutritional table, live run → 200 with dishes', async () => {
    mockFetchHtml.mockResolvedValue(loadFixtureHtml('sample-nutrition-table.html'));

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
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
    expect(body.data.sourceUrl).toBe('https://example.com/menu');

    // Verify at least one Dish row exists in DB
    const dishes = await prisma.dish.findMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    expect(dishes.length).toBeGreaterThanOrEqual(1);
  });

  it('2. dryRun: true — no DB writes, dishesUpserted === 0', async () => {
    mockFetchHtml.mockResolvedValue(loadFixtureHtml('sample-nutrition-table.html'));

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
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

  it('5. url with file:// scheme → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'file:///etc/passwd',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('6. url resolving to localhost → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://localhost/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('7. url resolving to 127.0.0.1 → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://127.0.0.1/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('8. url resolving to link-local 169.254.169.254 → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://169.254.169.254/',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('9. Non-existent restaurantId → 404 NOT_FOUND', async () => {
    // fetchHtml should NOT be called (DB check runs first)
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockFetchHtml).not.toHaveBeenCalled();
  });

  it('10. Non-existent sourceId → 404 NOT_FOUND', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: NONEXISTENT_ID,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('11. fetchHtml throws FETCH_FAILED → 422 FETCH_FAILED', async () => {
    mockFetchHtml.mockRejectedValue(
      Object.assign(new Error('Failed to fetch URL'), { code: 'FETCH_FAILED', statusCode: 422 }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('12. fetchHtml throws SCRAPER_BLOCKED → 422 SCRAPER_BLOCKED', async () => {
    mockFetchHtml.mockRejectedValue(
      Object.assign(
        new Error('Access blocked by target server'),
        { code: 'SCRAPER_BLOCKED', statusCode: 422 },
      ),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('SCRAPER_BLOCKED');
  });

  it('13. Page with no extractable text → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    mockFetchHtml.mockResolvedValue(loadFixtureHtml('empty.html'));

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  it('14. Page text has no nutritional table → 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    mockFetchHtml.mockResolvedValue(loadFixtureHtml('no-nutrients.html'));

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  });

  it('15. Partial success — some dishes skipped → 200 with skippedReasons', async () => {
    // Valid dish "Pollo asado" with enough nutrients,
    // plus "Mega Combo" with calories > 9000 which will be skipped by normalizeNutrients
    mockFetchHtml.mockResolvedValue(`
      <html><body>
        <table>
          <tr><th>Plato</th><th>Calorías</th><th>Proteínas</th><th>Hidratos</th><th>Grasas</th><th>Sal</th></tr>
          <tr><td>Pollo asado</td><td>300</td><td>28</td><td>5</td><td>15</td><td>1</td></tr>
          <tr><td>Mega Combo</td><td>9999</td><td>100</td><td>200</td><td>300</td><td>5</td></tr>
        </table>
      </body></html>
    `);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
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

  it('16. dryRun: true with nonexistent restaurantId → 404 NOT_FOUND', async () => {
    // DB check runs regardless of dryRun
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: NONEXISTENT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('17. Salt/sodium derivation — sodium derived from sal column', async () => {
    // Only "Sal" column, no "Sodio" — normalizeNutrients should derive sodium from salt
    // salt = 2g → sodium = (2 / 2.5) * 1000 = 800 mg
    mockFetchHtml.mockResolvedValue(`
      <html><body>
        <table>
          <tr><th>Plato</th><th>Calorías</th><th>Proteínas</th><th>Hidratos</th><th>Grasas</th><th>Sal</th></tr>
          <tr><td>Caldo de verduras</td><td>180</td><td>6</td><td>28</td><td>5</td><td>2</td></tr>
        </table>
      </body></html>
    `);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
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
});
