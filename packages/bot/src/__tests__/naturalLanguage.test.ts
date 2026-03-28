// Unit tests for the natural language handler.
// extractFoodQuery: pure function — no mocks needed.
// handleNaturalLanguage: mock ApiClient injected.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import { extractFoodQuery, handleNaturalLanguage } from '../handlers/naturalLanguage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA_NULL: EstimateData = {
  query: 'xyz',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: false,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
};

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
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
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0002-4000-a000-000000000001',
    chainSlug: 'mcdonalds-es',
    portionGrams: 200,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    similarityDistance: null,
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    nutrients: {
      calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
      fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    },
  },
};

// ---------------------------------------------------------------------------
// MockApiClient
// ---------------------------------------------------------------------------

type MockApiClient = { [K in keyof ApiClient]: ReturnType<typeof vi.fn> };

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

// ---------------------------------------------------------------------------
// extractFoodQuery
// ---------------------------------------------------------------------------

describe('extractFoodQuery', () => {
  it('passes through plain dish name unchanged', () => {
    expect(extractFoodQuery('big mac')).toEqual({ query: 'big mac' });
  });

  it('"calorías de un X" strips prefix and article', () => {
    expect(extractFoodQuery('calorías de un big mac')).toEqual({ query: 'big mac' });
  });

  it('"calorías de una X" strips prefix and article', () => {
    expect(extractFoodQuery('calorías de una hamburguesa')).toEqual({ query: 'hamburguesa' });
  });

  it('"cuántas calorías tiene una X" strips prefix and article', () => {
    expect(extractFoodQuery('cuántas calorías tiene una hamburguesa')).toEqual({ query: 'hamburguesa' });
  });

  it('"cuántas calorías hay en un X" strips prefix and article', () => {
    expect(extractFoodQuery('cuántas calorías hay en un big mac')).toEqual({ query: 'big mac' });
  });

  it('"qué lleva un X" strips prefix and article', () => {
    expect(extractFoodQuery('qué lleva un whopper')).toEqual({ query: 'whopper' });
  });

  it('"qué contiene el X" strips prefix and article', () => {
    expect(extractFoodQuery('qué contiene el mcpollo')).toEqual({ query: 'mcpollo' });
  });

  it('"información nutricional del X" strips prefix', () => {
    expect(extractFoodQuery('información nutricional del big mac')).toEqual({ query: 'big mac' });
  });

  it('"dame las calorías del X" strips prefix', () => {
    expect(extractFoodQuery('dame las calorías del big mac')).toEqual({ query: 'big mac' });
  });

  it('plain dish + chain slug extracts both', () => {
    expect(extractFoodQuery('big mac en mcdonalds-es')).toEqual({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('prefix + chain slug extracts query and chainSlug', () => {
    expect(extractFoodQuery('calorías de un big mac en mcdonalds-es')).toEqual({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('"pollo en salsa" (no hyphen in suffix) is NOT split', () => {
    expect(extractFoodQuery('pollo en salsa')).toEqual({ query: 'pollo en salsa' });
  });

  it('"pollo en salsa en mcdonalds-es" splits on last " en "', () => {
    expect(extractFoodQuery('pollo en salsa en mcdonalds-es')).toEqual({ query: 'pollo en salsa', chainSlug: 'mcdonalds-es' });
  });

  it('preserves uppercase in dish name', () => {
    expect(extractFoodQuery('Big Mac')).toEqual({ query: 'Big Mac' });
  });

  it('only-stopwords fallback returns original text, not empty string', () => {
    expect(extractFoodQuery('qué')).toEqual({ query: 'qué' });
  });

  it('emoji passes through unchanged', () => {
    expect(extractFoodQuery('🍔')).toEqual({ query: '🍔' });
  });

  it('leading and trailing whitespace is trimmed', () => {
    expect(extractFoodQuery('  big mac  ')).toEqual({ query: 'big mac' });
  });

  it('multi-hyphen slug (subway-es-2) is accepted as chainSlug', () => {
    expect(extractFoodQuery('pizza en subway-es-2')).toEqual({ query: 'pizza', chainSlug: 'subway-es-2' });
  });

  it('case-insensitive: uppercase prefix is stripped', () => {
    expect(extractFoodQuery('CALORÍAS DE UN BIG MAC')).toEqual({ query: 'BIG MAC' });
  });

  it('case-insensitive: mixed case prefix is stripped', () => {
    expect(extractFoodQuery('Cuántas Calorías Tiene Una Hamburguesa')).toEqual({ query: 'Hamburguesa' });
  });

  it('"info del X" (abbreviated form) strips prefix', () => {
    expect(extractFoodQuery('info del big mac')).toEqual({ query: 'big mac' });
  });

  it('"calorías big mac" (bare calorías without de) strips prefix', () => {
    expect(extractFoodQuery('calorías big mac')).toEqual({ query: 'big mac' });
  });
});

// ---------------------------------------------------------------------------
// handleNaturalLanguage
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('happy path: returns formatted card containing kcal value', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('563');
  });

  it('null result: returns no-data message', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const result = await handleNaturalLanguage('xyz unknown dish', mock as unknown as ApiClient);
    expect(result).toContain('No se encontraron datos nutricionales');
  });

  it('text > 500 chars: returns "sé más específico" without calling estimate', async () => {
    const longText = 'a'.repeat(501);
    const result = await handleNaturalLanguage(longText, mock as unknown as ApiClient);
    expect(result).toContain('específico');
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('text exactly 500 chars: accepted (calls estimate)', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const text500 = 'a'.repeat(500);
    await handleNaturalLanguage(text500, mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalled();
  });

  it('ApiError 429: returns rate-limit message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });

  it('ApiError 503: returns service-unavailable message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service down'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('no esta disponible');
  });

  it('ApiError TIMEOUT: returns timeout message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(408, 'TIMEOUT', 'Timeout'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('tardo demasiado');
  });

  it('ApiError NETWORK_ERROR: returns network-error message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('conectar');
  });

  it('extraction feeds API: "calorías de un big mac" calls estimate with { query: "big mac" }', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('calorías de un big mac', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'big mac' });
  });

  it('chain extraction feeds API: "big mac en mcdonalds-es" calls estimate with query and chainSlug', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('big mac en mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('non-ApiError (TypeError) is rethrown, not caught', async () => {
    mock.estimate.mockRejectedValue(new TypeError('Unexpected'));
    await expect(handleNaturalLanguage('big mac', mock as unknown as ApiClient)).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// F028 QA Edge Cases — extractFoodQuery (added by qa-engineer)
// ---------------------------------------------------------------------------

describe('extractFoodQuery — QA edge cases', () => {
  // -------------------------------------------------------------------------
  // Accented vs unaccented input variants
  // -------------------------------------------------------------------------

  it('"cuantas calorias tiene una hamburguesa" (no accents) still strips prefix', () => {
    // Regex uses cu[aá]ntas? and calor[ií]as? — covers both accented and plain
    expect(extractFoodQuery('cuantas calorias tiene una hamburguesa')).toEqual({ query: 'hamburguesa' });
  });

  it('"cuantas calorias hay en un big mac" (no accents) still strips prefix', () => {
    expect(extractFoodQuery('cuantas calorias hay en un big mac')).toEqual({ query: 'big mac' });
  });

  it('"CUÁNTAS CALORÍAS TIENE UNA HAMBURGUESA" (full uppercase) strips prefix case-insensitively', () => {
    expect(extractFoodQuery('CUÁNTAS CALORÍAS TIENE UNA HAMBURGUESA')).toEqual({ query: 'HAMBURGUESA' });
  });

  it('"Cuántas Calorías Hay En Un Big Mac" (title case) strips prefix but NOT slug (separator is lowercase)', () => {
    // lastIndexOf(' en ') is case-sensitive: ' En ' does not match.
    // Pattern 2 strips "Cuántas Calorías Hay En Un " (i flag) → article strip: no article → "Big Mac"
    expect(extractFoodQuery('Cuántas Calorías Hay En Un Big Mac')).toEqual({ query: 'Big Mac' });
  });

  // -------------------------------------------------------------------------
  // Chain slug: case sensitivity of " en " separator
  // -------------------------------------------------------------------------

  it('"big mac EN mcdonalds-es" (uppercase EN) — slug NOT extracted (separator is case-sensitive)', () => {
    // lastIndexOf(' en ') is case-sensitive — ' EN ' does not match
    // No prefix matches full string → query = full string
    expect(extractFoodQuery('big mac EN mcdonalds-es')).toEqual({ query: 'big mac EN mcdonalds-es' });
  });

  it('"big mac En mcdonalds-es" (mixed-case En) — slug NOT extracted', () => {
    expect(extractFoodQuery('big mac En mcdonalds-es')).toEqual({ query: 'big mac En mcdonalds-es' });
  });

  // -------------------------------------------------------------------------
  // Chain slug: multiple " en " occurrences — last wins
  // -------------------------------------------------------------------------

  it('"big mac en mcdonalds-es en burger-king-es" — LAST slug wins (burger-king-es)', () => {
    // Last " en " splits off "burger-king-es"; remainder = "big mac en mcdonalds-es"
    // No prefix matches remainder → query = "big mac en mcdonalds-es"
    expect(extractFoodQuery('big mac en mcdonalds-es en burger-king-es')).toEqual({
      query: 'big mac en mcdonalds-es',
      chainSlug: 'burger-king-es',
    });
  });

  it('"pollo en salsa en tomate en mcdonalds-es" — LAST " en " splits off mcdonalds-es', () => {
    expect(extractFoodQuery('pollo en salsa en tomate en mcdonalds-es')).toEqual({
      query: 'pollo en salsa en tomate',
      chainSlug: 'mcdonalds-es',
    });
  });

  // -------------------------------------------------------------------------
  // Chain slug: CHAIN_SLUG_REGEX boundary cases
  // -------------------------------------------------------------------------

  it('"big mac en mcdonalds" (no hyphen) — slug NOT extracted, full text sent as query', () => {
    // "mcdonalds" has no hyphen — fails CHAIN_SLUG_REGEX
    expect(extractFoodQuery('big mac en mcdonalds')).toEqual({ query: 'big mac en mcdonalds' });
  });

  it('"big mac en a-b" (minimal two-segment slug) — slug extracted', () => {
    // "a-b" matches /^[a-z0-9-]+-[a-z0-9-]+$/ — one char, hyphen, one char
    expect(extractFoodQuery('big mac en a-b')).toEqual({ query: 'big mac', chainSlug: 'a-b' });
  });

  it('"big mac en 123-456" (all-digit slug) — slug extracted', () => {
    expect(extractFoodQuery('big mac en 123-456')).toEqual({ query: 'big mac', chainSlug: '123-456' });
  });

  // -------------------------------------------------------------------------
  // Prefix patterns — additional verb/form variants
  // -------------------------------------------------------------------------

  it('"qué tiene un whopper" — "tiene" interrogative variant strips prefix', () => {
    // Pattern 4: ^qu[eé]\s+(?:lleva|contiene|tiene)\s+
    expect(extractFoodQuery('qué tiene un whopper')).toEqual({ query: 'whopper' });
  });

  it('"que lleva un whopper" (no accent on qué) strips prefix', () => {
    // qu[eé] covers unaccented "que"
    expect(extractFoodQuery('que lleva un whopper')).toEqual({ query: 'whopper' });
  });

  it('"dame la información del big mac" — singular "la" variant strips prefix', () => {
    // Pattern 5: (?:la[s]?\s+)? — "la " matches
    expect(extractFoodQuery('dame la información del big mac')).toEqual({ query: 'big mac' });
  });

  it('"dime las calorías del big mac" — dime variant strips prefix', () => {
    // Pattern 5: (?:dame|dime)
    expect(extractFoodQuery('dime las calorías del big mac')).toEqual({ query: 'big mac' });
  });

  it('"dame info del big mac" — "info" abbreviation in pattern 5 strips prefix', () => {
    // Pattern 5: (?:informaci[oó]n|info)
    expect(extractFoodQuery('dame info del big mac')).toEqual({ query: 'big mac' });
  });

  it('"dime información del big mac" — dime + información + del strips prefix', () => {
    expect(extractFoodQuery('dime información del big mac')).toEqual({ query: 'big mac' });
  });

  it('"información big mac" — pattern 6 strips "información " (all modifiers optional)', () => {
    // Pattern 6: all three modifier groups are optional — bare "información " matches
    expect(extractFoodQuery('información big mac')).toEqual({ query: 'big mac' });
  });

  it('"informacion nutricional del big mac" (no accent) — pattern 6 strips prefix', () => {
    // informaci[oó]n covers both accented and plain
    expect(extractFoodQuery('informacion nutricional del big mac')).toEqual({ query: 'big mac' });
  });

  it('"busca calorías de un big mac" — "busca" (no trailing r) matches pattern 8', () => {
    // busca[r]? — trailing r is optional
    expect(extractFoodQuery('busca calorías de un big mac')).toEqual({ query: 'big mac' });
  });

  it('"buscar las calorías de una hamburguesa" — full pattern 8 strips prefix', () => {
    expect(extractFoodQuery('buscar las calorías de una hamburguesa')).toEqual({ query: 'hamburguesa' });
  });

  // -------------------------------------------------------------------------
  // Inputs that reduce to empty after stripping — fallback to original
  // -------------------------------------------------------------------------

  it('"qué lleva" (no food after verb — verb has no trailing space) — no pattern match, passes through', () => {
    // Pattern 4 requires \s+ AFTER the verb — "qué lleva" has no trailing space
    // No pattern matches → query = "qué lleva"
    expect(extractFoodQuery('qué lleva')).toEqual({ query: 'qué lleva' });
  });

  it('"información" alone (no trailing space) — no pattern match, passes through', () => {
    // Pattern 6 requires \s+ after the word — no space → no match
    expect(extractFoodQuery('información')).toEqual({ query: 'información' });
  });

  it('"dame las calorías big mac" (missing "del") — pattern 5 NOT matched, pattern 8 NOT matched', () => {
    // Pattern 5 requires (?:de[l]?\s+) — NOT optional — so "dame las calorías big mac" fails pattern 5.
    // Pattern 8 anchors at start: busca[r]? and la[s]? are optional but "dame" is neither.
    // No pattern matches → query = "dame las calorías big mac"
    expect(extractFoodQuery('dame las calorías big mac')).toEqual({ query: 'dame las calorías big mac' });
  });

  // -------------------------------------------------------------------------
  // Article stripping — various articles
  // -------------------------------------------------------------------------

  it('"qué lleva los nuggets" — "los" article is stripped after prefix', () => {
    // Pattern 4 strips "qué lleva " → remainder "los nuggets"
    // ARTICLE_PATTERN: ^(?:un[ao]?|el|la[s]?|los|del|al)\s+ — "los " matches
    expect(extractFoodQuery('qué lleva los nuggets')).toEqual({ query: 'nuggets' });
  });

  it('"qué lleva al pastor" — "al" article is stripped after prefix', () => {
    // ARTICLE_PATTERN: "al " matches
    expect(extractFoodQuery('qué lleva al pastor')).toEqual({ query: 'pastor' });
  });

  it('"qué lleva del big mac" — "del" article is stripped after prefix', () => {
    // ARTICLE_PATTERN: "del " matches
    expect(extractFoodQuery('qué lleva del big mac')).toEqual({ query: 'big mac' });
  });

  it('article stripping is case-insensitive: "qué lleva La Big Mac" strips "La "', () => {
    // ARTICLE_PATTERN uses /i flag — "La " matches la[s]?
    expect(extractFoodQuery('qué lleva La Big Mac')).toEqual({ query: 'Big Mac' });
  });

  it('article stripping applied at most once: "qué lleva un un big mac" leaves second "un"', () => {
    // Pattern 4 strips "qué lleva " → "un un big mac"
    // ARTICLE_PATTERN strips first "un " → "un big mac" (applied exactly once)
    expect(extractFoodQuery('qué lleva un un big mac')).toEqual({ query: 'un big mac' });
  });

  // -------------------------------------------------------------------------
  // Unicode / special character inputs
  // -------------------------------------------------------------------------

  it('RTL character (Arabic) in query — passes through unchanged', () => {
    expect(extractFoodQuery('كلوريات big mac')).toEqual({ query: 'كلوريات big mac' });
  });

  it('emoji at start of text — no prefix match, passes through', () => {
    expect(extractFoodQuery('🍔 big mac')).toEqual({ query: '🍔 big mac' });
  });

  it('"calorías 🍔 de un big mac" — prefix stripped at "calorías " only (emoji breaks "de un" match)', () => {
    // Pattern 7: calor[ií]as?\s+de[l]?\s+(?:un[ao]?\s+)? — after "calorías " is "🍔" not "de"
    // Pattern 7 does NOT match. Pattern 8: calor[ií]as?\s+ matches "calorías ", stops there.
    // Remainder: "🍔 de un big mac". No article strip. query = "🍔 de un big mac".
    expect(extractFoodQuery('calorías 🍔 de un big mac')).toEqual({ query: '🍔 de un big mac' });
  });

  it('tab in " en " position — chain slug NOT extracted (separator requires literal spaces)', () => {
    // "big mac\ten\tmcdonalds-es" — lastIndexOf(' en ') = -1 (no match for tab variant)
    expect(extractFoodQuery('big mac\ten\tmcdonalds-es')).toEqual({ query: 'big mac\ten\tmcdonalds-es' });
  });

  it('"calorías de un\\nbig mac" (newline in middle) — \\s+ in prefix matches newline, strips correctly', () => {
    // Pattern 7: calor[ií]as?\s+de[l]?\s+(?:un[ao]?\s+)?
    // \s+ matches newlines, so "de un\n" is matched by "de[l]?\s+un[ao]?\s+"
    const result = extractFoodQuery('calorías de un\nbig mac');
    expect(result).toEqual({ query: 'big mac' });
  });
});

// ---------------------------------------------------------------------------
// F028 QA Edge Cases — handleNaturalLanguage (added by qa-engineer)
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — QA edge cases', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('BOUNDARY: text of exactly 501 chars is rejected — estimate NOT called', async () => {
    const exactly501 = 'a'.repeat(501);
    const result = await handleNaturalLanguage(exactly501, mock as unknown as ApiClient);
    expect(result).toContain('específico');
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('BOUNDARY: whitespace-padded to 502 total but 500 trimmed — calls estimate', async () => {
    // " " + "a"*500 + " " = 502 raw chars, 500 trimmed — within limit (not > 500)
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const paddedExactly500 = ' ' + 'a'.repeat(500) + ' ';
    await handleNaturalLanguage(paddedExactly500, mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledOnce();
  });

  it('BOUNDARY: whitespace-padded to 503 total but 501 trimmed — rejected', async () => {
    // " " + "a"*501 + " " = 503 raw chars, 501 trimmed — over limit
    const paddedExactly501 = ' ' + 'a'.repeat(501) + ' ';
    const result = await handleNaturalLanguage(paddedExactly501, mock as unknown as ApiClient);
    expect(result).toContain('específico');
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('too-long prompt contains "_big mac_" italic (not double-escaped by escapeMarkdown)', async () => {
    // Spec §Key Patterns #4: the >500 prompt must NOT use escapeMarkdown
    // because that would escape the _ delimiters and break italic formatting.
    const result = await handleNaturalLanguage('a'.repeat(501), mock as unknown as ApiClient);
    expect(result).toContain('_big mac_');
    // Double-escaped form must NOT appear
    expect(result).not.toContain('\\_big mac\\_');
  });

  it('too-long prompt contains "Por favor" and "sé más específico"', async () => {
    const result = await handleNaturalLanguage('a'.repeat(501), mock as unknown as ApiClient);
    expect(result).toContain('Por favor');
    expect(result).toContain('sé más específico');
  });

  it('ApiError 401: returns configuration error message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('configuracion');
  });

  it('ApiError 500: returns service-unavailable message', async () => {
    mock.estimate.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Internal error'));
    const result = await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    expect(result).toContain('no esta disponible');
  });

  it('no slug: chainSlug property is absent from estimate call (matches spec)', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    const args = (mock.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }])[0];
    expect(Object.prototype.hasOwnProperty.call(args, 'chainSlug')).toBe(false);
  });

  it('very long text at exactly 500 trimmed — chain slug extraction still works correctly', async () => {
    // "a"*484 + " en mcdonalds-es" = 500 chars — within limit
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const text = 'a'.repeat(484) + ' en mcdonalds-es';
    expect(text.length).toBe(500);
    await handleNaturalLanguage(text, mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'a'.repeat(484),
      chainSlug: 'mcdonalds-es',
    });
  });

  it('concurrent calls do not interfere — stateless per call', async () => {
    // The handler is stateless (no shared mutable state).
    // Fire two concurrent calls — each must call estimate with its own args.
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await Promise.all([
      handleNaturalLanguage('big mac', mock as unknown as ApiClient),
      handleNaturalLanguage('whopper', mock as unknown as ApiClient),
    ]);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
    const calls = mock.estimate.mock.calls as Array<[{ query: string }]>;
    const queries = calls.map((c) => c[0].query).sort();
    expect(queries).toEqual(['big mac', 'whopper']);
  });

  // --- portionModifier integration ---

  it('"big mac grande" → estimate called with query="big mac", portionMultiplier=1.5', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('big mac grande', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('"big mac" (no modifier) → estimate called without portionMultiplier key', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('big mac', mock as unknown as ApiClient);
    const args = mock.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(args, 'portionMultiplier')).toBe(false);
  });

  it('"calorías de un big mac grande" → modifier extracted first, then prefix stripped', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('calorías de un big mac grande', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('"big mac grande en mcdonalds-es" → modifier stripped, chain slug preserved', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('big mac grande en mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({
      query: 'big mac',
      chainSlug: 'mcdonalds-es',
      portionMultiplier: 1.5,
    });
  });

  it('portionMultiplier=1.0 → property absent from estimate call', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('tortilla', mock as unknown as ApiClient);
    const args = mock.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(args, 'portionMultiplier')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F043 NL Comparison Detection
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — comparison detection', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('"qué tiene más calorías, un big mac o un whopper" → estimate called twice (comparison)', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('qué tiene más calorías, un big mac o un whopper', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
  });

  it('"compara big mac con whopper" → comparison detected, estimate called twice', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('compara big mac con whopper', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
  });

  it('"qué engorda más, una pizza o una hamburguesa" → comparison with nutrientFocus calorías', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleNaturalLanguage('qué engorda más, una pizza o una hamburguesa', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
    // nutrientFocus "calorías" → should show (foco) label
    expect(result).toContain('(foco)');
  });

  it('"compara big mac vs whopper" → comparison detected via "vs" separator', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('compara big mac vs whopper', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
  });

  it('"qué tiene menos grasas, una pizza o una hamburguesa" → nutrientFocus grasas', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleNaturalLanguage('qué tiene menos grasas, una pizza o una hamburguesa', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
    expect(result).toContain('Grasas');
  });

  it('"big mac vs whopper" (no prefix) → falls through to single-dish path, estimate called once', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('big mac vs whopper', mock as unknown as ApiClient);
    // No comparison prefix → single dish path
    expect(mock.estimate).toHaveBeenCalledTimes(1);
  });

  it('"qué es más sano, una ensalada o un bollo" → comparison detected, no nutrientFocus', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleNaturalLanguage('qué es más sano, una ensalada o un bollo', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
    // No (foco) label since nutrientFocus is undefined
    expect(result).not.toContain('(foco)');
  });

  it('comparison detected → estimate NOT called 3 times (only 2, not single-dish path)', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('compara big mac con whopper', mock as unknown as ApiClient);
    // Comparison short-circuits before single-dish path
    expect(mock.estimate).toHaveBeenCalledTimes(2);
  });

  it('one estimate returns null result → does not crash, shows partial data', async () => {
    mock.estimate
      .mockResolvedValueOnce(ESTIMATE_DATA_WITH_RESULT)
      .mockResolvedValueOnce(ESTIMATE_DATA_NULL);
    const result = await handleNaturalLanguage('compara big mac con xyz', mock as unknown as ApiClient);
    expect(result).toContain('Big Mac');
    expect(result).toContain('No se encontraron datos');
  });

  it('comparison with portion modifier in text still works', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('qué tiene más calorías, una big mac grande o un whopper', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledTimes(2);
  });

  it('MAX_NL_TEXT_LENGTH guard fires before comparison detection for text > 500 chars', async () => {
    const longComparison = 'compara ' + 'a'.repeat(300) + ' vs ' + 'b'.repeat(200);
    const result = await handleNaturalLanguage(longComparison, mock as unknown as ApiClient);
    expect(result).toContain('específico');
    expect(mock.estimate).not.toHaveBeenCalled();
  });
});
