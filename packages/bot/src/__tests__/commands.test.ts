// Unit tests for all command handlers.
// ApiClient is mocked — no real HTTP, no real Telegram.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { DishListItem, RestaurantListItem, ChainListItem, EstimateData, PaginationMeta } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { handleStart } from '../commands/start.js';
import { handleBuscar } from '../commands/buscar.js';
import { handleEstimar } from '../commands/estimar.js';
import { handleRestaurantes } from '../commands/restaurantes.js';
import { handlePlatos } from '../commands/platos.js';
import { handleCadenas } from '../commands/cadenas.js';
import { handleInfo } from '../commands/info.js';
import { handleApiError } from '../commands/errorMessages.js';
import type { BotConfig } from '../config.js';

// ---------------------------------------------------------------------------
// MockApiClient
// ---------------------------------------------------------------------------

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
  };
}

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-api-key',
  BOT_VERSION: '0.1.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [],
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 };
const SINGLE_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 };
const _MORE_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, totalItems: 50, totalPages: 5 };

const DISH_ITEM: DishListItem = {
  id: 'fd000000-0001-4000-a000-000000000001',
  name: 'Big Mac',
  nameEs: 'Big Mac',
  restaurantId: 'fd000000-0002-4000-a000-000000000001',
  chainSlug: 'mcdonalds-es',
  restaurantName: "McDonald's Spain",
  availability: 'available',
  portionGrams: 200,
  priceEur: 5.5,
};

const RESTAURANT_ITEM: RestaurantListItem = {
  id: 'fd000000-0003-4000-a000-000000000001',
  name: "McDonald's Spain",
  nameEs: null,
  chainSlug: 'mcdonalds-es',
  countryCode: 'ES',
  isActive: true,
  logoUrl: null,
  website: null,
  address: null,
  dishCount: 42,
};

const CHAIN_ITEM: ChainListItem = {
  chainSlug: 'mcdonalds-es',
  name: "McDonald's",
  nameEs: null,
  countryCode: 'ES',
  dishCount: 150,
  isActive: true,
};

const ESTIMATE_DATA_NULL: EstimateData = {
  query: 'xyz',
  chainSlug: null,
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
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  cachedAt: null,
  result: {
    entityType: 'dish',
    entityId: DISH_ITEM.id,
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: DISH_ITEM.restaurantId,
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
// handleStart
// ---------------------------------------------------------------------------

describe('handleStart', () => {
  it('returns a non-empty string', () => {
    expect(handleStart().length).toBeGreaterThan(0);
  });

  it('contains /buscar', () => {
    expect(handleStart()).toContain('/buscar');
  });

  it('contains /estimar', () => {
    expect(handleStart()).toContain('/estimar');
  });

  it('contains /restaurantes', () => {
    expect(handleStart()).toContain('/restaurantes');
  });

  it('contains /platos', () => {
    expect(handleStart()).toContain('/platos');
  });

  it('contains /cadenas', () => {
    expect(handleStart()).toContain('/cadenas');
  });

  it('contains /info', () => {
    expect(handleStart()).toContain('/info');
  });

  it('contains /help', () => {
    expect(handleStart()).toContain('/help');
  });

  it('contains at least one MarkdownV2 bold marker', () => {
    expect(handleStart()).toContain('*');
  });

  it('is a static response — no API call needed', () => {
    // Just verify it returns synchronously without any async work
    const result = handleStart();
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// handleBuscar
// ---------------------------------------------------------------------------

describe('handleBuscar', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('returns usage hint for empty args', async () => {
    const result = await handleBuscar('', mock as unknown as ApiClient);
    expect(result).toContain('/buscar');
    expect(mock.searchDishes).not.toHaveBeenCalled();
  });

  it('returns usage hint for whitespace-only args', async () => {
    const result = await handleBuscar('   ', mock as unknown as ApiClient);
    expect(result).toContain('/buscar');
    expect(mock.searchDishes).not.toHaveBeenCalled();
  });

  it('calls searchDishes with trimmed args and defaults', async () => {
    mock.searchDishes.mockResolvedValue({ items: [DISH_ITEM], pagination: SINGLE_PAGINATION });
    await handleBuscar('big mac', mock as unknown as ApiClient);
    expect(mock.searchDishes).toHaveBeenCalledWith({ q: 'big mac', page: 1, pageSize: 10 });
  });

  it('returns formatted dish list on happy path', async () => {
    mock.searchDishes.mockResolvedValue({ items: [DISH_ITEM], pagination: SINGLE_PAGINATION });
    const result = await handleBuscar('big mac', mock as unknown as ApiClient);
    expect(result).toContain('Big Mac');
  });

  it('returns no-results message when API returns empty items', async () => {
    mock.searchDishes.mockResolvedValue({ items: [], pagination: EMPTY_PAGINATION });
    const result = await handleBuscar('xyz123', mock as unknown as ApiClient);
    expect(result).toContain('No se encontraron platos');
  });

  it('returns rate-limit message for 429 ApiError', async () => {
    mock.searchDishes.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handleBuscar('test', mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });

  it('returns config-error message for 401 ApiError', async () => {
    mock.searchDishes.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    const result = await handleBuscar('test', mock as unknown as ApiClient);
    expect(result).toContain('configuracion');
  });

  it('returns service-unavailable message for 500 ApiError', async () => {
    mock.searchDishes.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Server error'));
    const result = await handleBuscar('test', mock as unknown as ApiClient);
    expect(result).toContain('no esta disponible');
  });

  it('returns timeout message for TIMEOUT code', async () => {
    mock.searchDishes.mockRejectedValue(new ApiError(408, 'TIMEOUT', 'Timeout'));
    const result = await handleBuscar('test', mock as unknown as ApiClient);
    expect(result).toContain('tardo demasiado');
  });

  it('returns network-error message for NETWORK_ERROR code', async () => {
    mock.searchDishes.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network'));
    const result = await handleBuscar('test', mock as unknown as ApiClient);
    expect(result).toContain('conectar');
  });
});

// ---------------------------------------------------------------------------
// handleEstimar
// ---------------------------------------------------------------------------

describe('handleEstimar', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('returns usage hint for empty args', async () => {
    const result = await handleEstimar('', mock as unknown as ApiClient);
    expect(result).toContain('/estimar');
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it('calls estimate without chainSlug when no " en " present', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('big mac', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'big mac' });
  });

  it('splits on " en " and sets chainSlug when suffix matches slug format', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('big mac en mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'mcdonalds-es' });
  });

  it('splits on LAST " en " for "pollo en salsa en mcdonalds-es"', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('pollo en salsa en mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'pollo en salsa', chainSlug: 'mcdonalds-es' });
  });

  it('does NOT split when suffix "salsa" lacks a hyphen (not a chainSlug format)', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('pollo en salsa', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'pollo en salsa' });
  });

  it('splits "ensalada en mcdonalds-es" correctly', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleEstimar('ensalada en mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.estimate).toHaveBeenCalledWith({ query: 'ensalada', chainSlug: 'mcdonalds-es' });
  });

  it('returns formatted estimate card when result is non-null', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleEstimar('big mac', mock as unknown as ApiClient);
    expect(result).toContain('Big Mac');
    expect(result).toContain('563');
  });

  it('returns no-data message when result is null', async () => {
    mock.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const result = await handleEstimar('xyz dish', mock as unknown as ApiClient);
    expect(result).toContain('No se encontraron datos nutricionales');
  });

  it('returns rate-limit message for 429 ApiError', async () => {
    mock.estimate.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handleEstimar('test', mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });

  it('returns timeout message for TIMEOUT code', async () => {
    mock.estimate.mockRejectedValue(new ApiError(408, 'TIMEOUT', 'Timeout'));
    const result = await handleEstimar('test', mock as unknown as ApiClient);
    expect(result).toContain('tardo demasiado');
  });
});

// ---------------------------------------------------------------------------
// handleRestaurantes
// ---------------------------------------------------------------------------

describe('handleRestaurantes', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('calls listRestaurants with no chainSlug when args empty', async () => {
    mock.listRestaurants.mockResolvedValue({ items: [RESTAURANT_ITEM], pagination: SINGLE_PAGINATION });
    await handleRestaurantes('', mock as unknown as ApiClient);
    expect(mock.listRestaurants).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
  });

  it('calls listRestaurants with chainSlug when args provided', async () => {
    mock.listRestaurants.mockResolvedValue({ items: [RESTAURANT_ITEM], pagination: SINGLE_PAGINATION });
    await handleRestaurantes('mcdonalds-es', mock as unknown as ApiClient);
    expect(mock.listRestaurants).toHaveBeenCalledWith({ chainSlug: 'mcdonalds-es', page: 1, pageSize: 10 });
  });

  it('returns chain-specific not-found message when empty results with chainSlug', async () => {
    mock.listRestaurants.mockResolvedValue({ items: [], pagination: EMPTY_PAGINATION });
    const result = await handleRestaurantes('mcdonalds-es', mock as unknown as ApiClient);
    expect(result).toContain('mcdonalds');
    expect(result).toContain('/cadenas');
  });

  it('returns generic not-found message when empty results without filter', async () => {
    mock.listRestaurants.mockResolvedValue({ items: [], pagination: EMPTY_PAGINATION });
    const result = await handleRestaurantes('', mock as unknown as ApiClient);
    expect(result).toContain('No hay restaurantes');
  });

  it('returns formatted list on happy path', async () => {
    mock.listRestaurants.mockResolvedValue({ items: [RESTAURANT_ITEM], pagination: SINGLE_PAGINATION });
    const result = await handleRestaurantes('', mock as unknown as ApiClient);
    expect(result).toContain("McDonald's Spain");
  });

  it('returns rate-limit message for 429 ApiError', async () => {
    mock.listRestaurants.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handleRestaurantes('', mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });
});

// ---------------------------------------------------------------------------
// handlePlatos
// ---------------------------------------------------------------------------

describe('handlePlatos', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('returns usage hint for empty args', async () => {
    const result = await handlePlatos('', mock as unknown as ApiClient);
    expect(result).toContain('/platos');
    expect(mock.listRestaurantDishes).not.toHaveBeenCalled();
  });

  it('returns UUID format error for invalid UUID', async () => {
    const result = await handlePlatos('abc', mock as unknown as ApiClient);
    expect(result).toContain('UUID');
    expect(mock.listRestaurantDishes).not.toHaveBeenCalled();
  });

  it('returns not-found message for 404 from API', async () => {
    mock.listRestaurantDishes.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'));
    const result = await handlePlatos('fd000000-0001-4000-a000-000000000001', mock as unknown as ApiClient);
    expect(result).toContain('No se encontro');
  });

  it('returns formatted dish list on happy path', async () => {
    mock.listRestaurantDishes.mockResolvedValue({ items: [DISH_ITEM], pagination: SINGLE_PAGINATION });
    const result = await handlePlatos('fd000000-0001-4000-a000-000000000001', mock as unknown as ApiClient);
    expect(result).toContain('Big Mac');
  });

  it('returns rate-limit message for 429 ApiError', async () => {
    mock.listRestaurantDishes.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handlePlatos('fd000000-0001-4000-a000-000000000001', mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });
});

// ---------------------------------------------------------------------------
// handleCadenas
// ---------------------------------------------------------------------------

describe('handleCadenas', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('returns formatted chain list on happy path', async () => {
    mock.listChains.mockResolvedValue([CHAIN_ITEM]);
    const result = await handleCadenas(mock as unknown as ApiClient);
    expect(result).toContain("McDonald's");
  });

  it('returns no-chains message for empty results', async () => {
    mock.listChains.mockResolvedValue([]);
    const result = await handleCadenas(mock as unknown as ApiClient);
    expect(result).toContain('No hay cadenas');
  });

  it('returns rate-limit message for 429 ApiError', async () => {
    mock.listChains.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));
    const result = await handleCadenas(mock as unknown as ApiClient);
    expect(result).toContain('Demasiadas consultas');
  });

  it('returns network-error message for NETWORK_ERROR', async () => {
    mock.listChains.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network'));
    const result = await handleCadenas(mock as unknown as ApiClient);
    expect(result).toContain('conectar');
  });
});

// ---------------------------------------------------------------------------
// handleInfo
// ---------------------------------------------------------------------------

describe('handleInfo', () => {
  let mock: MockApiClient;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it('contains bot version and "conectada" when healthCheck resolves true', async () => {
    mock.healthCheck.mockResolvedValue(true);
    const result = await handleInfo(TEST_CONFIG, mock as unknown as ApiClient);
    // Version is escaped for MarkdownV2 — periods become \.
    expect(result).toContain('0\\.1\\.0');
    expect(result).toContain('conectada');
  });

  it('contains "Sin conexion" when healthCheck resolves false', async () => {
    mock.healthCheck.mockResolvedValue(false);
    const result = await handleInfo(TEST_CONFIG, mock as unknown as ApiClient);
    expect(result).toContain('Sin conexion');
  });

  it('contains "Sin conexion" when healthCheck rejects (tolerates failure)', async () => {
    mock.healthCheck.mockRejectedValue(new Error('network'));
    const result = await handleInfo(TEST_CONFIG, mock as unknown as ApiClient);
    expect(result).toContain('Sin conexion');
  });
});

// ---------------------------------------------------------------------------
// handleApiError (errorMessages)
// ---------------------------------------------------------------------------

describe('handleApiError', () => {
  it('returns rate-limit message for 429', () => {
    expect(handleApiError(new ApiError(429, 'RATE_LIMIT', 'x'))).toContain('Demasiadas consultas');
  });

  it('returns config-error message for 401', () => {
    expect(handleApiError(new ApiError(401, 'UNAUTHORIZED', 'x'))).toContain('configuracion');
  });

  it('returns config-error message for 403', () => {
    expect(handleApiError(new ApiError(403, 'FORBIDDEN', 'x'))).toContain('configuracion');
  });

  it('returns service-unavailable for 500', () => {
    expect(handleApiError(new ApiError(500, 'SERVER_ERROR', 'x'))).toContain('no esta disponible');
  });

  it('returns service-unavailable for 503', () => {
    expect(handleApiError(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toContain('no esta disponible');
  });

  it('returns timeout message for TIMEOUT code', () => {
    expect(handleApiError(new ApiError(408, 'TIMEOUT', 'x'))).toContain('tardo demasiado');
  });

  it('returns network-error message for NETWORK_ERROR code', () => {
    expect(handleApiError(new ApiError(0, 'NETWORK_ERROR', 'x'))).toContain('conectar');
  });

  it('returns generic error for unknown ApiError', () => {
    expect(handleApiError(new ApiError(418, 'TEAPOT', 'x'))).toContain('error inesperado');
  });

  it('returns generic error for non-ApiError (plain Error)', () => {
    expect(handleApiError(new Error('surprise'))).toContain('error inesperado');
  });
});
