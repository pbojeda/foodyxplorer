// F053: Decouple menu analysis from restaurant selection.
//
// handlePhoto() should show inline keyboard WITHOUT requiring selectedRestaurant.
// upload_ingest callback still requires restaurant; upload_menu and upload_dish do not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { handlePhoto } from '../handlers/fileUpload.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
import type { BotConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
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

function makePhotoMsg(chatId: number): TelegramBot.Message {
  const photo: TelegramBot.PhotoSize = {
    file_id: 'photo-file-id',
    file_unique_id: 'unique-1',
    width: 800,
    height: 600,
    file_size: 50000,
  };
  return {
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: 'private' },
    photo: [photo],
  } as unknown as TelegramBot.Message;
}

function makeQuery(data: string, chatId = CHAT_ID): TelegramBot.CallbackQuery {
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

// ==========================================================================
// handlePhoto without restaurant selected
// ==========================================================================

describe('F053 — handlePhoto works without selectedRestaurant', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('shows inline keyboard when no restaurant is selected (state null)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    // Should show keyboard, NOT "Primero selecciona" error
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: unknown[][] } }];
    const keyboard = options.reply_markup?.inline_keyboard ?? [];
    expect(keyboard.length).toBeGreaterThanOrEqual(2);
  });

  it('shows inline keyboard when state exists but no selectedRestaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ pendingSearch: 'something' }));

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: unknown[][] } }];
    expect(options.reply_markup?.inline_keyboard).toBeDefined();
  });

  it('stores pendingPhotoFileId even without restaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(redis.set).toHaveBeenCalled();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);
    expect(state.pendingPhotoFileId).toBe('photo-file-id');
  });

  it('shows all 3 buttons when restaurant IS selected', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: { id: 'r1', name: 'Test' } }),
    );

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    expect(callbacks.some((c) => c.startsWith('upload_ingest:'))).toBe(true);
    expect(callbacks.some((c) => c.startsWith('upload_menu:'))).toBe(true);
    expect(callbacks.some((c) => c.startsWith('upload_dish:'))).toBe(true);
  });

  it('shows only analyze/identify buttons when no restaurant (no upload_ingest)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    expect(callbacks.some((c) => c.startsWith('upload_ingest:'))).toBe(false);
    expect(callbacks.some((c) => c.startsWith('upload_menu:'))).toBe(true);
    expect(callbacks.some((c) => c.startsWith('upload_dish:'))).toBe(true);
  });
});

// ==========================================================================
// upload_ingest still requires restaurant
// ==========================================================================

describe('F053 — upload_ingest still requires selectedRestaurant', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('upload_ingest without restaurant shows helpful error', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id' }),
    );

    await handleCallbackQuery(makeQuery('upload_ingest'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('restaurante'))).toBe(true);
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// upload_menu/upload_dish work without restaurant
// ==========================================================================

describe('F053 — upload_menu/upload_dish work without selectedRestaurant', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
    fetchMock = vi.fn().mockResolvedValue(makeFetchOkWithBuffer(JPEG_BUFFER));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('upload_menu succeeds without selectedRestaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id' }),
    );
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'auto',
      dishCount: 0,
      dishes: [],
      partial: false,
    });

    await handleCallbackQuery(makeQuery('upload_menu'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });

  it('upload_dish succeeds without selectedRestaurant', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id' }),
    );
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'identify',
      dishCount: 1,
      dishes: [{ dishName: 'Pizza', estimate: null }],
      partial: false,
    });

    await handleCallbackQuery(makeQuery('upload_dish'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });
});
