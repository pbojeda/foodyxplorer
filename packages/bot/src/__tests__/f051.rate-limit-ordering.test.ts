// F051: Rate-limit ordering fixes.
//
// Bug C1: isRateLimited must be checked BEFORE downloadTelegramFile.
// Bug I11: /receta must NOT consume a rate-limit slot on API failure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
import { handleReceta } from '../commands/receta.js';
import type { BotConfig } from '../config.js';

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

const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]);

function makeFetchOkWithBuffer(buf: Buffer) {
  return {
    ok: true,
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(buf.length);
      const view = new Uint8Array(ab);
      view.set(buf);
      return ab;
    },
  };
}

const ALLOWED_CHAT_ID = 123;

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-bot-key',
  BOT_VERSION: '0.0.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [ALLOWED_CHAT_ID],
};

const CHAT_ID = 42;

// ==========================================================================
// C1: Rate limit BEFORE download (upload_menu / upload_dish)
// ==========================================================================

describe('F051 C1 — upload_menu: rate limit checked BEFORE file download', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    bot = makeMockBot();
    apiClient = makeMockClient();
    fetchMock = vi.fn().mockResolvedValue(makeFetchOkWithBuffer(JPEG_BUFFER));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rate-limited user triggers ZERO file downloads', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    // Over the limit
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    // Rate-limited: fetch (downloadTelegramFile) should NOT have been called
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bot.getFileLink).not.toHaveBeenCalled();
    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('non-limited user still downloads and processes normally', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'auto',
      dishCount: 0,
      dishes: [],
      partial: false,
    });

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    // Should have downloaded and called API
    expect(fetchMock).toHaveBeenCalled();
    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });
});

describe('F051 C1 — upload_dish: rate limit checked BEFORE file download', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    bot = makeMockBot();
    apiClient = makeMockClient();
    fetchMock = vi.fn().mockResolvedValue(makeFetchOkWithBuffer(JPEG_BUFFER));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rate-limited user triggers ZERO file downloads', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bot.getFileLink).not.toHaveBeenCalled();
    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('non-limited user still downloads and processes normally', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'identify',
      dishCount: 1,
      dishes: [{ dishName: 'Pizza', estimate: null }],
      partial: false,
    });

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(fetchMock).toHaveBeenCalled();
    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });
});

// ==========================================================================
// I11: /receta — rate limit NOT consumed on API failure
// ==========================================================================

describe('F051 I11 — /receta rate limit not consumed on API failure', () => {
  let mock: ReturnType<typeof makeMockClient>;
  let redis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeMockClient();
    redis = makeMockRedis();
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (redis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  it('successful API call: rate-limit counter stays incremented', async () => {
    mock.calculateRecipe.mockResolvedValue({
      totalNutrients: { calories: 500, proteins: 30, carbohydrates: 60, fats: 20 },
      ingredients: [],
      unresolvedIngredients: [],
      confidence: 'medium',
    });

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    // Counter incremented and NOT decremented
    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).not.toHaveBeenCalled();
  });

  it('API timeout (ApiError TIMEOUT): decrements rate-limit counter', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(408, 'TIMEOUT', 'Request timed out'),
    );

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    // Counter should be decremented after failure
    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).toHaveBeenCalledOnce();
  });

  it('API server error (500): decrements rate-limit counter', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Server error'),
    );

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).toHaveBeenCalledOnce();
  });

  it('API network error: decrements rate-limit counter', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Connection refused'),
    );

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).toHaveBeenCalledOnce();
  });

  it('recipe-specific error (RECIPE_UNRESOLVABLE 422): does NOT decrement (user error)', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'RECIPE_UNRESOLVABLE', 'Cannot resolve'),
    );

    await handleReceta('xyz random garbage', CHAT_ID, mock as unknown as ApiClient, redis);

    // 422 is a user input error, NOT a server failure — keep the counter
    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).not.toHaveBeenCalled();
  });

  it('recipe-specific error (FREE_FORM_PARSE_FAILED 422): does NOT decrement (user error)', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(422, 'FREE_FORM_PARSE_FAILED', 'Parse failed'),
    );

    await handleReceta('...', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).not.toHaveBeenCalled();
  });

  it('API rate limit (429): does NOT decrement (legitimate throttle)', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(429, 'RATE_LIMIT', 'Too many requests'),
    );

    await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.decr).not.toHaveBeenCalled();
  });

  it('decrement failure (Redis error) is silently swallowed', async () => {
    mock.calculateRecipe.mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Server error'),
    );
    (redis.decr as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    // Should not throw
    const result = await handleReceta('200g pollo', CHAT_ID, mock as unknown as ApiClient, redis);

    // Still returns the error message to the user
    expect(result).toBeTruthy();
  });
});
