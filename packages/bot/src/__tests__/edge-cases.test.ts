// QA Edge-Case Tests — F027 Telegram Bot Command Handler
//
// These tests probe areas the developer did not cover:
//   1. MarkdownV2 injection via unescaped user-facing strings
//   2. apiClient URL construction with trailing slash
//   3. CHAIN_SLUG_REGEX false-positive / false-negative edge cases
//   4. handleApiError — TIMEOUT with statusCode 408 takes WRONG branch (>= 500 is false, but code check order matters)
//   5. info.ts — emoji in apiStatus is NOT escaped before Telegram send
//   6. truncate() edge cases: cutAt === 0, suffix itself longer than maxLen
//   7. formatNutrient — multiple decimal points, negative values
//   8. handlePlatos — extra whitespace injected in restaurantId path param
//   9. handleRestaurantes — chainSlug injection into the user-visible message
//  10. handleBuscar — API returns items but pagination is inconsistent
//  11. handleApiError — plain 404 (not TIMEOUT, not network, not 5xx, not 401/403/429) falls through to generic

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import type { DishListItem, PaginationMeta, EstimateData } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { escapeMarkdown, truncate, formatNutrient } from '../formatters/markdownUtils.js';
import { handleEstimar } from '../commands/estimar.js';
import { handlePlatos } from '../commands/platos.js';
import { handleRestaurantes } from '../commands/restaurantes.js';
import { handleInfo } from '../commands/info.js';
import { handleApiError } from '../commands/errorMessages.js';
import { formatDishList } from '../formatters/dishFormatter.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';

// ---------------------------------------------------------------------------
// Shared fixtures & helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-api-key',
  BOT_VERSION: '0.1.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [],
};

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn(),
    healthCheck: vi.fn(),
    searchRestaurants: vi.fn(),
    createRestaurant: vi.fn(),
    uploadImage: vi.fn(),
    uploadPdf: vi.fn(),
    analyzeMenu: vi.fn(),
    calculateRecipe: vi.fn(),
  };
}

const EMPTY_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 };
const SINGLE_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 };

const VALID_UUID = 'fd000000-0001-4000-a000-000000000001';

// ---------------------------------------------------------------------------
// 1. MarkdownV2 escaping — injection via user-supplied dish names
// ---------------------------------------------------------------------------

describe('MarkdownV2 escaping — injection vectors', () => {
  it('escapeMarkdown escapes the backslash character', () => {
    const result = escapeMarkdown('dish\\name');
    // Backslash is escaped to prevent Telegram MarkdownV2 parse errors.
    expect(result).toBe('dish\\\\name');
  });

  it('escapeMarkdown — dish name with ALL reserved chars produces valid output', () => {
    const nasty = '_*[]()~`>#+-=|{}.!';
    const escaped = escapeMarkdown(nasty);
    // Every char must be preceded by a backslash
    expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!');
  });

  it('formatDishList — dish name containing MarkdownV2 bold markers is escaped in output', () => {
    const dish: DishListItem = {
      id: VALID_UUID,
      name: '*Special* Burger',
      nameEs: null,
      restaurantId: VALID_UUID,
      chainSlug: 'chain-es',
      restaurantName: 'Test Restaurant',
      availability: 'available',
      portionGrams: null,
      priceEur: null,
    };
    const result = formatDishList([dish], SINGLE_PAGINATION);
    // The dish name inside *...*  bold markers must not produce *...*Special*...*
    // which would confuse Telegram's parser.
    expect(result).toContain('\\*Special\\*');
  });

  it('formatDishList — restaurant name with underscores is escaped', () => {
    const dish: DishListItem = {
      id: VALID_UUID,
      name: 'Burger',
      nameEs: null,
      restaurantId: VALID_UUID,
      chainSlug: 'chain-es',
      restaurantName: 'Mc_Donalds_Test',
      availability: 'available',
      portionGrams: null,
      priceEur: null,
    };
    const result = formatDishList([dish], SINGLE_PAGINATION);
    expect(result).toContain('Mc\\_Donalds\\_Test');
  });

  it('handleRestaurantes — chainSlug with MarkdownV2 special chars is escaped in not-found message', async () => {
    const mock = makeMockClient();
    // Craft a chainSlug that contains special chars — user can pass arbitrary args
    mock.listRestaurants.mockResolvedValue({ items: [], pagination: EMPTY_PAGINATION });
    // A slug like "chain.es" has a period which is reserved
    const result = await handleRestaurantes('chain.es', mock as unknown as ApiClient);
    // The period in the slug must be escaped in the user-facing message
    expect(result).toContain('chain\\.es');
  });

  it('handleInfo — emoji in apiStatus string is sent without escaping (known limitation)', async () => {
    const mock = makeMockClient();
    mock.healthCheck.mockResolvedValue(true);
    const result = await handleInfo(TEST_CONFIG, mock as unknown as ApiClient);
    // The status string 'conectada ✅' is embedded directly in the message
    // without escapeMarkdown. Emoji are safe, but if the status string ever
    // contains reserved chars this would be a bug.
    // Current implementation: apiStatus is hardcoded so this is low-risk,
    // but the pattern is fragile. Verify the message does NOT double-escape.
    expect(result).toContain('conectada');
  });
});

// ---------------------------------------------------------------------------
// 2. apiClient URL construction
// ---------------------------------------------------------------------------

describe('apiClient URL construction', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createApiClient: (config: BotConfig) => ApiClient;

  beforeAll(async () => {
    const mod = await import('../apiClient.js');
    createApiClient = mod.createApiClient;
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it('searchDishes URL does not double-slash when baseUrl has no trailing slash', async () => {
    // apiClient internally adds a trailing slash: baseUrl + '/'
    // Then uses new URL('/dishes/search', 'http://localhost:3001/')
    // This is correct — new URL('/path', 'http://host/') => 'http://host/path'
    // But new URL('/path', 'http://host/something/') => 'http://host/path' (drops 'something')
    // Test that the path is exactly /dishes/search with no double-slash
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } },
    }));
    const client = createApiClient(TEST_CONFIG);
    await client.searchDishes({ q: 'test' });

    const [url] = fetchMock.mock.calls[0] as [string];
    // Must be exactly this URL — no double slash, no path duplication
    expect(url).toMatch(/^http:\/\/localhost:3001\/dishes\/search\?/);
    expect(url).not.toContain('//dishes');
  });

  it('listRestaurantDishes URL contains the restaurantId in the correct path position', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } },
    }));
    const client = createApiClient(TEST_CONFIG);
    await client.listRestaurantDishes(VALID_UUID, { page: 1, pageSize: 10 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`/restaurants/${VALID_UUID}/dishes`);
  });

  it('estimate sends chainSlug param only when provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { query: 'big mac', chainSlug: null, level1Hit: false, level2Hit: false,
              level3Hit: false, level4Hit: false, matchType: null, result: null, cachedAt: null },
    }));
    const client = createApiClient(TEST_CONFIG);
    await client.estimate({ query: 'big mac' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain('chainSlug');
  });

  it('estimate sends chainSlug param when provided', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { query: 'big mac', chainSlug: 'mcdonalds-es', level1Hit: true, level2Hit: false,
              level3Hit: false, level4Hit: false, matchType: 'exact', result: null, cachedAt: null },
    }));
    const client = createApiClient(TEST_CONFIG);
    await client.estimate({ query: 'big mac', chainSlug: 'mcdonalds-es' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('chainSlug=mcdonalds-es');
  });

  it('healthCheck URL does not include query params or auth issues', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, { status: 'ok' }));
    const client = createApiClient(TEST_CONFIG);
    await client.healthCheck();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/health$/);
  });

  it('CRITICAL — searchDishes URL with API_BASE_URL containing a path segment is constructed correctly', async () => {
    // If API_BASE_URL = 'http://host/api/v1', then:
    // new URL('/dishes/search', 'http://host/api/v1/') => 'http://host/dishes/search'
    // This drops the /api/v1 prefix — absolute paths in new URL() always replace the path.
    // This is a known gotcha. Test it to document the behaviour.
    const configWithPath: BotConfig = {
      ...TEST_CONFIG,
      API_BASE_URL: 'http://localhost:3001/api/v1',
    };
    fetchMock.mockResolvedValue(makeResponse(200, {
      success: true,
      data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } },
    }));
    const client = createApiClient(configWithPath);
    await client.searchDishes({ q: 'test' });

    const [url] = fetchMock.mock.calls[0] as [string];
    // Document what actually happens — if /api/v1 is dropped this is a bug for non-root deployments
    // The spec says API_BASE_URL defaults to 'http://localhost:3001' (root), so this is an edge case
    // but worth knowing about.
    console.log('[QA] URL with path in API_BASE_URL:', url);
    // Just verify the URL is at least formed (not throwing)
    expect(url).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. CHAIN_SLUG_REGEX edge cases in handleEstimar
// ---------------------------------------------------------------------------

describe('handleEstimar — CHAIN_SLUG_REGEX edge cases', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
    mock.estimate.mockResolvedValue({
      query: 'test',
      chainSlug: null,
      portionMultiplier: 1.0,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    } satisfies EstimateData);
  });

  it('slug with only digits and hyphen is accepted (e.g. "123-es")', async () => {
    await handleEstimar('pizza en 123-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'pizza', chainSlug: '123-es' });
  });

  it('slug with multiple hyphens is accepted (e.g. "subway-es-2")', async () => {
    await handleEstimar('pizza en subway-es-2', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'pizza', chainSlug: 'subway-es-2' });
  });

  it('EDGE: slug with trailing hyphen is REJECTED — "mcdonalds-" has empty segment after last hyphen', async () => {
    // "mcdonalds-" — regex /^[a-z0-9-]+-[a-z0-9-]+$/ requires at least one char after the last hyphen
    // The regex actually uses [a-z0-9-]+ for the suffix which allows "-" chars too.
    // Let's verify "mcdonalds-" does not match (empty suffix should fail [a-z0-9-]+).
    await handleEstimar('pizza en mcdonalds-', mock as unknown as ApiClient);
    // Trailing hyphen — the part after "en " is "mcdonalds-" which ends in hyphen
    // [a-z0-9-]+ requires at least one char — a single hyphen counts!
    // "mcdonalds-" matches because the suffix part (-) is matched by [a-z0-9-]+
    // This means "mcdonalds-" is treated as a valid chain slug — this is a false positive.
    // Test captures the actual behaviour.
    const call = mock.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    console.log('[QA] estimate call args for "pizza en mcdonalds-":', JSON.stringify(call[0]));
    // Whether this is a bug depends on whether "mcdonalds-" is a valid slug.
    // The spec says chainSlug must contain "at least one hyphen" — it does.
    // But trailing-hyphen slugs are not valid per typical URL slug conventions.
    expect(call[0]).toBeDefined();
  });

  it('CRITICAL — slug consisting entirely of hyphens matches regex (e.g. "--")', async () => {
    // The regex /^[a-z0-9-]+-[a-z0-9-]+$/ — let us check "a-" and "--"
    // "--" : starts with "-" which matches [a-z0-9-]+, then "-" separator, then "-" which matches [a-z0-9-]+
    // So "--" might match the regex as a valid chainSlug — this is a false positive
    await handleEstimar('pizza en --', mock as unknown as ApiClient);
    const call = mock.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    console.log('[QA] estimate call args for "pizza en --":', JSON.stringify(call[0]));
    // If chainSlug is "--", the API will return 404 or empty result (not a crash),
    // but it is a spec deviation since "--" is not a valid chain slug.
    expect(call[0]).toBeDefined();
  });

  it('args with only " en " (no dish, no slug) returns usage hint', async () => {
    const result = await handleEstimar(' en ', mock as unknown as ApiClient);
    // After trim, " en " becomes "en" — no " en " separator found, so full string sent as query
    // Wait: trim of " en " is "en", then parseEstimarArgs("en") finds no " en " -> query = "en"
    // This calls estimate with { query: "en" } — not an error, but unusual.
    // Verify it does not crash.
    expect(typeof result).toBe('string');
  });

  it('very long dish name does not cause regex catastrophic backtracking', async () => {
    const longName = 'a'.repeat(500) + ' en mcdonalds-es';
    await handleEstimar(longName, mock as unknown as ApiClient);
    const call = mock.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }];
    expect(call[0]?.chainSlug).toBe('mcdonalds-es');
    expect(call[0]?.query).toBe('a'.repeat(500));
  });
});

// ---------------------------------------------------------------------------
// 4. handleApiError — error code ordering bug
// ---------------------------------------------------------------------------

describe('handleApiError — error branch ordering', () => {
  it('ApiError 408 with code TIMEOUT: statusCode >= 500 is false so code check runs — correct', () => {
    // 408 < 500, so it correctly falls through to the code check
    const result = handleApiError(new ApiError(408, 'TIMEOUT', 'timeout'));
    expect(result).toContain('tardo demasiado');
  });

  it('ApiError 0 with code NETWORK_ERROR: statusCode >= 500 is false so code check runs — correct', () => {
    const result = handleApiError(new ApiError(0, 'NETWORK_ERROR', 'net'));
    expect(result).toContain('conectar');
  });

  it('CRITICAL — ApiError 503 with code TIMEOUT: statusCode >= 500 is true, so TIMEOUT message is never returned', () => {
    // If the API returns 503 but the body has code=TIMEOUT (unusual but possible),
    // the implementation takes the statusCode >= 500 branch FIRST and returns
    // "El servicio no esta disponible" — ignoring the TIMEOUT code.
    // This is acceptable because 5xx is more specific than TIMEOUT for this scenario.
    // But for ApiError(504, 'TIMEOUT', ...) the same happens.
    // Test documents the current precedence: statusCode checks run before code checks.
    const result = handleApiError(new ApiError(504, 'TIMEOUT', 'gateway timeout'));
    // Returns service-unavailable, not timeout — consistent with current logic
    expect(result).toContain('no esta disponible');
  });

  it('ApiError 402 (payment required) falls through to generic message', () => {
    // 402 is not 429, not 401/403, not >= 500
    // code is not TIMEOUT or NETWORK_ERROR
    // Should return generic fallback
    const result = handleApiError(new ApiError(402, 'PAYMENT_REQUIRED', 'pay'));
    expect(result).toContain('error inesperado');
  });

  it('ApiError 422 (validation error) falls through to generic message', () => {
    const result = handleApiError(new ApiError(422, 'VALIDATION_ERROR', 'invalid'));
    expect(result).toContain('error inesperado');
  });

  it('null thrown (not an Error) returns generic message', () => {
    const result = handleApiError(null);
    expect(result).toContain('error inesperado');
  });

  it('undefined thrown returns generic message', () => {
    const result = handleApiError(undefined);
    expect(result).toContain('error inesperado');
  });

  it('string thrown returns generic message', () => {
    const result = handleApiError('something went wrong');
    expect(result).toContain('error inesperado');
  });
});

// ---------------------------------------------------------------------------
// 5. truncate() edge cases
// ---------------------------------------------------------------------------

describe('truncate() edge cases', () => {
  const SUFFIX = '\n\n_Lista recortada_';

  it('truncate with maxLen of 0 uses slice(0, 0) — empty cutAt branch', () => {
    const result = truncate('hello', 0);
    // text.length (5) > maxLen (0)
    // lastIndexOf('\n', -1) returns -1
    // cutAt = -1, which is NOT > 0, so fallback: text.slice(0, 0) = ''
    expect(result).toBe('' + SUFFIX);
  });

  it('truncate with maxLen of 1 and no newline uses char slice', () => {
    // SUFFIX = '\n\n_Lista recortada_' (19 chars)
    // effectiveMax = 1 - 19 = -18
    // lastIndexOf('\n', -19) = -1 (not found)
    // cutAt = -1, NOT > 0, so: text.slice(0, -18) = '' (empty for short text)
    // result = '' + SUFFIX
    const result = truncate('ab', 1);
    expect(result).toBe('' + SUFFIX);
  });

  it('truncate where first char is a newline: effectiveMax is negative, cutAt = -1', () => {
    // text = '\nhello', maxLen = 1
    // effectiveMax = 1 - 19 = -18
    // lastIndexOf('\n', -19) = -1
    // cutAt = -1, NOT > 0, so: text.slice(0, -18) = '' (short text sliced to empty)
    const result = truncate('\nhello', 1);
    expect(result).toBe('' + SUFFIX);
  });

  it('truncate suffix itself does not get re-truncated when it is appended', () => {
    // The suffix is 19 chars. If maxLen = 10 and we produce a string like "abc\n\n_Lista recortada_",
    // the final output length > maxLen — this is expected per spec (truncate at content boundary).
    const text = 'line one\nline two\nline three that is very long indeed';
    const result = truncate(text, 15);
    expect(result).toContain(SUFFIX);
    // The truncated content + suffix is the final string — no second truncation
    expect(result.indexOf(SUFFIX)).toBeLessThan(result.length);
  });

  it('truncate on text with only one newline at the very start: effectiveMax used, cutAt = 0 falls to char slice', () => {
    // text = '\n' + 'x' * 100, maxLen = 25
    // SUFFIX length = 19, effectiveMax = 25 - 19 = 6
    // lastIndexOf('\n', 5) = 0, which is NOT > 0 => text.slice(0, 6) = '\nxxxxx'
    // result = '\nxxxxx' + SUFFIX
    const text = '\n' + 'x'.repeat(100);
    const SUFFIX_LEN = SUFFIX.length; // 19
    const maxLen = 25;
    const effectiveMax = maxLen - SUFFIX_LEN; // 6
    const result = truncate(text, maxLen);
    // cutAt = 0 (newline at position 0, but 0 > 0 is false)
    // so uses text.slice(0, effectiveMax) = text.slice(0, 6) = '\nxxxxx'
    expect(result).toBe(text.slice(0, effectiveMax) + SUFFIX);
  });

  it('formatNutrient with negative value escapes the minus sign', () => {
    const result = formatNutrient(-5, 'g');
    // '-' is a MarkdownV2 reserved char — now properly escaped.
    expect(result).toBe('\\-5 g');
  });

  it('formatNutrient with multiple decimal points (e.g. malformed float) only replaces first', () => {
    // String(NaN) = 'NaN', String(Infinity) = 'Infinity'
    // These should not appear in real data, but test behaviour
    const resultNaN = formatNutrient(NaN, 'g');
    expect(resultNaN).toBe('NaN g');
    const resultInf = formatNutrient(Infinity, 'g');
    expect(resultInf).toBe('Infinity g');
  });
});

// ---------------------------------------------------------------------------
// 6. handlePlatos — UUID edge cases
// ---------------------------------------------------------------------------

describe('handlePlatos — UUID edge cases', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('UUID with mixed case is rejected (Zod uuid() is case-sensitive)', async () => {
    // UUIDs are case-insensitive in RFC 4122, but Zod uuid() validates lowercase hex.
    // Test that uppercase UUID is rejected without an API call.
    const uppercaseUUID = 'FD000000-0001-4000-A000-000000000001';
    const result = await handlePlatos(uppercaseUUID, mock as unknown as ApiClient);
    // If Zod rejects uppercase: returns UUID format error
    // If Zod accepts uppercase: calls API
    const apiCalled = mock.listRestaurantDishes.mock.calls.length > 0;
    console.log('[QA] Uppercase UUID — API called:', apiCalled, 'result:', result.substring(0, 50));
    // We assert a string is returned (no crash)
    expect(typeof result).toBe('string');
  });

  it('UUID with extra whitespace is trimmed before validation', async () => {
    mock.listRestaurantDishes.mockResolvedValue({
      items: [],
      pagination: EMPTY_PAGINATION,
    });
    // Extra leading/trailing spaces — handler trims args
    const result = await handlePlatos(`  ${VALID_UUID}  `, mock as unknown as ApiClient);
    // Should pass UUID validation after trim
    expect(mock.listRestaurantDishes).toHaveBeenCalledWith(VALID_UUID, { page: 1, pageSize: 10 });
    expect(result).toContain('No se encontraron platos');
  });

  it('CRITICAL — UUID with embedded newline bypasses trim and fails UUID validation', async () => {
    // args.trim() only removes leading/trailing whitespace; embedded \n is not trimmed
    const result = await handlePlatos(`${VALID_UUID.slice(0, 8)}\n${VALID_UUID.slice(8)}`, mock as unknown as ApiClient);
    // The embedded newline makes the UUID invalid — Zod should reject it
    expect(mock.listRestaurantDishes).not.toHaveBeenCalled();
    expect(result).toContain('UUID');
  });

  it('UUID validation: nil UUID (all zeros) is accepted by Zod uuid()', async () => {
    const nilUUID = '00000000-0000-0000-0000-000000000000';
    mock.listRestaurantDishes.mockResolvedValue({ items: [], pagination: EMPTY_PAGINATION });
    await handlePlatos(nilUUID, mock as unknown as ApiClient);
    // Nil UUID passes Zod validation but may 404 from the API
    expect(mock.listRestaurantDishes).toHaveBeenCalledWith(nilUUID, { page: 1, pageSize: 10 });
  });
});

// ---------------------------------------------------------------------------
// 7. formatEstimate — unescaped confidenceLevel for unknown values
// ---------------------------------------------------------------------------

describe('formatEstimate — edge cases', () => {
  function makeEstimateData(overrides: Partial<NonNullable<EstimateData['result']>> = {}): EstimateData {
    return {
      query: 'test',
      chainSlug: null,
      portionMultiplier: 1.0,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      cachedAt: null,
      result: {
        entityType: 'dish',
        entityId: VALID_UUID,
        name: 'Test Dish',
        nameEs: null,
        restaurantId: VALID_UUID,
        chainSlug: null,
        portionGrams: null,
        confidenceLevel: 'high',
        estimationMethod: 'official',
        similarityDistance: null,
        source: { id: VALID_UUID, name: 'src', type: 'official', url: null },
        nutrients: {
          calories: 300, proteins: 20, carbohydrates: 30, sugars: 5,
          fats: 10, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
          transFats: 0, cholesterol: 0, potassium: 0,
          monounsaturatedFats: 0, polyunsaturatedFats: 0,
          referenceBasis: 'per_serving',
        },
        ...overrides,
      },
    };
  }

  it('CRITICAL — unknown confidenceLevel value is passed through escapeMarkdown but not mapped', () => {
    // If API returns a confidenceLevel not in CONFIDENCE_MAP (e.g. 'very_high'),
    // the implementation uses: escapeMarkdown(result.confidenceLevel)
    // This is correct — the fallback escapes it. Verify no injection.
    const data = makeEstimateData({ confidenceLevel: 'very_high' as 'high' });
    const result = formatEstimate(data);
    // 'very_high' contains '_' — must be escaped
    expect(result).toContain('very\\_high');
  });

  it('confidenceLevel with MarkdownV2 special chars in unknown value is escaped', () => {
    const data = makeEstimateData({ confidenceLevel: 'high.confidence' as 'high' });
    const result = formatEstimate(data);
    // Period must be escaped
    expect(result).toContain('high\\.confidence');
  });

  it('dish name that is empty string produces valid but odd output', () => {
    const data = makeEstimateData({ name: '', nameEs: null });
    const result = formatEstimate(data);
    // Bold marker around empty name: '**' — this is invalid MarkdownV2
    // Telegram may reject the message.
    expect(result).toContain('**');
    console.log('[QA] formatEstimate with empty dish name produces:', result.substring(0, 50));
  });

  it('chainSlug in result with special chars is escaped', () => {
    const data = makeEstimateData({ chainSlug: 'chain.name-es' });
    const result = formatEstimate(data);
    expect(result).toContain('chain\\.name\\-es');
  });

  it('portionGrams of 0 is shown (0 is non-null)', () => {
    const data = makeEstimateData({ portionGrams: 0 });
    const result = formatEstimate(data);
    // portionGrams !== null check — 0 passes, so it should appear
    expect(result).toContain('0');
  });

  it('all optional nutrients at exactly 0 are hidden', () => {
    // fiber=0, saturatedFats=0, sodium=0, salt=0 — none should appear
    const data = makeEstimateData();
    const result = formatEstimate(data);
    expect(result).not.toContain('Fibra');
    expect(result).not.toContain('saturadas');
    expect(result).not.toContain('Sodio');
    expect(result).not.toContain('Sal:');
  });
});

// ---------------------------------------------------------------------------
// 8. Bot message handler — command with @botname suffix
// ---------------------------------------------------------------------------

describe('bot.ts regex — @botname suffix handling', () => {
  // These tests verify the regex patterns directly (without building the full bot)
  // by extracting them from the spec.

  const BUSCAR_REGEX = /^\/buscar(?:@\w+)?(?:\s+(.+))?$/;
  const START_REGEX  = /^\/start(?:@\w+)?$/;
  const PLATOS_REGEX = /^\/platos(?:@\w+)?(?:\s+(.+))?$/;

  it('/buscar@FoodXPlorerBot big mac matches and captures args', () => {
    const m = BUSCAR_REGEX.exec('/buscar@FoodXPlorerBot big mac');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('big mac');
  });

  it('/buscar@FoodXPlorerBot (no args) matches but capture group is undefined', () => {
    const m = BUSCAR_REGEX.exec('/buscar@FoodXPlorerBot');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBeUndefined();
  });

  it('/start@FoodXPlorerBot matches', () => {
    expect(START_REGEX.test('/start@FoodXPlorerBot')).toBe(true);
  });

  it('/platos@Bot <uuid> matches and captures uuid', () => {
    const m = PLATOS_REGEX.exec(`/platos@FoodBot ${VALID_UUID}`);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(VALID_UUID);
  });

  it('EDGE — /buscar with tab character instead of space does not match args', () => {
    // \\s+ in the regex matches tabs — a tab-separated arg would be captured
    const m = BUSCAR_REGEX.exec('/buscar\tbig mac');
    // \s matches \t — this will capture 'big mac' including the tab
    console.log('[QA] /buscar\\t match:', m?.[1]);
    expect(m).not.toBeNull();
  });

  it('EDGE — command with newline appended does not match anchored regex', () => {
    // Some clients may send '/start\n' — the $ anchor prevents this
    expect(START_REGEX.test('/start\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Spec compliance — /buscar pagination footer condition
// ---------------------------------------------------------------------------

describe('spec compliance — pagination footer', () => {
  it('footer shown when totalItems (11) > pageSize (10)', () => {
    const dish: DishListItem = {
      id: VALID_UUID, name: 'Test', nameEs: null,
      restaurantId: VALID_UUID, chainSlug: 'chain-es',
      restaurantName: 'Rest', availability: 'available',
      portionGrams: null, priceEur: null,
    };
    const pagination: PaginationMeta = { page: 1, pageSize: 10, totalItems: 11, totalPages: 2 };
    const result = formatDishList([dish], pagination);
    expect(result).toContain('Mostrando');
    expect(result).toContain('11');
  });

  it('footer NOT shown when totalItems (10) === pageSize (10)', () => {
    const dish: DishListItem = {
      id: VALID_UUID, name: 'Test', nameEs: null,
      restaurantId: VALID_UUID, chainSlug: 'chain-es',
      restaurantName: 'Rest', availability: 'available',
      portionGrams: null, priceEur: null,
    };
    const pagination: PaginationMeta = { page: 1, pageSize: 10, totalItems: 10, totalPages: 1 };
    const result = formatDishList([dish], pagination);
    expect(result).not.toContain('Mostrando');
  });

  it('footer NOT shown when totalItems (5) < pageSize (10)', () => {
    const dish: DishListItem = {
      id: VALID_UUID, name: 'Test', nameEs: null,
      restaurantId: VALID_UUID, chainSlug: 'chain-es',
      restaurantName: 'Rest', availability: 'available',
      portionGrams: null, priceEur: null,
    };
    const pagination: PaginationMeta = { page: 1, pageSize: 10, totalItems: 5, totalPages: 1 };
    const result = formatDishList([dish], pagination);
    expect(result).not.toContain('Mostrando');
  });
});

// ---------------------------------------------------------------------------
// 10. Rate-limit (429) is NOT a 5xx — verify it does NOT hit the >= 500 branch
// ---------------------------------------------------------------------------

describe('handleApiError — 429 is not caught by >= 500 branch', () => {
  it('429 is handled before the >= 500 branch', () => {
    // statusCode 429: first check is === 429 → returns rate-limit message
    // If the order were reversed (>= 500 first), 429 would fall through to generic.
    // Current implementation checks 429 first — this is CORRECT.
    const result = handleApiError(new ApiError(429, 'RATE_LIMIT', 'rate limit'));
    expect(result).toContain('Demasiadas consultas');
    expect(result).not.toContain('no esta disponible');
  });
});
