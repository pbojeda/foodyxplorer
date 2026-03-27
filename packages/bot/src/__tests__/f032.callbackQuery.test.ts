// Unit tests for handleCallbackQuery handler (F032).
//
// TelegramBot and ApiClient are mocked — no real Telegram, no real HTTP.
// Redis is injected as a plain mock object (DI — no module-level mock needed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { ApiError } from '../apiClient.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';

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

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
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
// sel:{uuid} — select restaurant from search results
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — sel:{uuid}', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('looks up name in searchResults from Redis state, saves selectedRestaurant, and sends confirmation', async () => {
    const state = { searchResults: { 'uuid-abc': "McDonald's Madrid" }, pendingSearch: 'mcdonalds' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

    await handleCallbackQuery(makeQuery('sel:uuid-abc'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    // Should save the selectedRestaurant
    expect(redis.set).toHaveBeenCalledOnce();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { selectedRestaurant?: { id: string; name: string } };
    expect(saved.selectedRestaurant?.id).toBe('uuid-abc');
    expect(saved.selectedRestaurant?.name).toBe("McDonald's Madrid");

    // Should send confirmation
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text).toContain('McDonald');
  });

  it('always calls answerCallbackQuery with the query id', async () => {
    const state = { searchResults: { 'uuid-abc': 'Some Restaurant' } };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

    await handleCallbackQuery(makeQuery('sel:uuid-abc'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('sends fallback message when UUID not found in searchResults', async () => {
    const state = { searchResults: { 'uuid-other': 'Other Restaurant' } };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

    await handleCallbackQuery(makeQuery('sel:uuid-missing'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    // Should tell user to try again
    expect(text.toLowerCase()).toMatch(/no se pudo|intenta/);
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });

  it('sends fallback message when state is null (Redis miss)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('sel:uuid-abc'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.answerCallbackQuery).toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// create_rest — create restaurant from pending search
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — create_rest', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('reads pendingSearch from state and calls createRestaurant with name + ES', async () => {
    const state = { pendingSearch: 'New Restaurant Name' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockResolvedValue(CREATED_RESTAURANT);

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(apiClient.createRestaurant).toHaveBeenCalledWith({
      name: 'New Restaurant Name',
      countryCode: 'ES',
    });
  });

  it('saves created restaurant as selectedRestaurant in state', async () => {
    const state = { pendingSearch: 'New Restaurant Name' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockResolvedValue(CREATED_RESTAURANT);

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { selectedRestaurant?: { id: string; name: string } };
    expect(saved.selectedRestaurant?.id).toBe(CREATED_RESTAURANT.id);
    expect(saved.selectedRestaurant?.name).toBe(CREATED_RESTAURANT.name);
  });

  it('sends confirmation message after creation', async () => {
    const state = { pendingSearch: 'New Restaurant' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockResolvedValue(CREATED_RESTAURANT);

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text).toContain('New Restaurant');
  });

  it('always calls answerCallbackQuery', async () => {
    const state = { pendingSearch: 'New Restaurant' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockResolvedValue(CREATED_RESTAURANT);

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('sends "ya existe" message when createRestaurant throws 409', async () => {
    const state = { pendingSearch: 'Duplicate Restaurant' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockRejectedValue(
      new ApiError(409, 'DUPLICATE_RESTAURANT', 'Restaurant already exists'),
    );

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('ya existe');
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });

  it('sends generic error message when createRestaurant throws non-409 ApiError', async () => {
    const state = { pendingSearch: 'Some Restaurant' };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));
    apiClient.createRestaurant.mockRejectedValue(
      new ApiError(500, 'SERVER_ERROR', 'Internal error'),
    );

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text).toContain('disponible');
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });

  it('sends fallback message when pendingSearch is missing from state', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({}));

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(apiClient.createRestaurant).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });

  it('sends fallback message when state is null', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('create_rest'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(apiClient.createRestaurant).not.toHaveBeenCalled();
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unknown callback_data
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — unknown data', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('calls answerCallbackQuery and does NOT send a message for unknown data', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('unknown_action'), bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('exits early when query.message is undefined (no chatId)', async () => {
    const queryNoMessage = {
      id: 'qid',
      from: { id: 1, is_bot: false, first_name: 'Test' },
      data: 'sel:uuid-abc',
    } as unknown as TelegramBot.CallbackQuery;

    await handleCallbackQuery(queryNoMessage, bot as never, apiClient as unknown as ApiClient, redis, DEFAULT_CONFIG);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('qid');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});
