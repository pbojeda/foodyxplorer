// Unit tests for lib/htmlFetcher.ts
//
// Uses the crawlerFactory DI parameter to inject a mock PlaywrightCrawler.
// No real browser or network requests are made.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { fetchHtml } from '../../lib/htmlFetcher.js';

// ---------------------------------------------------------------------------
// Mock crawler factory helpers
// ---------------------------------------------------------------------------

type RequestHandlerContext = {
  page: {
    evaluate: (fn: () => string) => Promise<string>;
  };
  request: { url: string };
};

type FailedRequestHandlerContext = {
  error: Error;
  request: { url: string };
};

type CrawlerRequestHandler = (ctx: RequestHandlerContext) => Promise<void>;
type CrawlerFailedRequestHandler = (ctx: FailedRequestHandlerContext) => Promise<void>;

/**
 * Creates a mock crawlerFactory that captures the handlers passed to it
 * and exposes a `run` function that synchronously invokes whichever handler
 * the test configures.
 */
function makeMockFactory(opts: {
  mode: 'success';
  htmlToReturn: string;
} | {
  mode: 'failed';
  errorMessage: string;
}) {
  let capturedRequestHandler: CrawlerRequestHandler | undefined;
  let capturedFailedHandler: CrawlerFailedRequestHandler | undefined;

  const mockRun = vi.fn().mockImplementation(async (_requests: unknown) => {
    if (opts.mode === 'success' && capturedRequestHandler !== undefined) {
      await capturedRequestHandler({
        page: {
          evaluate: vi.fn().mockResolvedValue(opts.htmlToReturn),
        },
        request: { url: 'https://example.com' },
      });
    } else if (opts.mode === 'failed' && capturedFailedHandler !== undefined) {
      await capturedFailedHandler({
        error: new Error(opts.errorMessage),
        request: { url: 'https://example.com' },
      });
    }
  });

  const mockCrawler = { run: mockRun };

  const factory = vi.fn().mockImplementation(
    (requestHandler: CrawlerRequestHandler, failedHandler: CrawlerFailedRequestHandler) => {
      capturedRequestHandler = requestHandler;
      capturedFailedHandler = failedHandler;
      return mockCrawler;
    },
  );

  return { factory, mockRun };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful fetch', () => {
    it('returns the HTML string captured from page.evaluate()', async () => {
      const expectedHtml = '<html><body><p>Hola mundo</p></body></html>';
      const { factory } = makeMockFactory({ mode: 'success', htmlToReturn: expectedHtml });

      const result = await fetchHtml('https://example.com', factory);

      expect(result).toBe(expectedHtml);
    });

    it('passes the URL to crawler.run()', async () => {
      const { factory, mockRun } = makeMockFactory({
        mode: 'success',
        htmlToReturn: '<html></html>',
      });

      await fetchHtml('https://example.com/menu', factory);

      expect(mockRun).toHaveBeenCalledOnce();
      const callArg = mockRun.mock.calls[0]?.[0] as Array<{ url: string }>;
      expect(callArg).toBeDefined();
      expect(Array.isArray(callArg)).toBe(true);
      expect(callArg[0]?.url).toBe('https://example.com/menu');
    });
  });

  describe('failedRequestHandler invocation', () => {
    it('throws an error with code FETCH_FAILED when failedRequestHandler is called', async () => {
      const { factory } = makeMockFactory({
        mode: 'failed',
        errorMessage: 'ENOTFOUND example.invalid',
      });

      await expect(fetchHtml('https://example.invalid/', factory)).rejects.toMatchObject({
        code: 'FETCH_FAILED',
      });
    });

    it('throws an error with statusCode 422 for FETCH_FAILED', async () => {
      const { factory } = makeMockFactory({
        mode: 'failed',
        errorMessage: 'Connection refused',
      });

      await expect(fetchHtml('https://example.com/', factory)).rejects.toMatchObject({
        statusCode: 422,
        code: 'FETCH_FAILED',
      });
    });
  });

  describe('HTTP 403 response (anti-bot block)', () => {
    it('throws an error with code SCRAPER_BLOCKED when error message contains 403', async () => {
      const { factory } = makeMockFactory({
        mode: 'failed',
        errorMessage: 'Request failed with status code 403',
      });

      await expect(fetchHtml('https://example.com/', factory)).rejects.toMatchObject({
        code: 'SCRAPER_BLOCKED',
        statusCode: 422,
      });
    });
  });

  describe('HTTP 429 response (rate limited)', () => {
    it('throws an error with code SCRAPER_BLOCKED when error message contains 429', async () => {
      const { factory } = makeMockFactory({
        mode: 'failed',
        errorMessage: 'Request failed with status code 429 Too Many Requests',
      });

      await expect(fetchHtml('https://example.com/', factory)).rejects.toMatchObject({
        code: 'SCRAPER_BLOCKED',
        statusCode: 422,
      });
    });
  });
});
