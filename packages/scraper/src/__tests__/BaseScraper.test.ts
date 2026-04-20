// BaseScraper unit tests.
//
// TestScraper extends BaseScraper inside this test file. It overrides:
// - createCrawler() to return a duck-typed mock that calls the request handler
//   synchronously with controlled test data (no real Playwright/Crawlee).
// - persist() overridden per-test via vi.spyOn.
//
// This allows testing the full run() orchestration logic without any browser.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright';
import { BaseScraper } from '../base/BaseScraper.js';
import { NotImplementedError } from '../base/errors.js';
import type {
  ScraperConfig,
  ScraperResult,
  RawDishData,
  NormalizedDishData,
} from '../base/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseConfig: ScraperConfig = {
  chainSlug: 'test-chain',
  restaurantId: 'a1b2c3d4-0000-4000-a000-000000000001',
  sourceId: 'a1b2c3d4-0000-4000-a000-000000000002',
  baseUrl: 'https://example.com',
  startUrls: ['https://example.com/menu'],
  rateLimit: {
    requestsPerMinute: 10,
    concurrency: 1,
  },
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
  selectors: {},
  headless: true,
  locale: 'es-ES',
};

function makeRawDish(overrides: Partial<RawDishData> = {}): RawDishData {
  return {
    name: 'Test Dish',
    aliases: [],
    nutrients: {
      calories: 400,
      proteins: 20,
      carbohydrates: 50,
      fats: 10,
      sugars: 5,
      saturatedFats: 3,
      fiber: 2,
      salt: 0.5,
      sodium: 200,
    },
    sourceUrl: 'https://example.com/menu/test-dish',
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TestScraper concrete implementation
// ---------------------------------------------------------------------------

/**
 * Minimal concrete scraper for testing. Does not use a real Crawlee crawler —
 * instead, createCrawler() returns a mock that drives the lifecycle directly.
 *
 * The mock crawler's run() method iterates over the start URLs and calls the
 * request handler once per URL with a synthetic request object.
 */
class TestScraper extends BaseScraper {
  // Controlled outputs — tests set these before calling run()
  menuUrls: string[] = ['https://example.com/menu/page1'];
  rawDishes: RawDishData[] = [];
  extractError: Error | null = null;

  override async extractDishes(_page: Page): Promise<RawDishData[]> {
    if (this.extractError !== null) throw this.extractError;
    return this.rawDishes;
  }

  override async getMenuUrls(_page: Page): Promise<string[]> {
    return this.menuUrls;
  }

  // Override createCrawler to return a mock that avoids real Playwright
  protected override createCrawler(
    requestHandler: (ctx: { page: Page; request: { url: string; userData: Record<string, unknown> } }) => Promise<void>,
    failedRequestHandler: (ctx: { request: { url: string }; error: Error }) => Promise<void>,
  ): PlaywrightCrawler {
    // Duck-typed mock — only `run()` is used by BaseScraper.
    // Accepts a requests array parameter, matching the real Crawlee API.
    const mockCrawler = {
      async run(requests?: Array<{ url: string; userData?: Record<string, unknown> }>): Promise<void> {
        const reqs = requests ?? [];
        for (const req of reqs) {
          const mockPage = {} as Page;
          const userData = req.userData ?? {};
          try {
            await requestHandler({
              page: mockPage,
              request: { url: req.url, userData },
            });
          } catch (err) {
            await failedRequestHandler({
              request: { url: req.url },
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        }
      },
    } as unknown as PlaywrightCrawler;

    return mockCrawler;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseScraper', () => {
  let scraper: TestScraper;
  let persistSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scraper = new TestScraper(baseConfig);
    // Mock persist() to avoid NotImplementedError in run() tests
    persistSpy = vi
      .spyOn(scraper as unknown as { persistDish: () => Promise<void> }, 'persistDish')
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // run() — basic result shape
  // -------------------------------------------------------------------------

  it('run() returns a ScraperResult with status: success when extractDishes returns []', async () => {
    scraper.rawDishes = [];
    const result: ScraperResult = await scraper.run();

    expect(result.status).toBe('success');
    expect(result.dishesFound).toBe(0);
    expect(result.dishesUpserted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.chainSlug).toBe('test-chain');
  });

  it('run() returns pagesVisited: 1 when one menu URL is crawled', async () => {
    scraper.rawDishes = [];
    scraper.menuUrls = ['https://example.com/menu/page1'];
    const result = await scraper.run();
    expect(result.pagesVisited).toBe(1);
  });

  it('run() increments dishesFound for each raw dish returned by extractDishes', async () => {
    scraper.rawDishes = [makeRawDish(), makeRawDish({ name: 'Dish 2' })];
    const result = await scraper.run();
    expect(result.dishesFound).toBe(2);
  });

  it('run() increments dishesUpserted for each successfully normalized and persisted dish', async () => {
    scraper.rawDishes = [makeRawDish(), makeRawDish({ name: 'Dish 2' })];
    const result = await scraper.run();
    expect(result.dishesUpserted).toBe(2);
    expect(persistSpy).toHaveBeenCalledTimes(2);
  });

  it('run() increments dishesSkipped when normalize() returns null', async () => {
    // A dish with missing required nutrients — normalize() will return null
    scraper.rawDishes = [
      makeRawDish({
        nutrients: {
          // Missing calories → normalizeNutrients returns null
          proteins: 10,
          carbohydrates: 20,
          fats: 5,
        },
      }),
    ];
    const result = await scraper.run();
    expect(result.dishesSkipped).toBe(1);
    expect(result.dishesUpserted).toBe(0);
  });

  it('run() records an error in errors[] and continues when extractDishes throws', async () => {
    // Use a config with maxRetries: 0 to avoid retry delays in this test
    const noRetryConfig: ScraperConfig = {
      ...baseConfig,
      retryPolicy: { maxRetries: 0, backoffMs: 100, backoffMultiplier: 2 },
    };
    scraper = new TestScraper(noRetryConfig);
    persistSpy = vi
      .spyOn(scraper as unknown as { persistDish: () => Promise<void> }, 'persistDish')
      .mockResolvedValue(undefined);
    scraper.extractError = new Error('selector not found');
    // Add a second URL so we can verify it continues after the first failure
    scraper.menuUrls = [
      'https://example.com/menu/page1',
      'https://example.com/menu/page2',
    ];
    const result = await scraper.run();
    expect(result.errors.length).toBeGreaterThan(0);
    // pagesVisited counts even pages that errored
    expect(result.pagesVisited).toBeGreaterThanOrEqual(1);
  });

  it('run() sets status: partial when dishesSkipped > 0 and dishesUpserted > 0', async () => {
    scraper.rawDishes = [
      makeRawDish({ name: 'Good Dish' }),
      makeRawDish({
        name: 'Bad Dish',
        nutrients: {
          // Missing calories → skipped
          proteins: 10,
          carbohydrates: 20,
          fats: 5,
        },
      }),
    ];
    const result = await scraper.run();
    expect(result.status).toBe('partial');
    expect(result.dishesUpserted).toBe(1);
    expect(result.dishesSkipped).toBe(1);
  });

  it('run() sets status: failed when dishesUpserted === 0 after all pages', async () => {
    // All dishes fail normalization
    scraper.rawDishes = [
      makeRawDish({
        nutrients: { proteins: 10, carbohydrates: 20, fats: 5 },
      }),
    ];
    const result = await scraper.run();
    expect(result.status).toBe('failed');
    expect(result.dishesUpserted).toBe(0);
  });

  it('run() sets startedAt and finishedAt as valid ISO datetime strings with finishedAt >= startedAt', async () => {
    scraper.rawDishes = [];
    const result = await scraper.run();

    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.finishedAt)).not.toThrow();
    expect(new Date(result.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.startedAt).getTime(),
    );
  });

  // -------------------------------------------------------------------------
  // normalize()
  // -------------------------------------------------------------------------

  it('normalize() returns null when normalizeNutrients returns null', () => {
    const raw = makeRawDish({
      nutrients: {
        // Missing calories
        proteins: 10,
        carbohydrates: 20,
        fats: 5,
      },
    });
    // Access protected method via cast
    const result = (scraper as unknown as { normalize: (r: RawDishData) => NormalizedDishData | null }).normalize(raw);
    expect(result).toBeNull();
  });

  it('normalize() returns a valid NormalizedDishData when all required fields are present', () => {
    const raw = makeRawDish();
    const result = (scraper as unknown as { normalize: (r: RawDishData) => NormalizedDishData | null }).normalize(raw);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Test Dish');
    expect(result?.nutrients.calories).toBe(400);
    expect(result?.confidenceLevel).toBe('medium');
    expect(result?.estimationMethod).toBe('scraped');
  });

  // -------------------------------------------------------------------------
  // persist() stub
  // -------------------------------------------------------------------------

  it('persist() throws NotImplementedError (the F007 stub behaviour)', async () => {
    // Create a scraper WITHOUT mocking persistDish so the stub is triggered
    const rawScraper = new TestScraper(baseConfig);
    const normalized = makeRawDish();
    const normalizedDish = (rawScraper as unknown as { normalize: (r: RawDishData) => NormalizedDishData | null }).normalize(normalized);

    expect(normalizedDish).not.toBeNull();
    await expect(
      (rawScraper as unknown as { persist: (d: NormalizedDishData) => Promise<void> }).persist(normalizedDish!),
    ).rejects.toThrow(NotImplementedError);
  });
});
