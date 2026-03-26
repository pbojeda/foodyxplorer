// QA edge-case tests for F031 — Bot File Upload.
//
// Covers gaps NOT addressed by the developer-written test suite:
//
//   QA-B1   msg.photo is an empty array [] → handlePhoto crashes with TypeError (BUG)
//   QA-B2   msg.document.mime_type is undefined → falls back to '' → MIME guard triggers
//   QA-B3   Redis getState throws during handlePhoto → fail-open: keyboard still shown
//   QA-B4   Redis setState throws during handlePhoto → fail-open: keyboard still sent
//   QA-B5   photo.file_size is 0 → passes the size check (0 <= MAX), keyboard shown
//   QA-B6   photo.file_size is undefined → treated as 0 by ?? 0, keyboard shown
//   QA-B7   file_size exactly equal to 10 MB → passes (check is >, not >=), keyboard shown
//   QA-B8   file_size exactly equal to 10 MB + 1 byte → triggers "too large" message
//   QA-B9   uploadImage returns dishesUpserted: 0 (no error) → success summary sent with 0
//   QA-B10  chainSlug is empty string in state → would be appended to FormData and fail at API (400)
//   QA-B11  upload_ingest: fetch response has ok=false → download error message sent
//   QA-B12  upload_ingest: fetch throws → download error message sent (regression guard)
//   QA-B13  callbackQuery: query.message is undefined → spinner dismissed, no crash
//   QA-B14  document.file_name contains non-ASCII chars → used as filename (EC-7 from spec)
//   QA-B15  handleDocument: ALLOWED_CHAT_IDS guard checked before MIME type check
//   QA-B16  handlePhoto: Redis TTL is refreshed on setState (EX, TTL_SECONDS present)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handlePhoto, handleDocument } from '../handlers/fileUpload.js';
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
  };
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

const UPLOAD_RESULT = {
  dishesFound: 5,
  dishesUpserted: 4,
  dishesSkipped: 1,
  dryRun: false,
  dishes: [],
  skippedReasons: [],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function makePhotoMsg(chatId: number, photos: TelegramBot.PhotoSize[]): TelegramBot.Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: 'private' },
    photo: photos,
  } as unknown as TelegramBot.Message;
}

function makeDocMsg(
  chatId: number,
  mimeType: string | undefined,
  fileSize?: number,
  fileName?: string,
): TelegramBot.Message {
  return {
    message_id: 2,
    date: 0,
    chat: { id: chatId, type: 'private' },
    document: {
      file_id: 'doc-file-id',
      file_unique_id: 'doc-unique-id',
      file_name: fileName,
      mime_type: mimeType,
      file_size: fileSize ?? 1024,
    },
  } as unknown as TelegramBot.Message;
}

function makeQuery(data: string, chatId = ALLOWED_CHAT_ID): TelegramBot.CallbackQuery {
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

// ---------------------------------------------------------------------------
// QA-B1: msg.photo is an empty array [] — BUG: crashes with TypeError
// ---------------------------------------------------------------------------

describe('QA-B1: handlePhoto — empty msg.photo array', () => {
  it('does NOT crash when msg.photo is [] (empty array bypasses !msg.photo guard)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    // Empty photo array — [] is truthy so it passes the !msg.photo guard,
    // then photos[photos.length - 1] is undefined, causing TypeError on .file_size
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, []);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    // The function is wrapped in a try/catch in bot.ts, but the function itself
    // should handle this gracefully rather than throwing to the outer catch.
    // This test documents the BUG: handlePhoto currently throws TypeError.
    await expect(
      handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED),
    ).resolves.toBeUndefined(); // Should not throw — returns undefined gracefully
  });
});

// ---------------------------------------------------------------------------
// QA-B2: msg.document.mime_type is undefined
// ---------------------------------------------------------------------------

describe('QA-B2: handleDocument — mime_type is undefined', () => {
  it('sends MIME error when document.mime_type is undefined (treated as empty string)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const msg = makeDocMsg(ALLOWED_CHAT_ID, undefined);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // undefined mime_type → ?? '' → not PDF, not image → MIME error sent
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toMatch(/pdf|imagen/);
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// QA-B3: Redis getState throws during handlePhoto — fail-open behavior
// ---------------------------------------------------------------------------

describe('QA-B3: handlePhoto — Redis getState throws (fail-open)', () => {
  it('treats failed getState as null state → sends "Primero selecciona" message', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    // Redis.get throws (connection refused, etc.)
    (redis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-1',
      file_unique_id: 'unique-1',
      width: 1280,
      height: 720,
      file_size: 500,
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // getState fail-open → state is null → no selectedRestaurant → "Primero selecciona"
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('restaurante');
  });
});

// ---------------------------------------------------------------------------
// QA-B4: Redis setState throws during handlePhoto — fail-open, keyboard still sent
// ---------------------------------------------------------------------------

describe('QA-B4: handlePhoto — Redis setState throws (fail-open)', () => {
  it('still sends the inline keyboard even when setState fails (Redis down)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    // setState throws — simulates Redis write failure
    (redis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis write failed'));

    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-1',
      file_unique_id: 'unique-1',
      width: 1280,
      height: 720,
      file_size: 500,
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    // Should not throw — fail-open means setState error is silently swallowed
    await expect(
      handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED),
    ).resolves.toBeUndefined();

    // The inline keyboard message should still be sent despite setState failure
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    const keyboard = (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] })?.inline_keyboard;
    expect(keyboard).toBeDefined();
    expect(keyboard?.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// QA-B5/B6/B7/B8: file_size boundary cases in handlePhoto
// ---------------------------------------------------------------------------

describe('QA-B5/B6/B7/B8: handlePhoto — file_size boundary cases', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
  });

  it('QA-B5: file_size is 0 → passes size check, keyboard shown', async () => {
    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-zero',
      file_unique_id: 'unique-zero',
      width: 100,
      height: 100,
      file_size: 0,
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    expect(
      (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] } | undefined)?.inline_keyboard,
    ).toBeDefined();
  });

  it('QA-B6: file_size is undefined → ?? 0 → passes size check, keyboard shown', async () => {
    const photoSize = {
      file_id: 'file-id-no-size',
      file_unique_id: 'unique-no-size',
      width: 640,
      height: 480,
      // file_size intentionally omitted
    } as TelegramBot.PhotoSize;
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    expect(
      (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] } | undefined)?.inline_keyboard,
    ).toBeDefined();
  });

  it('QA-B7: file_size exactly at 10 MB limit → passes (> not >=), keyboard shown', async () => {
    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-exact',
      file_unique_id: 'unique-exact',
      width: 3000,
      height: 4000,
      file_size: MAX_FILE_SIZE, // exactly 10 MB — should NOT trigger "too large"
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text, opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    // Must NOT be the "too large" message
    expect(text.toLowerCase()).not.toContain('10 mb');
    // Must be the keyboard message
    expect(
      (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] } | undefined)?.inline_keyboard,
    ).toBeDefined();
  });

  it('QA-B8: file_size is 10 MB + 1 byte → triggers "too large" error, no keyboard', async () => {
    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-oversized',
      file_unique_id: 'unique-oversized',
      width: 3000,
      height: 4000,
      file_size: MAX_FILE_SIZE + 1,
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text, opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    expect(text.toLowerCase()).toContain('10 mb');
    expect(
      (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] } | undefined)?.inline_keyboard,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// QA-B9: uploadImage returns dishesUpserted: 0 (no error) — success path
// ---------------------------------------------------------------------------

describe('QA-B9: upload_ingest — uploadImage returns dishesUpserted: 0 (no error)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends success summary with dishesUpserted: 0 when API returns zero upserted without error', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id-123',
      }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const zeroUpsertResult = {
      dishesFound: 3,
      dishesUpserted: 0,
      dishesSkipped: 3,
      dryRun: false,
      dishes: [],
      skippedReasons: [
        { dishName: 'Dish1', reason: 'Missing proteins' },
        { dishName: 'Dish2', reason: 'Missing proteins' },
        { dishName: 'Dish3', reason: 'Missing proteins' },
      ],
    };
    apiClient.uploadImage.mockResolvedValue(zeroUpsertResult);

    await handleCallbackQuery(
      makeQuery('upload_ingest'),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_ALLOWED,
    );

    // Should NOT throw — should send a success summary even with 0 upserted
    const lastCall = bot.sendMessage.mock.calls[bot.sendMessage.mock.calls.length - 1] as [number, string, TelegramBot.SendMessageOptions];
    expect(lastCall[1]).toContain('Ingesta');
    expect(lastCall[1]).toContain('0'); // dishesUpserted: 0 appears in message
    expect(lastCall[2]?.parse_mode).toBe('MarkdownV2');
  });
});

// ---------------------------------------------------------------------------
// QA-B10: chainSlug is empty string in state — passed to API as empty string
// ---------------------------------------------------------------------------

describe('QA-B10: handleDocument — chainSlug is empty string in state', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes empty string chainSlug to uploadPdf (API will reject with 400 — bot does not pre-validate)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    // chainSlug is empty string — this is an invalid value but could theoretically
    // end up in state if data integrity is not enforced upstream
    const restaurantWithEmptySlug = {
      id: 'rest-uuid-001',
      name: 'Some Restaurant',
      chainSlug: '',
    };

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: restaurantWithEmptySlug }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    // Simulate API rejecting the empty chainSlug with 400 VALIDATION_ERROR
    apiClient.uploadPdf.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'chainSlug must match pattern ^[a-z0-9-]+$'),
    );

    const msg: TelegramBot.Message = {
      message_id: 2,
      date: 0,
      chat: { id: ALLOWED_CHAT_ID, type: 'private' },
      document: {
        file_id: 'doc-file-id',
        file_unique_id: 'doc-unique-id',
        file_name: 'menu.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
      },
    } as unknown as TelegramBot.Message;

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // uploadPdf should have been called with empty string chainSlug
    expect(apiClient.uploadPdf).toHaveBeenCalledOnce();
    const [uploadParams] = apiClient.uploadPdf.mock.calls[0] as [{ chainSlug?: string }];
    expect(uploadParams.chainSlug).toBe('');

    // Bot should send an error message (generic ApiError path)
    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('error') || t.includes('procesar'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QA-B11: upload_ingest — fetch response has ok=false → download error message
// ---------------------------------------------------------------------------

describe('QA-B11: upload_ingest — fetch response not ok', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends download error message when Telegram CDN returns non-2xx response', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        selectedRestaurant: SELECTED_RESTAURANT,
        pendingPhotoFileId: 'file-id-123',
      }),
    );

    // fetch returns a 403 Forbidden response (e.g., expired Telegram CDN URL)
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await handleCallbackQuery(
      makeQuery('upload_ingest'),
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_ALLOWED,
    );

    expect(apiClient.uploadImage).not.toHaveBeenCalled();
    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('descargar'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QA-B12: handleDocument — fetch response has ok=false → download error message
// ---------------------------------------------------------------------------

describe('QA-B12: handleDocument — fetch response not ok', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends download error message when Telegram CDN returns non-2xx for document', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    // fetch returns 500 from Telegram CDN
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', 1024, 'menu.pdf');

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('descargar'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QA-B13: callbackQuery — query.message is undefined → spinner dismissed, no crash
// ---------------------------------------------------------------------------

describe('QA-B13: handleCallbackQuery — query.message is undefined', () => {
  it('dismisses spinner and returns without sending messages when query.message is undefined', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    const queryWithoutMessage: TelegramBot.CallbackQuery = {
      id: 'query-id-002',
      from: { id: 1, is_bot: false, first_name: 'Test' },
      data: 'upload_ingest',
      // message is intentionally absent
    } as unknown as TelegramBot.CallbackQuery;

    await handleCallbackQuery(
      queryWithoutMessage,
      bot as never,
      apiClient as unknown as ApiClient,
      redis,
      TEST_CONFIG_ALLOWED,
    );

    // Spinner must be dismissed (no crash from undefined chatId)
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('query-id-002');
    // No messages should be sent (no chatId to send to)
    expect(bot.sendMessage).not.toHaveBeenCalled();
    // No API calls
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// QA-B14: handleDocument — file_name contains non-ASCII characters (spec EC-7)
// ---------------------------------------------------------------------------

describe('QA-B14: handleDocument — non-ASCII filename (spec edge case EC-7)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses non-ASCII filename as-is when document.file_name contains accented characters', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    const nonAsciiFilename = 'menú-primavera-2026.pdf';
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', 1024, nonAsciiFilename);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.uploadPdf).toHaveBeenCalledOnce();
    const [uploadParams] = apiClient.uploadPdf.mock.calls[0] as [{ filename: string }];
    expect(uploadParams.filename).toBe(nonAsciiFilename);
  });

  it('uses "document.pdf" fallback when document.file_name is undefined', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', 1024, undefined);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [uploadParams] = apiClient.uploadPdf.mock.calls[0] as [{ filename: string }];
    expect(uploadParams.filename).toBe('document.pdf');
  });

  it('uses "image.jpg" fallback when JPEG document has no filename', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'image/jpeg', 1024, undefined);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [uploadParams] = apiClient.uploadImage.mock.calls[0] as [{ filename: string }];
    expect(uploadParams.filename).toBe('image.jpg');
  });
});

// ---------------------------------------------------------------------------
// QA-B15: handleDocument — ALLOWED_CHAT_IDS guard is checked BEFORE MIME type
// ---------------------------------------------------------------------------

describe('QA-B15: handleDocument — ALLOWED_CHAT_IDS guard order', () => {
  it('silently ignores blocked chat even for supported MIME types (guard before MIME check)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // This is a supported MIME type (application/pdf) but from a blocked chat
    const msg = makeDocMsg(999, 'application/pdf');

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_BLOCKED);

    // No message should be sent — silent ignore takes precedence over MIME validation
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('silently ignores blocked chat for unsupported MIME types too (guard fires first)', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    const msg = makeDocMsg(999, 'application/vnd.ms-excel');

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_BLOCKED);

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// QA-B16: handlePhoto — setState is called with EX TTL argument
// ---------------------------------------------------------------------------

describe('QA-B16: handlePhoto — Redis setState refreshes TTL', () => {
  it('calls redis.set with EX and a positive TTL value', async () => {
    const redis = makeMockRedis();
    const bot = makeMockBot();
    const apiClient = makeMockClient();

    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const photoSize: TelegramBot.PhotoSize = {
      file_id: 'file-id-ttl-test',
      file_unique_id: 'unique-ttl',
      width: 1280,
      height: 720,
      file_size: 500,
    };
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, [photoSize]);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(redis.set).toHaveBeenCalledOnce();
    const setArgs = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    // Args: [key, value, 'EX', ttlSeconds]
    expect(setArgs[2]).toBe('EX');
    expect(typeof setArgs[3]).toBe('number');
    expect(setArgs[3] as number).toBeGreaterThan(0);
  });
});
