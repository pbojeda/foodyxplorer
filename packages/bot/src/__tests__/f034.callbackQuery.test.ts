// Unit tests for F034 callbackQuery extensions:
// upload_menu and upload_dish callback branches (real implementation replacing stubs).
//
// Mocks: bot (sendMessage, answerCallbackQuery, getFileLink), apiClient, Redis.
// fetch is stubbed globally for downloadTelegramFile.
// Redis incr/expire are also mocked for the per-user rate limit.

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

// JPEG magic bytes: FF D8 FF
const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]);

const MENU_ANALYSIS_RESULT = {
  mode: 'auto' as const,
  dishCount: 2,
  dishes: [
    {
      dishName: 'Big Mac',
      estimate: {
        result: {
          name: 'Big Mac',
          nameEs: 'Big Mac',
          nutrients: {
            calories: 550,
            proteins: 25,
            carbohydrates: 45,
            fats: 30,
            fiber: 2,
            saturatedFats: 10,
            sodium: 800,
            salt: 2,
          },
          portionGrams: 200,
          chainSlug: null,
          confidenceLevel: 'high',
        },
      },
    },
    {
      dishName: 'Hamburgesa Especial',
      estimate: null,
    },
  ],
  partial: false,
};

const SINGLE_DISH_RESULT = {
  mode: 'identify' as const,
  dishCount: 1,
  dishes: [
    {
      dishName: 'Paella Valenciana',
      estimate: {
        result: {
          name: 'Paella Valenciana',
          nameEs: 'Paella Valenciana',
          nutrients: {
            calories: 350,
            proteins: 18,
            carbohydrates: 55,
            fats: 8,
            fiber: 3,
            saturatedFats: 1,
            sodium: 500,
            salt: 1,
          },
          portionGrams: 300,
          chainSlug: null,
          confidenceLevel: 'medium',
        },
      },
    },
  ],
  partial: false,
};

/** Build a fake fetch response that returns the JPEG buffer bytes */
function makeFetchOkWithBuffer(buf: Buffer) {
  return {
    ok: true,
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(buf.length);
      const view = new Uint8Array(ab);
      buf.copy(Buffer.from(ab));
      view.set(buf);
      return ab;
    },
  };
}

// ---------------------------------------------------------------------------
// upload_menu
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — upload_menu (F034)', () => {
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

  it('always dismisses spinner via answerCallbackQuery', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-001');
  });

  it('ALLOWED_CHAT_IDS guard: silent ignore for blocked chat (no sendMessage)', async () => {
    await handleCallbackQuery(
      makeQuery('upload_menu', ALLOWED_CHAT_ID),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_BLOCKED,
    );

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends "La foto ha expirado" when pendingPhotoFileId is missing from state', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: { id: 'r1', name: 'Foo' } }),
    );

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('foto') || t.includes('expirado'))).toBe(true);
    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('sends error when Redis state is null (no pendingPhotoFileId)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('happy path: calls analyzeMenu with mode=auto and returns formatted message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'telegram-file-id-123',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).toHaveBeenCalledOnce();
    const [params] = apiClient.analyzeMenu.mock.calls[0] as [{ mode: string }];
    expect(params.mode).toBe('auto');
  });

  it('happy path: response message contains dish count', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, unknown];
    expect(lastCall[1]).toContain('2');
  });

  it('happy path: response mentions dish names', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, unknown];
    expect(lastCall[1]).toContain('Big Mac');
  });

  it('happy path: dishes with estimate=null show "(sin datos)"', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, unknown];
    expect(lastCall[1]).toContain('sin datos');
  });

  it('happy path: uses MarkdownV2 parse_mode', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, TelegramBot.SendMessageOptions];
    expect(lastCall[2]?.parse_mode).toBe('MarkdownV2');
  });

  it('partial results: shows partial note when partial=true', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue({ ...MENU_ANALYSIS_RESULT, partial: true });

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, unknown];
    expect(lastCall[1].toLowerCase()).toContain('parcial');
  });

  it('clears pendingPhotoFileId from Redis after successful API call', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    expect(saved.pendingPhotoFileId).toBeUndefined();
  });

  it('rate limit exceeded: sends rate limit message and does NOT call analyzeMenu', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    // incr returns 6 → over the 5/hour limit
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('límite') || t.includes('limite') || t.includes('many') || t.includes('máximo') || t.includes('demasiado'))).toBe(true);
  });

  it('rate limit: does NOT clear pendingPhotoFileId when rate limit blocks (per spec)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // redis.set should NOT be called for clearing pendingPhotoFileId
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rate limit: fail-open when Redis incr throws (allows the request)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis connection error'));
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // Fail-open: analyzeMenu should still be called despite Redis error
    expect(apiClient.analyzeMenu).toHaveBeenCalledOnce();
  });

  it('error MENU_ANALYSIS_FAILED: sends user-friendly Spanish message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'MENU_ANALYSIS_FAILED', 'Could not identify dishes'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('platos') || t.includes('identificar') || t.includes('analizar') || t.includes('menú') || t.includes('menu')
    )).toBe(true);
  });

  it('error INVALID_IMAGE: sends user-friendly Spanish message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'INVALID_IMAGE', 'Unsupported file type'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('imagen') || t.includes('formato') || t.includes('archivo') || t.includes('foto')
    )).toBe(true);
  });

  it('error OCR_FAILED: sends user-friendly Spanish message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'OCR_FAILED', 'OCR pipeline failed'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('texto') || t.includes('leer') || t.includes('ocr') || t.includes('legible') || t.includes('extraer')
    )).toBe(true);
  });

  it('error VISION_API_UNAVAILABLE: sends user-friendly Spanish message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'VISION_API_UNAVAILABLE', 'OpenAI not configured'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('servicio') || t.includes('disponible') || t.includes('configurado') || t.includes('visión') || t.includes('vision')
    )).toBe(true);
  });

  it('error RATE_LIMIT_EXCEEDED from API: sends rate limit message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('límite') || t.includes('limite') || t.includes('demasiado') || t.includes('máximo')
    )).toBe(true);
  });

  it('download failure: does NOT call analyzeMenu, sends download error', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    bot.getFileLink.mockRejectedValue(new Error('Telegram error'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('descargar') || t.includes('error'))).toBe(true);
  });

  it('download failure: does NOT clear pendingPhotoFileId', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    bot.getFileLink.mockRejectedValue(new Error('Telegram error'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('clears pendingPhotoFileId even when analyzeMenu throws (error path = API-attempt path)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'MENU_ANALYSIS_FAILED', 'No dishes'));

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    expect(saved.pendingPhotoFileId).toBeUndefined();
  });

  it('rate limit check uses correct Redis key (fxp:analyze:bot:<chatId>)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(MENU_ANALYSIS_RESULT);

    await handleCallbackQuery(makeQuery('upload_menu', ALLOWED_CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const incrKey = (redis.incr as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(incrKey).toBe(`fxp:analyze:bot:${ALLOWED_CHAT_ID}`);
  });
});

// ---------------------------------------------------------------------------
// upload_dish
// ---------------------------------------------------------------------------

describe('handleCallbackQuery — upload_dish (F034)', () => {
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

  it('always dismisses spinner via answerCallbackQuery', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

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

  it('calls analyzeMenu with mode=identify', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(SINGLE_DISH_RESULT);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).toHaveBeenCalledOnce();
    const [params] = apiClient.analyzeMenu.mock.calls[0] as [{ mode: string }];
    expect(params.mode).toBe('identify');
  });

  it('happy path: response contains the dish name', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(SINGLE_DISH_RESULT);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, unknown];
    expect(lastCall[1]).toContain('Paella Valenciana');
  });

  it('happy path: uses MarkdownV2 parse_mode', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(SINGLE_DISH_RESULT);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, TelegramBot.SendMessageOptions];
    expect(lastCall[2]?.parse_mode).toBe('MarkdownV2');
  });

  it('clears pendingPhotoFileId after successful call', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockResolvedValue(SINGLE_DISH_RESULT);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    expect(saved.pendingPhotoFileId).toBeUndefined();
  });

  it('rate limit exceeded: does NOT call analyzeMenu', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    (redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(6);

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('error MENU_ANALYSIS_FAILED: sends user-friendly message', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'MENU_ANALYSIS_FAILED', 'Could not identify dish'));

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) =>
      t.includes('plato') || t.includes('identificar') || t.includes('foto') || t.includes('imagen')
    )).toBe(true);
  });

  it('clears pendingPhotoFileId even when analyzeMenu throws', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: { id: 'r1', name: 'Test Rest' },
        pendingPhotoFileId: 'file-id',
      }),
    );
    apiClient.analyzeMenu.mockRejectedValue(new ApiError(422, 'MENU_ANALYSIS_FAILED', 'No dishes'));

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    expect(saved.pendingPhotoFileId).toBeUndefined();
  });

  it('sends "La foto ha expirado" when pendingPhotoFileId is missing', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: { id: 'r1', name: 'Test Rest' } }),
    );

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('foto') || t.includes('expirado'))).toBe(true);
    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });
});
