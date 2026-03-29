// F056: When detectMimeType returns null (unknown magic bytes), return a
// user-friendly error instead of silently defaulting to image/jpeg.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
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
  };
}

const CHAT_ID = 123;
const NONCE = 'abc12345';

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

// Buffer with unknown magic bytes (not JPEG, PNG, WebP, or PDF)
const UNKNOWN_BUFFER = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

// Valid JPEG buffer
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
// F056 — Unknown MIME type returns error
// ==========================================================================

describe('F056 — upload_menu rejects unknown MIME type', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unknown magic bytes → error message, API NOT called', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: NONCE }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchOkWithBuffer(UNKNOWN_BUFFER)));

    await handleCallbackQuery(makeQuery(`upload_menu:${NONCE}`), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('formato') || t.includes('soportado'))).toBe(true);
  });

  it('valid JPEG → proceeds normally', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: NONCE }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchOkWithBuffer(JPEG_BUFFER)));
    apiClient.analyzeMenu.mockResolvedValue({
      mode: 'auto', dishCount: 0, dishes: [], partial: false,
    });

    await handleCallbackQuery(makeQuery(`upload_menu:${NONCE}`), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).toHaveBeenCalled();
  });
});

describe('F056 — upload_dish rejects unknown MIME type', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unknown magic bytes → error message, API NOT called', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ pendingPhotoFileId: 'file-id', pendingPhotoNonce: NONCE }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchOkWithBuffer(UNKNOWN_BUFFER)));

    await handleCallbackQuery(makeQuery(`upload_dish:${NONCE}`), bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG);

    expect(apiClient.analyzeMenu).not.toHaveBeenCalled();
    const messages = (bot.sendMessage.mock.calls as Array<[number, string, unknown]>).map(([, t]) => t.toLowerCase());
    expect(messages.some((t) => t.includes('formato') || t.includes('soportado'))).toBe(true);
  });
});
