// Edge-case and security tests for POST /ingest/url
//
// These tests target gaps in the existing url.test.ts:
// - SSRF bypass vectors not covered by the SSRF_BLOCKED regex
// - URL validation boundary conditions (max-length)
// - Missing PROCESSING_TIMEOUT integration test (spec §16.3)
// - fetchHtml crash path (run() throws directly)
// - dryRun defaulting to false when field is omitted
// - All-dishes-fail-normalization returning 422
//
// NOTE: vi.useFakeTimers() is NOT used here to avoid contaminating other tests.
// The PROCESSING_TIMEOUT test uses a mock that immediately rejects with the
// PROCESSING_TIMEOUT error, which is the observable contract for the route.

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fetchHtml — must be hoisted before any imports
// ---------------------------------------------------------------------------
vi.mock('../../../lib/htmlFetcher.js', () => ({
  fetchHtml: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../app.js';
import { fetchHtml } from '../../../lib/htmlFetcher.js';

const mockFetchHtml = fetchHtml as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test DB setup — use e2xx namespace to avoid collisions with url.test.ts
// ---------------------------------------------------------------------------
const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL_TEST } },
});

const TEST_RESTAURANT_ID = 'e2000000-0000-4000-a000-000000000001';
const TEST_SOURCE_ID = 'e2000000-0000-4000-a000-000000000002';

let app: FastifyInstance;

beforeAll(async () => {
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });

  await prisma.dataSource.create({
    data: { id: TEST_SOURCE_ID, name: 'URL Edge-Case Test Source', type: 'scraped' },
  });
  await prisma.restaurant.create({
    data: {
      id: TEST_RESTAURANT_ID,
      name: 'URL Edge-Case Test Restaurant',
      chainSlug: 'url-edge-case-test',
      countryCode: 'ES',
    },
  });

  app = await buildApp({ prisma });
}, 30_000);

afterAll(async () => {
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
  await prisma.restaurant.deleteMany({ where: { id: TEST_RESTAURANT_ID } });
  await prisma.dataSource.deleteMany({ where: { id: TEST_SOURCE_ID } });
  await prisma.$disconnect();
  await app.close();
}, 30_000);

afterEach(async () => {
  mockFetchHtml.mockReset();
  await prisma.dishNutrient.deleteMany({ where: { dish: { restaurantId: TEST_RESTAURANT_ID } } });
  await prisma.dish.deleteMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
});

function makeRequest(body: Record<string, unknown>) {
  return {
    method: 'POST' as const,
    url: '/ingest/url',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Minimal valid nutritional HTML used in several tests
// ---------------------------------------------------------------------------
const VALID_NUTRITION_HTML = `
  <html><body>
    <table>
      <tr><th>Plato</th><th>Calorías</th><th>Proteínas</th><th>Hidratos</th><th>Grasas</th><th>Sal</th></tr>
      <tr><td>Pollo asado</td><td>300</td><td>28</td><td>5</td><td>15</td><td>1</td></tr>
    </table>
  </body></html>
`;

// ---------------------------------------------------------------------------
// SSRF bypass vectors — IPv4-mapped IPv6 (Node.js hex normalization)
//
// Node.js WHATWG URL normalizes IPv4-mapped IPv6 addresses to hex notation:
//   [::ffff:127.0.0.1] → hostname "[::ffff:7f00:1]"
//   [::ffff:192.168.1.1] → hostname "[::ffff:c0a8:101]"
//
// The original fix attempt added \[?::ffff:127\.\d+...\]? to SSRF_BLOCKED,
// but this pattern never matches because Node.js produces HEX segments, not
// dotted-decimal after the ::ffff: prefix.
//
// The correct fix: add a dedicated SSRF_BLOCKED_IPV4_MAPPED check that blocks
// ALL ::ffff: addresses (there is no valid API use case for IPv4-mapped IPv6).
// ---------------------------------------------------------------------------

describe('SSRF guard — IPv4-mapped IPv6 (Node.js hex normalization)', () => {
  it('[::ffff:127.0.0.1] is blocked → 422 INVALID_URL', async () => {
    // Node.js hostname = "[::ffff:7f00:1]" — must be caught by ::ffff: prefix check
    const response = await app.inject(makeRequest({
      url: 'http://[::ffff:127.0.0.1]/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('[::ffff:192.168.1.1] is blocked → 422 INVALID_URL', async () => {
    // Node.js hostname = "[::ffff:c0a8:101]" — also caught by ::ffff: prefix check
    const response = await app.inject(makeRequest({
      url: 'http://[::ffff:192.168.1.1]/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });
});

describe('SSRF guard — existing protections still work', () => {
  it('localhost is blocked → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://localhost/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('127.0.0.1 is blocked → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://127.0.0.1/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('169.254.169.254 (AWS metadata endpoint) is blocked → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://169.254.169.254/',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('10.0.0.1 is blocked → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://10.0.0.1/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('192.168.1.1 is blocked → 422 INVALID_URL', async () => {
    const response = await app.inject(makeRequest({
      url: 'http://192.168.1.1/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_URL');
  });
});

// ---------------------------------------------------------------------------
// URL validation boundary conditions
// ---------------------------------------------------------------------------

describe('URL field validation boundaries', () => {
  it('url at exactly 2048 characters is accepted', async () => {
    const base = 'https://example.com/';
    const padding = 'a'.repeat(2048 - base.length);
    const longUrl = base + padding;
    expect(longUrl.length).toBe(2048);

    mockFetchHtml.mockResolvedValue(VALID_NUTRITION_HTML);

    const response = await app.inject(makeRequest({
      url: longUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    // Should NOT be 400 — a 2048-char URL is at the limit, which is allowed
    expect(response.statusCode).not.toBe(400);
  }, 15_000);

  it('url at 2049 characters is rejected → 400 VALIDATION_ERROR', async () => {
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
  }, 10_000);

  it('missing restaurantId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  }, 10_000);

  it('missing sourceId → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
    }));
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  }, 10_000);

  it('restaurantId that is not a UUID → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: 'not-a-uuid',
      sourceId: TEST_SOURCE_ID,
    }));
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  }, 10_000);

  it('dryRun supplied as string "true" is rejected → 400 VALIDATION_ERROR', async () => {
    // Spec §5.1: dryRun is a native boolean (JSON body, not multipart)
    // Unlike F007b, no string transform is applied — sending "true" must be rejected
    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: 'true', // string, not boolean
    }));

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  }, 10_000);

  it('empty JSON body → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject(makeRequest({}));
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  }, 10_000);
});

// ---------------------------------------------------------------------------
// dryRun default behavior
// ---------------------------------------------------------------------------

describe('dryRun defaults to false when omitted', () => {
  it('omitting dryRun defaults to false — DB writes occur', async () => {
    mockFetchHtml.mockResolvedValue(VALID_NUTRITION_HTML);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
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

    // Verify the dish was actually written to the DB
    const dishes = await prisma.dish.findMany({ where: { restaurantId: TEST_RESTAURANT_ID } });
    expect(dishes.length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Processing timeout (spec §16.3 — listed but absent from url.test.ts)
//
// We do not use vi.useFakeTimers() here because it conflicts with Fastify's
// async machinery. Instead we simulate the timeout by having fetchHtml
// throw a PROCESSING_TIMEOUT error immediately — this tests that the route
// correctly propagates this error code as 408, which is the only observable
// behaviour from the caller's perspective regardless of how the timeout fires.
// ---------------------------------------------------------------------------

describe('Processing timeout (spec §16.3)', () => {
  it('PROCESSING_TIMEOUT error from processing pipeline → 408 PROCESSING_TIMEOUT', async () => {
    // Simulate what the internal timeout guard does: reject with PROCESSING_TIMEOUT
    mockFetchHtml.mockRejectedValue(
      Object.assign(new Error('Processing timeout'), {
        code: 'PROCESSING_TIMEOUT',
        statusCode: 408,
      }),
    );

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(408);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('PROCESSING_TIMEOUT');
  }, 10_000);
});

// ---------------------------------------------------------------------------
// All-dishes-fail-normalization → 422 NO_NUTRITIONAL_DATA_FOUND
// (spec §16.3: "All dishes fail normalization → 422 NO_NUTRITIONAL_DATA_FOUND")
// This path is NOT exercised by url.test.ts test #15 (which tests partial skip).
// ---------------------------------------------------------------------------

describe('All dishes fail normalization', () => {
  it('returns 422 NO_NUTRITIONAL_DATA_FOUND when every parsed dish fails normalizeNutrients', async () => {
    // Dish names must NOT contain trailing digits — parseDataRow uses the first
    // numeric token as the name boundary, so "Plato A" (no digits in name) ensures
    // the first column value (9999 / 9001) is correctly mapped to 'calories'.
    // Both dishes have calories > 9000 so normalizeNutrients returns null for all.
    mockFetchHtml.mockResolvedValue(`
      <html><body>
        <table>
          <tr><th>Plato</th><th>Calorías</th><th>Proteínas</th><th>Hidratos</th><th>Grasas</th><th>Sal</th></tr>
          <tr><td>Hamburguesa enorme</td><td>9999</td><td>100</td><td>200</td><td>300</td><td>5</td></tr>
          <tr><td>Pizza gigante</td><td>9001</td><td>80</td><td>150</td><td>200</td><td>4</td></tr>
        </table>
      </body></html>
    `);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Response shape — spec §9.1 / IngestUrlResultSchema
// ---------------------------------------------------------------------------

describe('Response shape', () => {
  it('success response contains all required top-level fields from IngestUrlResultSchema', async () => {
    mockFetchHtml.mockResolvedValue(VALID_NUTRITION_HTML);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/nutritional-page',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: Record<string, unknown>;
    };

    expect(body.success).toBe(true);
    const data = body.data;
    // Verify all fields defined in IngestUrlResultSchema are present
    expect(typeof data['dishesFound']).toBe('number');
    expect(typeof data['dishesUpserted']).toBe('number');
    expect(typeof data['dishesSkipped']).toBe('number');
    expect(typeof data['dryRun']).toBe('boolean');
    // sourceUrl is unique to F007c — not in F007b response
    expect(typeof data['sourceUrl']).toBe('string');
    expect(Array.isArray(data['dishes'])).toBe(true);
    expect(Array.isArray(data['skippedReasons'])).toBe(true);
  }, 15_000);

  it('sourceUrl in response exactly matches the submitted URL', async () => {
    const submittedUrl = 'https://www.example-restaurant.es/nutricion.html';
    mockFetchHtml.mockResolvedValue(VALID_NUTRITION_HTML);

    const response = await app.inject(makeRequest({
      url: submittedUrl,
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { sourceUrl: string } };
    expect(body.data.sourceUrl).toBe(submittedUrl);
  }, 15_000);

  it('dishesFound reflects raw parsed count before normalization skips', async () => {
    // 2 dishes parsed; 1 skipped → dishesFound=2, dishesSkipped=1
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
      dryRun: true,
    }));

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        dishesFound: number;
        dishesUpserted: number;
        dishesSkipped: number;
      };
    };
    // dishesFound counts raw parsed dishes (before normalization)
    expect(body.data.dishesFound).toBe(2);
    expect(body.data.dishesUpserted).toBe(0); // dryRun
    expect(body.data.dishesSkipped).toBe(1);
  }, 15_000);

  it('skippedReasons entries contain non-empty dishName and reason strings', async () => {
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
      dryRun: true,
    }));

    const body = JSON.parse(response.body) as {
      data: { skippedReasons: Array<{ dishName: string; reason: string }> };
    };
    expect(body.data.skippedReasons.length).toBeGreaterThanOrEqual(1);
    const reason = body.data.skippedReasons[0];
    expect(reason).toBeDefined();
    expect(typeof reason?.dishName).toBe('string');
    expect(typeof reason?.reason).toBe('string');
    expect(reason?.dishName.length).toBeGreaterThan(0);
    expect(reason?.reason.length).toBeGreaterThan(0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// htmlTextExtractor edge cases exercised via route (noise tags)
// ---------------------------------------------------------------------------

describe('htmlTextExtractor noise-tag filtering (via route)', () => {
  it('HTML with only <noscript> content returns 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    // noscript is in NOISE_TAGS — its content is stripped before extraction
    mockFetchHtml.mockResolvedValue(`
      <html><body>
        <noscript>
          <table>
            <tr><th>Plato</th><th>Calorías</th></tr>
            <tr><td>Pollo</td><td>300</td></tr>
          </table>
        </noscript>
      </body></html>
    `);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  }, 15_000);

  it('HTML with a nutritional table inside <nav> returns 422 NO_NUTRITIONAL_DATA_FOUND', async () => {
    // nav is a noise tag — its entire subtree (including nested tables) is removed
    mockFetchHtml.mockResolvedValue(`
      <html><body>
        <nav>
          <table>
            <tr><th>Plato</th><th>Calorías</th></tr>
            <tr><td>Pollo</td><td>300</td></tr>
          </table>
        </nav>
      </body></html>
    `);

    const response = await app.inject(makeRequest({
      url: 'https://example.com/menu',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
  }, 15_000);
});

// ---------------------------------------------------------------------------
// ftp:// scheme (spec §5.2 — only http/https allowed)
// ---------------------------------------------------------------------------

describe('Non-http/https URL schemes', () => {
  it('ftp:// scheme → rejected (400 or 422 INVALID_URL)', async () => {
    // ftp:// may be rejected by Zod (→ 400 VALIDATION_ERROR) or by the scheme
    // check (→ 422 INVALID_URL). Either is correct; what must NOT happen is 200.
    const response = await app.inject(makeRequest({
      url: 'ftp://ftp.example.com/menu.txt',
      restaurantId: TEST_RESTAURANT_ID,
      sourceId: TEST_SOURCE_ID,
    }));

    expect([400, 422]).toContain(response.statusCode);
    // 200 is never acceptable for a non-http/https scheme
    expect(response.statusCode).not.toBe(200);
  }, 10_000);
});
