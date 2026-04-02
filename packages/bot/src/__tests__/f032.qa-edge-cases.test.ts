// F032 QA edge-case tests — bot side — written by QA to expose gaps.
//
// Covers:
//  1.  handleRestaurante — query with only whitespace is treated as "no args" (no search)
//  2.  handleRestaurante — API returns more than 5 results (client slices to 5)
//  3.  handleRestaurante — Redis set fails on zero results (fail-open, no crash)
//  4.  handleRestaurante — API timeout error shows user-visible message
//  5.  handleRestaurante — no args + Redis error → graceful "no context" message
//  6.  handleCallbackQuery — sel: prefix with zero-length uuid (empty string after "sel:")
//  7.  handleCallbackQuery — callback_data is undefined (query.data is undefined)
//  8.  handleCallbackQuery — create_rest with pendingSearch containing MarkdownV2 special chars
//  9.  handleCallbackQuery — Redis set failure during create_rest (fail-open)
//  10. handleCallbackQuery — answerCallbackQuery failure does not crash handler
//  11. conversationState — setState preserves existing state fields (no clobber)
//  12. conversationState — getState with very large stored JSON (no truncation expected)
//  13. apiClient.searchRestaurants — sends pageSize=5 (bot cap matches inline keyboard max)
//  14. apiClient.createRestaurant — sends Content-Type: application/json header

import { describe, it, expect, vi } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient, PaginatedResult } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import type { RestaurantListItem, PaginationMeta } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';

const DEFAULT_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-key',
  REDIS_URL: 'redis://localhost:6380',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  BOT_VERSION: '0.0.1',
  ALLOWED_CHAT_IDS: [],
};
import { handleRestaurante } from '../commands/restaurante.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
import { getState, setState } from '../lib/conversationState.js';
import type { BotState } from '../lib/conversationState.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } as unknown as Redis;
}

function makeMockBot() {
  return {
    sendMessage: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
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
  };
}

const PAGINATION: PaginationMeta = { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 };

function makeRestaurantItem(id: string, name: string): RestaurantListItem {
  return {
    id,
    name,
    nameEs: null,
    chainSlug: 'test-es',
    countryCode: 'ES',
    isActive: true,
    logoUrl: null,
    website: null,
    dishCount: 0,
    address: null,
  };
}

function makeSearchResult(items: RestaurantListItem[]): PaginatedResult<RestaurantListItem> {
  return {
    items,
    pagination: { ...PAGINATION, totalItems: items.length, totalPages: items.length > 0 ? 1 : 0 },
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

const CREATED_RESTAURANT = {
  id: 'new-restaurant-uuid',
  name: 'New Restaurant',
  nameEs: null,
  chainSlug: 'independent-new-restaurant-abcd',
  countryCode: 'ES',
  isActive: true,
  address: null,
  googleMapsUrl: null,
  latitude: null,
  longitude: null,
  logoUrl: null,
  website: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// 1: handleRestaurante — whitespace-only query treated as empty (no search)
// ---------------------------------------------------------------------------

describe('handleRestaurante — whitespace-only args (QA)', () => {
  it('1: whitespace-only args do not trigger a search — shows context instead', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleRestaurante('   ', 123, bot as never, apiClient as unknown as ApiClient, redis);

    // Should NOT call searchRestaurants (whitespace trims to empty string)
    expect(apiClient.searchRestaurants).not.toHaveBeenCalled();
    // Should send the "no hay restaurante" message
    expect(bot.sendMessage).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2: handleRestaurante — API returns >5 results (client-side slicing)
// ---------------------------------------------------------------------------

describe('handleRestaurante — API returns more than 5 results (QA)', () => {
  it('2: inline keyboard is capped at 5 buttons when API returns 6 items', async () => {
    // The bot requests pageSize=5 but tests that the slice(0, MAX_RESULTS) guard works
    // if the API somehow returns more.
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const items = Array.from({ length: 6 }, (_, i) =>
      makeRestaurantItem(`uuid-${i}`, `Restaurant ${i}`),
    );
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult(items));

    await handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis);

    const [, , options] = bot.sendMessage.mock.calls[0] as [
      number,
      string,
      { reply_markup?: { inline_keyboard: unknown[] } },
    ];
    // Must be capped at 5 regardless of API returning 6
    expect(options.reply_markup?.inline_keyboard).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 3: handleRestaurante — Redis set fails on zero results (fail-open)
// ---------------------------------------------------------------------------

describe('handleRestaurante — Redis failure on zero results (QA)', () => {
  it('3: Redis set failure on empty results does not crash (fail-open)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    // Redis.set rejects — should be swallowed by setState
    (redis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult([]));

    await expect(
      handleRestaurante('unknown place', 123, bot as never, apiClient as unknown as ApiClient, redis),
    ).resolves.toBeUndefined();

    // Bot should still send the "Crear restaurante" message
    expect(bot.sendMessage).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 4: handleRestaurante — API timeout error
// ---------------------------------------------------------------------------

describe('handleRestaurante — API timeout (QA)', () => {
  it('4: 408 TIMEOUT error shows user-visible message without throwing', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    apiClient.searchRestaurants.mockRejectedValue(
      new ApiError(408, 'TIMEOUT', 'Request timed out'),
    );

    await expect(
      handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis),
    ).resolves.toBeUndefined();

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    // Should contain some user-visible error (not re-throw)
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5: handleRestaurante — empty args + Redis error → graceful no-context message
// ---------------------------------------------------------------------------

describe('handleRestaurante — empty args + Redis error (QA)', () => {
  it('5: Redis.get failure on empty args shows graceful no-context message', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    await expect(
      handleRestaurante('', 123, bot as never, apiClient as unknown as ApiClient, redis),
    ).resolves.toBeUndefined();

    // getState returns null on error (fail-open), so bot should say "no context"
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('no hay restaurante');
  });
});

// ---------------------------------------------------------------------------
// 6: handleCallbackQuery — sel: with empty uuid string
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — sel: edge cases (QA)', () => {
  it('6: sel: with empty string after prefix sends fallback (no crash)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    // State has no searchResults entry for empty string
    const state = { searchResults: { 'uuid-abc': 'Some Restaurant' } };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    await handleCallbackQuery(
      makeQuery('sel:'),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      DEFAULT_CONFIG,
    );

    // Empty string key not in searchResults → fallback message
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toMatch(/no se pudo|intenta/);
  });
});

// ---------------------------------------------------------------------------
// 7: handleCallbackQuery — query.data is undefined
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — undefined callback_data (QA)', () => {
  it('7: query.data undefined is treated as empty string, handler dismisses spinner silently', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    const queryNoData = {
      id: 'qid',
      from: { id: 1, is_bot: false, first_name: 'Test' },
      data: undefined,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 123, type: 'private' },
      },
    } as unknown as TelegramBot.CallbackQuery;

    await expect(
      handleCallbackQuery(queryNoData, bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG),
    ).resolves.toBeUndefined();

    // Should answer the callback (dismiss spinner) and NOT send a message
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8: handleCallbackQuery — create_rest with MarkdownV2 special chars in pendingSearch
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — create_rest with MarkdownV2 special chars (QA)', () => {
  it('8: pendingSearch with MarkdownV2 special chars does not crash bot', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    // Name with chars that are reserved in MarkdownV2
    const state = { pendingSearch: "Café & Bistro (Madrid) — 2026!" };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    apiClient.createRestaurant.mockResolvedValue({
      ...CREATED_RESTAURANT,
      name: "Café & Bistro (Madrid) — 2026!",
    });

    await expect(
      handleCallbackQuery(
        makeQuery('create_rest'),
        bot as never,
        apiClient as unknown as ApiClient,
        redis,
        DEFAULT_CONFIG,
      ),
    ).resolves.toBeUndefined();

    // Should send a confirmation without crashing
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9: handleCallbackQuery — Redis set failure during create_rest (fail-open)
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — create_rest Redis failure (QA)', () => {
  it('9: Redis.set failure after successful creation does not crash (fail-open)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    const state = { pendingSearch: 'New Restaurant' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    // Redis.set rejects after creation
    (redis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));
    apiClient.createRestaurant.mockResolvedValue(CREATED_RESTAURANT);

    await expect(
      handleCallbackQuery(
        makeQuery('create_rest'),
        bot as never,
        apiClient as unknown as ApiClient,
        redis,
        DEFAULT_CONFIG,
      ),
    ).resolves.toBeUndefined();

    // Confirmation message should still be sent
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10: handleCallbackQuery — answerCallbackQuery failure does not crash
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — answerCallbackQuery failure (QA)', () => {
  it('10: Telegram answerCallbackQuery failure (network error) is swallowed by safeAnswerCallback', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    const state = { searchResults: { 'uuid-abc': 'Some Restaurant' } };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    // answerCallbackQuery rejects — safeAnswerCallback swallows the error
    bot.answerCallbackQuery.mockRejectedValue(new Error('Telegram API down'));

    await expect(
      handleCallbackQuery(
        makeQuery('sel:uuid-abc'),
        bot as never,
        apiClient as unknown as ApiClient,
        redis,
        DEFAULT_CONFIG,
      ),
    ).resolves.toBeUndefined();

    // The handler completes successfully despite answerCallbackQuery failure
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11: conversationState — setState preserves existing fields (merge behaviour)
// ---------------------------------------------------------------------------

describe('conversationState — setState merge behaviour (QA)', () => {
  it('11: setState with spread preserves searchResults when only selectedRestaurant changes', async () => {
    const redis = makeMockRedis();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const initialState: BotState = {
      searchResults: { 'uuid-1': 'Restaurant One', 'uuid-2': 'Restaurant Two' },
      pendingSearch: 'rest',
    };

    // Simulate what callbackQuery.ts does: spread + overwrite selectedRestaurant
    const newState: BotState = {
      ...initialState,
      selectedRestaurant: { id: 'uuid-1', name: 'Restaurant One' },
    };

    await setState(redis, 100, newState);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as BotState;

    // searchResults and pendingSearch must be preserved
    expect(saved.searchResults?.['uuid-1']).toBe('Restaurant One');
    expect(saved.pendingSearch).toBe('rest');
    expect(saved.selectedRestaurant?.id).toBe('uuid-1');
  });
});

// ---------------------------------------------------------------------------
// 12: conversationState — very large stored JSON does not corrupt on parse
// ---------------------------------------------------------------------------

describe('conversationState — large JSON payload (QA)', () => {
  it('12: getState with 100-entry searchResults parses without error', async () => {
    const redis = makeMockRedis();

    const bigSearchResults: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      bigSearchResults[`uuid-${i.toString().padStart(3, '0')}`] = `Restaurant ${i} with a very long name to stress test the JSON parsing`;
    }

    const bigState: BotState = {
      pendingSearch: 'test',
      searchResults: bigSearchResults,
    };

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(bigState));

    const result = await getState(redis, 123);

    expect(result).not.toBeNull();
    expect(Object.keys(result?.searchResults ?? {}).length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 13: apiClient.searchRestaurants — sends pageSize=5
// ---------------------------------------------------------------------------

describe('apiClient.searchRestaurants — pageSize cap (QA)', () => {
  it('13: searchRestaurants always sends pageSize=5 in the request URL', async () => {
    const { createApiClient } = await import('../apiClient.js');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      API_BASE_URL: 'http://localhost:3001',
      BOT_API_KEY: 'test-key',
      BOT_VERSION: '0.0.0',
      LOG_LEVEL: 'info' as const,
      NODE_ENV: 'test' as const,
      ADMIN_API_KEY: 'admin-key',
      REDIS_URL: 'redis://localhost:6380',
      ALLOWED_CHAT_IDS: [] as number[],
    };

    const data = { items: [], pagination: { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 } };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
    });

    const client = createApiClient(config);
    await client.searchRestaurants('test');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('pageSize=5');

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// 14: apiClient.createRestaurant — sends Content-Type: application/json
// ---------------------------------------------------------------------------

describe('apiClient.createRestaurant — Content-Type header (QA)', () => {
  it('14: createRestaurant sends Content-Type: application/json header', async () => {
    const { createApiClient } = await import('../apiClient.js');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      API_BASE_URL: 'http://localhost:3001',
      BOT_API_KEY: 'test-key',
      BOT_VERSION: '0.0.0',
      LOG_LEVEL: 'info' as const,
      NODE_ENV: 'test' as const,
      ADMIN_API_KEY: 'admin-key',
      REDIS_URL: 'redis://localhost:6380',
      ALLOWED_CHAT_IDS: [] as number[],
    };

    const createdData = {
      id: 'new-uuid', name: 'Test', nameEs: null, chainSlug: 'independent-test-abcd',
      countryCode: 'ES', isActive: true, address: null, googleMapsUrl: null,
      latitude: null, longitude: null, logoUrl: null, website: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: createdData }),
    });

    const client = createApiClient(config);
    await client.createRestaurant({ name: 'Test', countryCode: 'ES' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');

    vi.unstubAllGlobals();
  });
});
