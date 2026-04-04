// Unit tests for the natural language handler.
// extractFoodQuery: pure function — no mocks needed.
// handleNaturalLanguage: mock ApiClient injected.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { Redis } from 'ioredis';
import { ApiError } from '../apiClient.js';
import type { EstimateData, ConversationMessageData } from '@foodxplorer/shared';
import { extractFoodQuery, handleNaturalLanguage } from '../handlers/naturalLanguage.js';

function makeMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
  } as unknown as Redis;
}

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
    processMessage: vi.fn(),
    sendAudio: vi.fn(),
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
// extractFoodQuery — Spanish punctuation (BUG-AUDIT-01 / F050)
// ---------------------------------------------------------------------------

describe('extractFoodQuery — ¿¡ and ?! punctuation stripping (F050)', () => {
  it('strips leading ¿ before prefix matching', () => {
    expect(extractFoodQuery('¿cuántas calorías tiene un big mac?')).toEqual({ query: 'big mac' });
  });

  it('strips leading ¡ before prefix matching', () => {
    expect(extractFoodQuery('¡cuántas calorías tiene un big mac!')).toEqual({ query: 'big mac' });
  });

  it('strips leading ¿¡ combined', () => {
    expect(extractFoodQuery('¿¡cuántas calorías tiene una hamburguesa?!')).toEqual({ query: 'hamburguesa' });
  });

  it('strips trailing ? from plain dish name', () => {
    expect(extractFoodQuery('big mac?')).toEqual({ query: 'big mac' });
  });

  it('strips trailing ! from plain dish name', () => {
    expect(extractFoodQuery('big mac!')).toEqual({ query: 'big mac' });
  });

  it('handles ¿qué lleva un whopper?', () => {
    expect(extractFoodQuery('¿qué lleva un whopper?')).toEqual({ query: 'whopper' });
  });

  it('handles ¿información nutricional del big mac?', () => {
    expect(extractFoodQuery('¿información nutricional del big mac?')).toEqual({ query: 'big mac' });
  });

  it('preserves chain slug with punctuation stripping', () => {
    expect(extractFoodQuery('¿calorías de un big mac en mcdonalds-es?')).toEqual({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });
});

// ---------------------------------------------------------------------------
// handleNaturalLanguage
// ---------------------------------------------------------------------------

// F070: handleNaturalLanguage is now a thin adapter calling apiClient.processMessage().
// Tests updated to mock processMessage returning ConversationMessageData.

function makeEstimationResponse(estimateData: EstimateData): ConversationMessageData {
  return {
    intent: 'estimation',
    actorId: 'fd000000-0001-4000-a000-000000000001',
    estimation: estimateData,
    activeContext: null,
  };
}

describe('handleNaturalLanguage', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('happy path: returns formatted card containing kcal value', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_WITH_RESULT));
    const result = await handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('563');
  });

  it('null result: returns no-data message', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    const result = await handleNaturalLanguage('xyz unknown dish', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('No se encontraron datos nutricionales');
  });

  it('text > 500 chars: returns "sé más específico" (text_too_long intent)', async () => {
    const longText = 'a'.repeat(501);
    mock.processMessage.mockResolvedValue({
      intent: 'text_too_long',
      actorId: 'fd000000-0001-4000-a000-000000000001',
      activeContext: null,
    } as ConversationMessageData);
    const result = await handleNaturalLanguage(longText, 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('big mac');
  });

  it('text exactly 500 chars: calls processMessage', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    const text500 = 'a'.repeat(500);
    await handleNaturalLanguage(text500, 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalled();
  });

  it('ApiError 429: rethrows (no longer caught by bot NL handler)', async () => {
    mock.processMessage.mockRejectedValue(new ApiError(429, 'ACTOR_RATE_LIMIT_EXCEEDED', 'Too many'));
    await expect(
      handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient)
    ).rejects.toThrow(ApiError);
  });

  it('ApiError from processMessage: rethrows (bot wrapHandler handles it)', async () => {
    mock.processMessage.mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service down'));
    await expect(
      handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient)
    ).rejects.toThrow(ApiError);
  });

  it('non-ApiError (TypeError) is rethrown', async () => {
    mock.processMessage.mockRejectedValue(new TypeError('Unexpected'));
    await expect(handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient)).rejects.toThrow(TypeError);
  });

  it('calls processMessage with the text and chatId', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    await handleNaturalLanguage('calorías de un big mac', 42, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledWith('calorías de un big mac', 42, undefined);
  });

  it('passes legacy chainContext when bot:state has it', async () => {
    // The getState mock is set globally; here we use a redis with chain context in state
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ chainContext: { chainSlug: 'bk-es', chainName: 'Burger King' } })),
      set: vi.fn(),
      del: vi.fn(),
      ttl: vi.fn(),
    } as unknown as Redis;
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    await handleNaturalLanguage('big mac', 0, redis, mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledWith('big mac', 0, { chainSlug: 'bk-es', chainName: 'Burger King' });
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
// F028 QA Edge Cases — handleNaturalLanguage (updated for F070 refactor)
//
// After F070: handleNaturalLanguage calls apiClient.processMessage().
// Internal routing (estimate, comparison, context-set) happens in ConversationCore.
// Tests now verify: processMessage is called + response is formatted correctly.
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — QA edge cases', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('BOUNDARY: text_too_long intent → returns "sé más específico" message', async () => {
    mock.processMessage.mockResolvedValue({
      intent: 'text_too_long',
      actorId: 'a-uuid',
      activeContext: null,
    } as ConversationMessageData);
    const result = await handleNaturalLanguage('a'.repeat(501), 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('específico');
  });

  it('too-long prompt contains "_big mac_" italic (not double-escaped by escapeMarkdown)', async () => {
    mock.processMessage.mockResolvedValue({
      intent: 'text_too_long',
      actorId: 'a-uuid',
      activeContext: null,
    } as ConversationMessageData);
    const result = await handleNaturalLanguage('a'.repeat(501), 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('_big mac_');
    expect(result).not.toContain('\\_big mac\\_');
  });

  it('too-long prompt contains "Por favor" and "sé más específico"', async () => {
    mock.processMessage.mockResolvedValue({
      intent: 'text_too_long',
      actorId: 'a-uuid',
      activeContext: null,
    } as ConversationMessageData);
    const result = await handleNaturalLanguage('a'.repeat(501), 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('Por favor');
    expect(result).toContain('sé más específico');
  });

  it('ApiError from processMessage is rethrown (bot wrapHandler handles)', async () => {
    mock.processMessage.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    await expect(
      handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient)
    ).rejects.toThrow(ApiError);
  });

  it('estimation intent: processMessage is called with the text', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    await handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledWith('big mac', 0, undefined);
  });

  it('concurrent calls do not interfere — stateless per call', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_NULL));
    await Promise.all([
      handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient),
      handleNaturalLanguage('whopper', 0, makeMockRedis(), mock as unknown as ApiClient),
    ]);
    expect(mock.processMessage).toHaveBeenCalledTimes(2);
    const calls = mock.processMessage.mock.calls as Array<[string]>;
    const texts = calls.map((c) => c[0]).sort();
    expect(texts).toEqual(['big mac', 'whopper']);
  });

  it('estimation result with kcal → formatted output contains calories', async () => {
    mock.processMessage.mockResolvedValue(makeEstimationResponse(ESTIMATE_DATA_WITH_RESULT));
    const result = await handleNaturalLanguage('big mac', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('563');
  });
});

// ---------------------------------------------------------------------------
// F043 NL Comparison Detection (updated for F070 refactor)
//
// After F070: comparison routing happens in ConversationCore.
// Bot adapter formats comparison intent via formatComparison.
// ---------------------------------------------------------------------------

describe('handleNaturalLanguage — comparison detection', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  const COMPARISON_RESPONSE: ConversationMessageData = {
    intent: 'comparison',
    actorId: 'a-uuid',
    comparison: {
      dishA: ESTIMATE_DATA_WITH_RESULT,
      dishB: ESTIMATE_DATA_WITH_RESULT,
    },
    activeContext: null,
  };

  const COMPARISON_WITH_FOCUS: ConversationMessageData = {
    intent: 'comparison',
    actorId: 'a-uuid',
    comparison: {
      dishA: ESTIMATE_DATA_WITH_RESULT,
      dishB: ESTIMATE_DATA_WITH_RESULT,
      nutrientFocus: 'calorías',
    },
    activeContext: null,
  };

  it('comparison intent → processMessage called once, result formatted', async () => {
    mock.processMessage.mockResolvedValue(COMPARISON_RESPONSE);
    await handleNaturalLanguage('compara big mac con whopper', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(mock.processMessage).toHaveBeenCalledOnce();
  });

  it('comparison with nutrientFocus calorías → output contains "(foco)"', async () => {
    mock.processMessage.mockResolvedValue(COMPARISON_WITH_FOCUS);
    const result = await handleNaturalLanguage('qué engorda más, una pizza o una hamburguesa', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('(foco)');
  });

  it('comparison without nutrientFocus → output does NOT contain "(foco)"', async () => {
    mock.processMessage.mockResolvedValue(COMPARISON_RESPONSE);
    const result = await handleNaturalLanguage('qué es más sano, una ensalada o un bollo', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).not.toContain('(foco)');
  });

  it('one side null result → does not crash', async () => {
    const oneNull: ConversationMessageData = {
      intent: 'comparison',
      actorId: 'a-uuid',
      comparison: {
        dishA: ESTIMATE_DATA_WITH_RESULT,
        dishB: ESTIMATE_DATA_NULL,
      },
      activeContext: null,
    };
    mock.processMessage.mockResolvedValue(oneNull);
    const result = await handleNaturalLanguage('compara big mac con xyz', 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('Big Mac');
    expect(result).toContain('No se encontraron datos');
  });

  it('text_too_long intent for long comparison text → "sé más específico"', async () => {
    mock.processMessage.mockResolvedValue({
      intent: 'text_too_long',
      actorId: 'a-uuid',
      activeContext: null,
    } as ConversationMessageData);
    const result = await handleNaturalLanguage('a'.repeat(510), 0, makeMockRedis(), mock as unknown as ApiClient);
    expect(result).toContain('específico');
  });
});
