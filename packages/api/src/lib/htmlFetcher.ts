// Thin Crawlee/Playwright wrapper for single-URL HTML fetching.
//
// fetchHtml(url, crawlerFactory?) fetches a single page using PlaywrightCrawler
// and returns the full outerHTML string after JavaScript rendering completes.
//
// The optional crawlerFactory parameter enables test-time dependency injection —
// tests pass a factory that returns a mock crawler, avoiding real browser launches.
//
// Error mapping:
//   HTTP 403 or 429 in error message → SCRAPER_BLOCKED (422)
//   Any other Crawlee failure        → FETCH_FAILED (422)

import { tmpdir } from 'os';
import { PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Handler context types (inline — same pattern as BaseScraper.createCrawler)
// ---------------------------------------------------------------------------

type RequestHandlerCtx = {
  page: Page;
  request: { url: string };
};

type FailedHandlerCtx = {
  request: { url: string };
  error: Error;
};

type RequestHandlerFn = (ctx: RequestHandlerCtx) => Promise<void>;
type FailedHandlerFn = (ctx: FailedHandlerCtx) => Promise<void>;

// ---------------------------------------------------------------------------
// Crawler factory type for DI
// ---------------------------------------------------------------------------

export type CrawlerFactory = (
  requestHandler: RequestHandlerFn,
  failedRequestHandler: FailedHandlerFn,
) => Pick<PlaywrightCrawler, 'run'>;

// ---------------------------------------------------------------------------
// fetchHtml
// ---------------------------------------------------------------------------

/**
 * Fetches the fully-rendered HTML of a single URL using Playwright/Crawlee.
 *
 * @param url            - The URL to fetch (must be http or https).
 * @param crawlerFactory - Optional DI factory for testing (skips real Playwright).
 * @returns              - The full outerHTML of the fetched page.
 * @throws               - FETCH_FAILED (422) on network/HTTP errors.
 * @throws               - SCRAPER_BLOCKED (422) if target returns HTTP 403 or 429.
 */
export async function fetchHtml(
  url: string,
  crawlerFactory?: CrawlerFactory,
): Promise<string> {
  // Redirect Crawlee storage to temp dir to prevent polluting the repo root.
  process.env['CRAWLEE_STORAGE_DIR'] ??= tmpdir();

  let html: string | undefined;
  let crawlerError: Error | undefined;

  // -------------------------------------------------------------------------
  // Request handler — extracts full page HTML after JS rendering
  // -------------------------------------------------------------------------
  const requestHandler: RequestHandlerFn = async ({ page }) => {
    html = await page.evaluate(() => document.documentElement.outerHTML);
  };

  // -------------------------------------------------------------------------
  // Failed request handler — maps Crawlee failures to domain errors
  // -------------------------------------------------------------------------
  const failedRequestHandler: FailedHandlerFn = async ({ error }) => {
    const message = error.message;
    if (message.includes('403') || message.includes('429')) {
      crawlerError = Object.assign(
        new Error('Access blocked by target server'),
        { code: 'SCRAPER_BLOCKED', statusCode: 422 },
      );
    } else {
      crawlerError = Object.assign(
        new Error('Failed to fetch URL'),
        { code: 'FETCH_FAILED', statusCode: 422 },
      );
    }
  };

  // -------------------------------------------------------------------------
  // Build the crawler (real or injected mock)
  // -------------------------------------------------------------------------
  let crawler: Pick<PlaywrightCrawler, 'run'>;

  if (crawlerFactory !== undefined) {
    crawler = crawlerFactory(requestHandler, failedRequestHandler);
  } else {
    crawler = new PlaywrightCrawler({
      launchContext: {
        launchOptions: {
          headless: true,
          args: ['--lang=es-ES'],
        },
      },
      preNavigationHooks: [
        async ({ page }) => {
          await page.setViewportSize({ width: 1280, height: 800 });
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
        },
      ],
      requestHandler: async ({ page, request }) => {
        await requestHandler({ page, request: { url: request.url } });
      },
      failedRequestHandler: async ({ request, error }) => {
        await failedRequestHandler({ request: { url: request.url }, error: error as Error });
      },
      requestHandlerTimeoutSecs: 25,
      maxConcurrency: 1,
      maxRequestsPerMinute: 60,
      maxRequestRetries: 1,
    });
  }

  // -------------------------------------------------------------------------
  // Run the crawl with a single URL
  // -------------------------------------------------------------------------
  await crawler.run([{ url }]);

  // -------------------------------------------------------------------------
  // Post-run checks
  // -------------------------------------------------------------------------
  if (crawlerError !== undefined) {
    throw crawlerError;
  }

  if (html === undefined) {
    throw Object.assign(
      new Error('Fetch failed: no HTML was captured'),
      { code: 'FETCH_FAILED', statusCode: 422 },
    );
  }

  return html;
}
