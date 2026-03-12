// Abstract base class for all chain scrapers.
//
// Chain scrapers extend BaseScraper and implement two abstract methods:
//   - extractDishes(page): RawDishData[] — extracts raw dish data from a page
//   - getMenuUrls(page): string[] — returns menu/product URLs to crawl
//
// BaseScraper handles the full scrape lifecycle: Crawlee PlaywrightCrawler
// setup, retry, rate limiting, normalization, persistence, and result assembly.

import { PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright';
import { normalizeNutrients, normalizeDish } from '../utils/normalize.js';
import {
  NotImplementedError,
  ScraperError,
} from './errors.js';
import {
  NormalizedDishDataSchema,
} from './types.js';
import type {
  ScraperConfig,
  ScraperResult,
  RawDishData,
  NormalizedDishData,
} from './types.js';

// Internal request userData shape used to distinguish start URLs from menu URLs
interface ScraperRequestData {
  isStartUrl?: boolean;
  isMenuUrl?: boolean;
}

/**
 * Abstract base class for all chain scrapers.
 *
 * Chain scrapers extend this class and implement `extractDishes()` and
 * `getMenuUrls()`. All shared infrastructure (crawler lifecycle, retry, rate
 * limiting, normalization, persistence) lives here.
 */
export abstract class BaseScraper {
  /** Per-chain crawler configuration, set via constructor. */
  protected readonly config: ScraperConfig;

  /**
   * @param config - The full ScraperConfig for this chain. Chain scrapers
   *   pass their own static config object to `super(config)`.
   */
  constructor(config: ScraperConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Abstract methods — chain scrapers must implement these
  // -------------------------------------------------------------------------

  /**
   * Receives a Playwright Page already navigated to a menu/product URL.
   * Returns raw dish data as found on the page — no normalization applied yet.
   *
   * Must NOT throw for individual dish failures; instead return what can be
   * extracted. May return an empty array if no dishes are found on this page.
   *
   * @param page - Playwright Page object navigated to the menu URL.
   */
  abstract extractDishes(page: Page): Promise<RawDishData[]>;

  /**
   * Receives a Playwright Page navigated to one of the `startUrls`.
   * Returns the list of menu/product URLs to crawl.
   *
   * Used by the base class crawler to build the URL queue.
   *
   * @param page - Playwright Page object navigated to the start URL.
   */
  abstract getMenuUrls(page: Page): Promise<string[]>;

  // -------------------------------------------------------------------------
  // Concrete public methods
  // -------------------------------------------------------------------------

  /**
   * Orchestrates the full scrape lifecycle:
   * 1. Launch Crawlee PlaywrightCrawler with config.rateLimit settings.
   * 2. Navigate to each startUrl and call getMenuUrls().
   * 3. For each menu URL: navigate, call extractDishes(), normalize, persist.
   * 4. Collect errors, count results, return ScraperResult.
   *
   * Never throws — all failures are captured in `ScraperResult.errors`.
   */
  async run(): Promise<ScraperResult> {
    const startedAt = new Date().toISOString();

    let pagesVisited = 0;
    let dishesFound = 0;
    let dishesUpserted = 0;
    let dishesSkipped = 0;
    const errors: ScraperResult['errors'] = [];

    // Collect menu URLs discovered from start URLs
    const discoveredMenuUrls: string[] = [];

    const requestHandler = async (ctx: {
      page: Page;
      request: { url: string; userData: Record<string, unknown> };
    }): Promise<void> => {
      const { page, request } = ctx;
      const userData = request.userData as ScraperRequestData;

      if (userData['isStartUrl']) {
        // Phase 1: discover menu URLs
        try {
          const urls = await this.getMenuUrls(page);
          discoveredMenuUrls.push(...urls);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push({
            url: request.url,
            message: error.message,
            code:
              err instanceof ScraperError ? err.code : 'SCRAPER_ERROR',
          });
        }
        return;
      }

      // Phase 2: extract dishes from a menu URL
      pagesVisited += 1;

      let rawDishes: RawDishData[];
      try {
        rawDishes = await this.extractDishes(page);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({
          url: request.url,
          message: error.message,
          code:
            err instanceof ScraperError ? err.code : 'SCRAPER_ERROR',
        });
        return;
      }

      if (rawDishes.length === 0) {
        console.warn(
          `[BaseScraper:${this.config.chainSlug}] No dishes found on: ${request.url}`,
        );
      }

      dishesFound += rawDishes.length;

      for (const raw of rawDishes) {
        const normalized = this.normalize(raw);
        if (normalized === null) {
          dishesSkipped += 1;
          console.warn(
            `[BaseScraper:${this.config.chainSlug}] Skipped dish "${raw.name}" — normalization returned null`,
          );
          continue;
        }

        try {
          await this.persist(normalized);
          dishesUpserted += 1;
        } catch (err) {
          dishesSkipped += 1;
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(
            `[BaseScraper:${this.config.chainSlug}] Persist failed for "${raw.name}": ${error.message}`,
          );
        }
      }
    };

    const failedRequestHandler = async (ctx: {
      request: { url: string };
      error: Error;
    }): Promise<void> => {
      errors.push({
        url: ctx.request.url,
        message: ctx.error.message,
        code: ctx.error instanceof ScraperError ? ctx.error.code : 'SCRAPER_ERROR',
      });
    };

    const crawler = this.createCrawler(requestHandler, failedRequestHandler);
    await crawler.run();

    const finishedAt = new Date().toISOString();

    // Determine status
    let status: ScraperResult['status'];
    if (dishesUpserted === 0) {
      status = 'failed';
    } else if (dishesSkipped > 0) {
      status = 'partial';
    } else {
      status = 'success';
    }

    // Special case: if no dishes were found at all AND no errors, it's still success
    // (empty extraction is a valid outcome for an empty menu)
    if (dishesFound === 0 && errors.length === 0) {
      status = 'success';
    }

    return {
      chainSlug: this.config.chainSlug,
      startedAt,
      finishedAt,
      pagesVisited,
      dishesFound,
      dishesUpserted,
      dishesSkipped,
      errors,
      status,
    };
  }

  // -------------------------------------------------------------------------
  // Concrete protected methods
  // -------------------------------------------------------------------------

  /**
   * Normalizes a raw dish into a DB-ready `NormalizedDishData` object.
   *
   * Calls `normalizeNutrients()` and `normalizeDish()`, merges results, and
   * validates with `NormalizedDishDataSchema.safeParse()`.
   *
   * Returns `null` if normalization fails (missing required nutrient fields,
   * calorie ceiling exceeded, or Zod validation failure).
   *
   * @param raw - Raw dish data from `extractDishes()`.
   */
  protected normalize(raw: RawDishData): NormalizedDishData | null {
    const nutrients = normalizeNutrients(raw.nutrients);
    if (nutrients === null) return null;

    const dishFields = normalizeDish(raw, {
      sourceId: this.config.sourceId,
      restaurantId: this.config.restaurantId,
    });

    const merged = { ...dishFields, nutrients };
    const parsed = NormalizedDishDataSchema.safeParse(merged);

    if (!parsed.success) {
      console.warn(
        `[BaseScraper:${this.config.chainSlug}] Zod validation failed for "${raw.name}": ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  }

  /**
   * Persists a normalized dish to the database.
   *
   * Delegates to `persistDish()` which is a stub in F007.
   * F008 overrides `persistDish()` with the real Prisma upsert logic.
   *
   * @param normalized - Validated, DB-ready dish data.
   */
  protected async persist(normalized: NormalizedDishData): Promise<void> {
    await this.persistDish(normalized);
  }

  /**
   * Persistence implementation stub — overridden by F008 chain scrapers.
   *
   * Throws `NotImplementedError` in F007. This gives F008 a clean override
   * point without changing the public API of `BaseScraper`.
   *
   * @param _normalized - The normalized dish data to persist.
   */
  protected async persistDish(_normalized: NormalizedDishData): Promise<void> {
    throw new NotImplementedError(
      'persistDish is not implemented — awaiting F008',
    );
  }

  /**
   * Factory method for creating the Crawlee PlaywrightCrawler.
   *
   * Extracted as a protected method so that unit tests can override it to
   * return a mock crawler that drives the lifecycle without real Playwright.
   *
   * @param requestHandler - Handler called for each successfully fetched page.
   * @param failedRequestHandler - Handler called for failed requests.
   */
  protected createCrawler(
    requestHandler: (ctx: {
      page: Page;
      request: { url: string; userData: Record<string, unknown> };
    }) => Promise<void>,
    failedRequestHandler: (ctx: {
      request: { url: string };
      error: Error;
    }) => Promise<void>,
  ): PlaywrightCrawler {
    return new PlaywrightCrawler({
      launchContext: {
        launchOptions: {
          headless: this.config.headless,
        },
      },
      maxRequestsPerMinute: this.config.rateLimit.requestsPerMinute,
      maxConcurrency: this.config.rateLimit.concurrency,
      requestHandlerTimeoutSecs: 60,
      autoscaledPoolOptions: {
        minConcurrency: this.config.rateLimit.concurrency,
        maxConcurrency: this.config.rateLimit.concurrency,
      },
      requestHandler: async ({ page, request }) => {
        await requestHandler({
          page,
          request: {
            url: request.url,
            userData: request.userData as Record<string, unknown>,
          },
        });
      },
      failedRequestHandler: async ({ request, error }) => {
        await failedRequestHandler({ request, error: error as Error });
      },
    });
  }
}
