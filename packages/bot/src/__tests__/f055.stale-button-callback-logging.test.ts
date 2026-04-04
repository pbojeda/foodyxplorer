// F055: Stale-button nonce validation + unknown callback_data logging.
//
// I7: Photo keyboard callbacks include a nonce. Stale nonce → user-friendly error.
// S6: Unknown callback_data → logger.warn (not silently swallowed).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { handlePhoto } from '../handlers/fileUpload.js';
import { handleCallbackQuery } from '../handlers/callbackQuery.js';
import type { BotConfig } from '../config.js';
import { logger } from '../logger.js';

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
// I7 — Nonce in photo keyboard callback_data
// ==========================================================================

describe('F055 — handlePhoto includes nonce in callback_data', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('callback_data includes nonce (format: action:nonce)', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

    // Each callback should have format action:nonce (with colon separator)
    for (const cb of callbacks) {
      expect(cb).toMatch(/^upload_(?:menu|dish|ingest):[a-f0-9]+$/);
    }
  });

  it('stores pendingPhotoNonce in Redis state', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);
    expect(state.pendingPhotoNonce).toBeDefined();
    expect(typeof state.pendingPhotoNonce).toBe('string');
    expect(state.pendingPhotoNonce.length).toBeGreaterThanOrEqual(8);
  });

  it('nonce in callback_data matches nonce in state', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(makePhotoMsg(CHAT_ID), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    // Get stored nonce
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized);

    // Get callback nonces
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    const nonces = callbacks.map((cb) => cb.split(':')[1]);

    // All callback nonces should match stored nonce
    for (const n of nonces) {
      expect(n).toBe(state.pendingPhotoNonce);
    }
  });
});

// ==========================================================================
// I7 — Stale nonce rejection
// ==========================================================================

describe('F055 — stale nonce rejected in callback handler', () => {
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

  it('matching nonce → processes normally', async () => {
    const nonce = 'abc12345';
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: nonce }),
    );
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'auto',
      dishCount: 0,
      dishes: [],
      partial: false,
    });

    await handleCallbackQuery(makeQuery(`upload_menu:${nonce}`), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });

  it('wrong nonce → shows stale-button error, does NOT call API', async () => {
    const storedNonce = 'abc12345';
    const staleNonce = 'old99999';
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: storedNonce }),
    );

    await handleCallbackQuery(makeQuery(`upload_menu:${staleNonce}`), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('foto') || t.includes('expirado') || t.includes('válid'))).toBe(true);
  });

  it('stale nonce on upload_dish → same rejection', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: 'current' }),
    );

    await handleCallbackQuery(makeQuery('upload_dish:stale'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
  });

  it('stale nonce on upload_ingest → same rejection', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        pendingPhotoFileId: 'file-id',
        pendingPhotoNonce: 'current',
        selectedRestaurant: { id: 'r1', name: 'Test' },
      }),
    );

    await handleCallbackQuery(makeQuery('upload_ingest:stale'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// S6 — Unknown callback_data logging
// ==========================================================================

describe('F055 — unknown callback_data logged at warn level', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('unknown callback_data triggers logger.warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    await handleCallbackQuery(makeQuery('unknown_action'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT_ID, data: 'unknown_action' }),
      expect.stringContaining('Unknown callback_data'),
    );

    warnSpy.mockRestore();
  });

  it('known callback_data does NOT trigger unknown-callback warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: 'abc123' }),
    );

    const fetchMock = vi.fn().mockResolvedValue(makeFetchOkWithBuffer(JPEG_BUFFER));
    vi.stubGlobal('fetch', fetchMock);

    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'auto', dishCount: 0, dishes: [], partial: false,
    });

    await handleCallbackQuery(makeQuery('upload_menu:abc123'), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    // Should NOT have the "Unknown callback_data" warn
    const unknownCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[1] === 'string' && call[1].includes('Unknown callback_data'),
    );
    expect(unknownCalls).toHaveLength(0);

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
