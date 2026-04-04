/**
 * F071 — BEDCA API Client
 *
 * HTTP client for fetching data from the BEDCA XML API at procquery.php.
 * The API accepts POST requests with form-encoded SQL queries and returns XML.
 *
 * Retry policy: 3 retries with exponential backoff (1s, 2s, 4s by default).
 * 4xx responses are propagated immediately without retry.
 * Network errors and 5xx responses trigger retry.
 *
 * The JOIN query fetches both food metadata and nutrient values in one request
 * to avoid N+1 HTTP calls for the ~431 food entries.
 */

export const BEDCA_API_URL = 'https://www.bedca.net/bdpub/procquery.php';

/** SQL query to fetch all foods with nutrient values in one JOIN request. */
const FOODS_WITH_NUTRIENTS_QUERY =
  'select f.food_id, f.food_name, f.food_name_e, f.food_group, f.food_group_e, ' +
  'v.nutrient_id, v.value ' +
  'from food f left join food_value v on f.food_id = v.food_id ' +
  'order by f.food_id, v.nutrient_id';

/** SQL query to fetch the nutrient reference table. */
const NUTRIENT_INDEX_QUERY =
  'select nutrient_id, nutrient_name, tagname, unit from nutrient order by nutrient_id';

export interface BedcaClientOptions {
  /** Delay between retries in ms (default: 1000; set to 0 in tests). */
  retryDelayMs?: number;
  /** Max number of retries (default: 3). */
  maxRetries?: number;
}

/**
 * Fetches all BEDCA foods with their nutrient values via a JOIN query.
 * Returns raw XML string for parsing by bedcaParser.
 *
 * @param fetchImpl  Optional fetch implementation (defaults to global fetch; DI for testing)
 * @param opts       Retry options
 */
export async function fetchBedcaFoodsXml(
  fetchImpl: typeof fetch = fetch,
  opts: BedcaClientOptions = {},
): Promise<string> {
  return fetchWithRetry(BEDCA_API_URL, FOODS_WITH_NUTRIENTS_QUERY, fetchImpl, opts);
}

/**
 * Fetches the BEDCA nutrient reference table.
 * Returns raw XML string for parsing by bedcaParser.
 */
export async function fetchBedcaNutrientIndexXml(
  fetchImpl: typeof fetch = fetch,
  opts: BedcaClientOptions = {},
): Promise<string> {
  return fetchWithRetry(BEDCA_API_URL, NUTRIENT_INDEX_QUERY, fetchImpl, opts);
}

/** Sends a POST to the BEDCA API with retry logic. */
async function fetchWithRetry(
  url: string,
  query: string,
  fetchImpl: typeof fetch,
  opts: BedcaClientOptions,
): Promise<string> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.retryDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const body = new URLSearchParams({ q: query }).toString();
      const signal = AbortSignal.timeout(30_000);

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal,
      });

      if (!response.ok) {
        const status = response.status;
        // 4xx: client error — do not retry
        if (status >= 400 && status < 500) {
          throw new BedcaFetchError(
            `BEDCA API returned ${status} — ${await response.text()}`,
            status,
          );
        }
        // 5xx: server error — retry
        lastError = new BedcaFetchError(
          `BEDCA API returned ${status}`,
          status,
        );
        if (attempt < maxRetries) {
          await delay(baseDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }

      return response.text();
    } catch (err) {
      // Rethrow 4xx immediately (no retry)
      if (err instanceof BedcaFetchError && err.status >= 400 && err.status < 500) {
        throw err;
      }

      lastError = err;
      if (attempt < maxRetries) {
        await delay(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError ?? new BedcaFetchError('BEDCA API fetch failed after retries', 0);
}

export class BedcaFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BedcaFetchError';
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
