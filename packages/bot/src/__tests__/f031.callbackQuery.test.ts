// Unit tests for F031 callbackQuery extensions:
// upload_ingest, upload_menu, upload_dish callback branches.
//
// Pattern mirrors f032.callbackQuery.test.ts exactly — same fixtures,
// same describe/beforeEach structure. Extended with uploadImage/uploadPdf
// mock fns and getFileLink on the bot mock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
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

const ALLOWED_CHAT_ID = 123;

const TEST_CONFIG_ALLOWED: BotConfig = {
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

const TEST_CONFIG_BLOCKED: BotConfig = {
  ...TEST_CONFIG_ALLOWED,
  ALLOWED_CHAT_IDS: [],
};

const SELECTED_RESTAURANT = {
  id: 'rest-uuid-001',
  name: 'Test Restaurant',
};

const SELECTED_RESTAURANT_WITH_CHAIN = {
  id: 'rest-uuid-001',
  name: "McDonald's Test",
  chainSlug: 'mcdonalds-es',
};

const UPLOAD_RESULT = {
  dishesFound: 5,
  dishesUpserted: 4,
  dishesSkipped: 1,
  dryRun: false,
  dishes: [],
  skippedReasons: [],
};

// ---------------------------------------------------------------------------
// upload_ingest
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — upload_ingest', () => {
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
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('always dismisses spinner via answerCallbackQuery', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('ALLOWED_CHAT_IDS guard: silent ignore for unlisted chat ID (empty list)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(
      makeQuery('upload_ingest', ALLOWED_CHAT_ID),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_BLOCKED,
    );

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });

  it('sends "No hay restaurante seleccionado" when state is null', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('restaurante');
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });

  it('sends "No hay restaurante seleccionado" when state has no selectedRestaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ pendingSearch: 'something' }));

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('restaurante');
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });

  it('sends "La foto ha expirado" when pendingPhotoFileId is missing', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('foto');
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });

  it('happy path: sends "Procesando imagen…", calls getFileLink, calls uploadImage with correct params', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'telegram-file-id-123',
      }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // First message: "Procesando imagen…"
    const firstMessage = (bot.sendMessage.mock.calls[0] as [number, string, unknown])[1];
    expect(firstMessage.toLowerCase()).toContain('procesando');

    // getFileLink called with the stored fileId
    expect(bot.getFileLink).toHaveBeenCalledWith('telegram-file-id-123');

    // uploadImage called with correct params
    expect(apiClient.uploadImage).toHaveBeenCalledOnce();
    const [uploadParams] = apiClient.uploadImage.mock.calls[0] as [{ filename: string; mimeType: string; restaurantId: string; sourceId: string }];
    expect(uploadParams.filename).toBe('photo.jpg');
    expect(uploadParams.mimeType).toBe('image/jpeg');
    expect(uploadParams.restaurantId).toBe(SELECTED_RESTAURANT.id);
    expect(uploadParams.sourceId).toBe('00000000-0000-0000-0000-000000000099');
  });

  it('on success: clears pendingPhotoFileId from state', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'telegram-file-id-123',
      }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalledOnce();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    // pendingPhotoFileId should be absent (undefined serializes as absent key)
    expect(saved.pendingPhotoFileId).toBeUndefined();
  });

  it('on success: sends success summary with MarkdownV2', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, TelegramBot.SendMessageOptions];
    expect(lastCall[1]).toContain('Ingesta');
    expect(lastCall[2]?.parse_mode).toBe('MarkdownV2');
  });

  it('passes chainSlug to uploadImage when selectedRestaurant has chainSlug', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT_WITH_CHAIN,
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [uploadParams] = apiClient.uploadImage.mock.calls[0] as [{ chainSlug?: string }];
    expect(uploadParams.chainSlug).toBe('mcdonalds-es');
  });

  it('sends download error when bot.getFileLink throws', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id',
      }),
    );
    bot.getFileLink.mockRejectedValue(new Error('Telegram error'));

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.uploadImage).not.toHaveBeenCalled();
    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('descargar'))).toBe(true);
  });

  it('sends CONFIG_ERROR message when uploadImage throws ApiError(CONFIG_ERROR)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.uploadImage.mockRejectedValue(new ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured'));

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('configurado'))).toBe(true);
  });

  it('sends no-data message when uploadImage throws ApiError(NO_NUTRITIONAL_DATA_FOUND)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.uploadImage.mockRejectedValue(new ApiError(422, 'NO_NUTRITIONAL_DATA_FOUND', 'No data'));

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('nutricional'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// upload_menu
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — upload_menu', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('dismisses spinner', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('ALLOWED_CHAT_IDS guard: silent ignore for blocked chat', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(
      makeQuery('upload_menu', ALLOWED_CHAT_ID),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_BLOCKED,
    );

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends "foto expirada" message when no pendingPhotoFileId in state (F034 replaces stub)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toMatch(/foto|expirado/);
  });

  it('reads state from Redis (real implementation, not stub)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.get).toHaveBeenCalled();
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// upload_dish
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — upload_dish', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('dismisses spinner', async () => {
    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('ALLOWED_CHAT_IDS guard: silent ignore for blocked chat', async () => {
    await handleCallbackQuery(
      makeQuery('upload_dish', ALLOWED_CHAT_ID),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_BLOCKED,
    );

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends "foto expirada" message when no pendingPhotoFileId in state (F034 replaces stub)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toMatch(/foto|expirado/);
  });

  it('reads state from Redis (real implementation, not stub)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.get).toHaveBeenCalled();
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });
});
