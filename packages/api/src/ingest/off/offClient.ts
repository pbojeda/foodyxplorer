/**
 * F080 — OFF API Client
 *
 * HTTP client for the Open Food Facts (OFF) Search and Product APIs.
 *
 * **Authentication:** OFF API v2 requires session cookies for search queries.
 * The session cookie is read from the OFF_SESSION_COOKIE env var.
 * To obtain a session cookie:
 *   1. Create an account at https://world.openfoodfacts.org/
 *   2. Log in and copy the session cookie value from browser dev tools
 *   3. Set OFF_SESSION_COOKIE="session=<value>" in .env
 *
 * Retry policy: 3 retries with exponential backoff (1s, 2s, 4s).
 * 4xx responses are not retried — except 429 (Too Many Requests) which IS retried.
 * 5xx responses and network errors are retried.
 * Timeout: 30 s per request.
 *
 * Rate limit: 1000 ms delay between paginated requests per OFF recommendation.
 */

import type { OffProduct } from './types.js';

/** OFF Search API v2 base URL (requires authentication). */
const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/api/v2/search';

/** OFF Product API base URL. */
const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

/** User-Agent required by OFF API policy. */
const OFF_USER_AGENT = 'nutriXplorer/1.0 (nutrixplorer@example.com)';

/** Number of products per page. */
const PAGE_SIZE = 100;

/** Delay between paginated requests in ms (OFF rate limit recommendation). */
const PAGE_DELAY_MS = 1000;

export interface OffClientOptions {
  /** Injectable fetch implementation (default: global fetch). */
  fetchImpl?: typeof fetch;
  /** Base delay for retry backoff in ms (default: 1000; set 0 in tests). */
  retryDelayMs?: number;
  /** Maximum retries per request (default: 3). */
  maxRetries?: number;
  /** Stop fetching after reaching this many products. */
  limit?: number;
  /** OFF session cookie for authentication (default: reads OFF_SESSION_COOKIE env var). */
  sessionCookie?: string;
}

/**
 * Fetch all products for a brand from the OFF Search API.
 * Paginates automatically through all result pages.
 *
 * When brand is "mercadona", also queries "hacendado" (Mercadona's house brand)
 * and merges results with deduplication on `code`.
 */
export async function fetchProductsByBrand(
  brand: string,
  options: OffClientOptions = {},
): Promise<OffProduct[]> {
  const { fetchImpl = fetch, retryDelayMs = 1000, maxRetries = 3, limit, sessionCookie } = options;

  // Resolve session cookie: explicit option > env var
  const cookie = sessionCookie ?? process.env['OFF_SESSION_COOKIE'];
  const isTestEnv = (process.env['NODE_ENV'] === 'test');
  if (!cookie && !isTestEnv) {
    console.warn(
      '[offClient] WARNING: OFF_SESSION_COOKIE not set. OFF API v2 requires authentication.\n' +
      'Search requests will likely fail with 503 or return HTML instead of JSON.\n' +
      'See offClient.ts header comment for setup instructions.',
    );
  }

  // Mercadona special case: also query hacendado
  const brandQueries = brand === 'mercadona'
    ? ['hacendado', 'mercadona']
    : [brand];

  const allProducts: OffProduct[] = [];
  const seenCodes = new Set<string>();

  for (const brandQuery of brandQueries) {
    let page = 1;

    while (true) {
      // Check limit before fetching next page
      if (limit !== undefined && allProducts.length >= limit) {
        break;
      }

      const url = buildSearchUrl(brandQuery, page);
      const data = await fetchWithRetry<OffSearchResponse>(
        url,
        { fetchImpl, retryDelayMs, maxRetries, cookie },
      );

      const products: OffProduct[] = data?.products ?? [];

      for (const p of products) {
        if (limit !== undefined && allProducts.length >= limit) break;
        // Deduplicate by code (or _id as fallback)
        const key = p.code ?? p._id;
        if (key && seenCodes.has(key)) continue;
        if (key) seenCodes.add(key);
        allProducts.push(p);
      }

      // Stop pagination if we got fewer products than page_size
      if (products.length < PAGE_SIZE) break;

      page++;

      // Rate limit: 1000 ms between pages (skip in test environments when retryDelayMs=0)
      if (retryDelayMs > 0) {
        await delay(PAGE_DELAY_MS);
      }
    }
  }

  return allProducts;
}

/**
 * Fetch a single product by barcode from the OFF Product API.
 * Returns null if the product is not found (404).
 */
export async function fetchProductByBarcode(
  barcode: string,
  options: OffClientOptions = {},
): Promise<OffProduct | null> {
  const { fetchImpl = fetch, retryDelayMs = 1000, maxRetries = 3, sessionCookie } = options;
  const cookie = sessionCookie ?? process.env['OFF_SESSION_COOKIE'];

  const url = `${OFF_PRODUCT_URL}/${barcode}.json`;

  try {
    const data = await fetchWithRetry<OffProductResponse>(
      url,
      { fetchImpl, retryDelayMs, maxRetries, cookie },
      true, // allow404
    );
    if (data === null) return null;
    return data.product ?? null;
  } catch (err) {
    if (err instanceof OffFetchError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OffSearchResponse {
  products?: OffProduct[];
  count?: number;
  page_size?: number;
}

interface OffProductResponse {
  status?: number;
  product?: OffProduct;
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

async function fetchWithRetry<T>(
  url: string,
  opts: { fetchImpl: typeof fetch; retryDelayMs: number; maxRetries: number; cookie?: string },
  allow404 = false,
): Promise<T | null> {
  const { fetchImpl, retryDelayMs, maxRetries, cookie } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const signal = AbortSignal.timeout(30_000);

      const headers: Record<string, string> = {
        'User-Agent': OFF_USER_AGENT,
        'Accept': 'application/json',
      };
      if (cookie) {
        headers['Cookie'] = cookie;
      }

      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal,
      });

      if (response.status === 404 && allow404) {
        return null;
      }

      if (!response.ok) {
        const status = response.status;

        // 4xx (except 429) — do not retry
        if (status >= 400 && status < 500 && status !== 429) {
          throw new OffFetchError(
            `OFF API returned ${status}`,
            status,
          );
        }

        // 5xx or 429 — retry
        lastError = new OffFetchError(`OFF API returned ${status}`, status);
        if (attempt < maxRetries) {
          await delay(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }

      return (await response.json()) as T;
    } catch (err) {
      // Rethrow non-retryable 4xx immediately
      if (err instanceof OffFetchError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }

      lastError = err;
      if (attempt < maxRetries) {
        await delay(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError ?? new OffFetchError('OFF API fetch failed after retries', 0);
}

// ---------------------------------------------------------------------------
// Public error class
// ---------------------------------------------------------------------------

export class OffFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'OffFetchError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSearchUrl(brand: string, page: number): string {
  const params = new URLSearchParams({
    brands_tags_contains: brand,
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  return `${OFF_SEARCH_URL}?${params.toString()}`;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
