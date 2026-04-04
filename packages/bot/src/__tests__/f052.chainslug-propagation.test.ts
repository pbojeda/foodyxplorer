// F052: Restaurant selection chainSlug propagation.
//
// Verifies that chainSlug is stored in searchResults and propagated
// into selectedRestaurant when the user selects or creates a restaurant.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
import { handleRestaurante } from '../commands/restaurante.js';
import type { BotConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(0),
  } as unknown as Redis;
}

function makeMockBot() {
  return {
    sendMessage: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    getFileLink: vi.fn().mockResolvedValue('https://telegram.org/file/bot-token/file_id'),
  };
}

function makeMockClient(): { [K in keyof ApiClient]: ReturnType<typeof vi.fn> } {
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

function makeQuery(data: string, chatId = 123): TelegramBot.CallbackQuery {
  return {
    id: 'query-id-001',
    from: { id: 1, is_bot: false, first_name: 'Test' },
    data,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: chatId, type: 'private' },
    },
  } as unknown as TelegramBot.CallbackQuery;
}

const CHAT_ID = 123;

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-bot-key',
  BOT_VERSION: '0.0.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [CHAT_ID],
};

// ==========================================================================
// /restaurante search stores chainSlug in searchResults
// ==========================================================================

describe('F052 — /restaurante stores chainSlug in searchResults', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('searchResults entries include chainSlug from API response', async () => {
    apiClient.searchRestaurants.mockResolvedValue({
      items: [
        { id: 'uuid-1', name: "McDonald's Spain", chainSlug: 'mcdonalds-es', countryCode: 'ES', isActive: true, dishCount: 100, nameEs: null, logoUrl: null, website: null },
        { id: 'uuid-2', name: "Burger King Spain", chainSlug: 'burger-king-es', countryCode: 'ES', isActive: true, dishCount: 80, nameEs: null, logoUrl: null, website: null },
      ],
      pagination: { page: 1, pageSize: 5, totalItems: 2, totalPages: 1 },
    });

    await handleRestaurante('mcdonalds', CHAT_ID, bot as never, apiClient as unknown as ApiClient, redis);

    // Verify searchResults was stored with chainSlug
    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    expect(state.searchResults['uuid-1']).toEqual({ name: "McDonald's Spain", chainSlug: 'mcdonalds-es' });
    expect(state.searchResults['uuid-2']).toEqual({ name: "Burger King Spain", chainSlug: 'burger-king-es' });
  });

  it('independent restaurant (no chainSlug) stores name only', async () => {
    apiClient.searchRestaurants.mockResolvedValue({
      items: [
        { id: 'uuid-3', name: 'Bar Paco', chainSlug: 'independent-bar-paco-abc12345', countryCode: 'ES', isActive: true, dishCount: 5, nameEs: null, logoUrl: null, website: null },
      ],
      pagination: { page: 1, pageSize: 5, totalItems: 1, totalPages: 1 },
    });

    await handleRestaurante('paco', CHAT_ID, bot as never, apiClient as unknown as ApiClient, redis);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    // Independent restaurants still have a chainSlug (auto-generated), store it
    expect(state.searchResults['uuid-3']).toEqual({ name: 'Bar Paco', chainSlug: 'independent-bar-paco-abc12345' });
  });
});

// ==========================================================================
// sel:{uuid} propagates chainSlug into selectedRestaurant
// ==========================================================================

describe('F052 — sel:{uuid} propagates chainSlug to selectedRestaurant', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('selectedRestaurant includes chainSlug from enriched searchResults', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        searchResults: {
          'uuid-1': { name: "McDonald's Spain", chainSlug: 'mcdonalds-es' },
        },
      }),
    );

    await handleCallbackQuery(makeQuery('sel:uuid-1'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    expect(state.selectedRestaurant).toEqual({
      id: 'uuid-1',
      name: "McDonald's Spain",
      chainSlug: 'mcdonalds-es',
    });
  });

  it('selectedRestaurant without chainSlug for independent restaurants', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        searchResults: {
          'uuid-3': { name: 'Bar Paco' },
        },
      }),
    );

    await handleCallbackQuery(makeQuery('sel:uuid-3'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    expect(state.selectedRestaurant).toEqual({
      id: 'uuid-3',
      name: 'Bar Paco',
    });
  });

  it('backward compat: old-format searchResults (string value) still works', async () => {
    // Old format: { [uuid]: "name string" }
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        searchResults: {
          'uuid-old': "Old Restaurant Name",
        },
      }),
    );

    await handleCallbackQuery(makeQuery('sel:uuid-old'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    expect(state.selectedRestaurant).toEqual({
      id: 'uuid-old',
      name: 'Old Restaurant Name',
    });
  });
});

// ==========================================================================
// create_rest includes chainSlug from API response
// ==========================================================================

describe('F052 — create_rest includes chainSlug from API response', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('created restaurant includes chainSlug in selectedRestaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingSearch: 'New Place' }),
    );
    apiClient.createRestaurant.mockResolvedValue({
      id: 'new-uuid',
      name: 'New Place',
      chainSlug: 'independent-new-place-abc12345',
      countryCode: 'ES',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    expect(state.selectedRestaurant).toEqual({
      id: 'new-uuid',
      name: 'New Place',
      chainSlug: 'independent-new-place-abc12345',
    });
  });
});
