// Unit tests for F031 fileUpload handler: handlePhoto and handleDocument.
//
// TelegramBot and ApiClient are mocked via DI — no module-level vi.mock needed.
// Redis is injected as a plain mock object.
// global.fetch is stubbed for Telegram file download tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { handlePhoto, handleDocument } from '../handlers/fileUpload.js';
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
    analyzeMenu: vi.fn(),
    calculateRecipe: vi.fn(),
  };
}

const TEST_CONFIG_ALLOWED: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-bot-key',
  BOT_VERSION: '0.0.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [123],
};

const TEST_CONFIG_BLOCKED: BotConfig = {
  ...TEST_CONFIG_ALLOWED,
  ALLOWED_CHAT_IDS: [],
};

const ALLOWED_CHAT_ID = 123;
const BLOCKED_CHAT_ID = 999;

/** Creates a Telegram photo message. photos array defaults to one 100-byte photo. */
function makePhotoMsg(
  chatId: number,
  photos?: TelegramBot.PhotoSize[],
  overrideSize?: number,
): TelegramBot.Message {
  const defaultPhoto: TelegramBot.PhotoSize = {
    file_id: 'file-id-high-res',
    file_unique_id: 'unique-id',
    width: 1280,
    height: 720,
    file_size: overrideSize ?? 500,
  };
  return {
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: 'private' },
    photo: photos ?? [defaultPhoto],
  } as unknown as TelegramBot.Message;
}

/** Creates a Telegram document message. */
function makeDocMsg(
  chatId: number,
  mime: string,
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
      mime_type: mime,
      file_size: fileSize ?? 1024,
    },
  } as unknown as TelegramBot.Message;
}

const SELECTED_RESTAURANT = {
  id: 'rest-uuid-001',
  name: 'Test Restaurant',
};

const SELECTED_RESTAURANT_WITH_CHAIN = {
  id: 'rest-uuid-001',
  name: 'McDonald\'s Test',
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
// handlePhoto
// ---------------------------------------------------------------------------

describe('handlePhoto', () => {
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

  it('ignores message from chat ID not in ALLOWED_CHAT_IDS (empty array)', async () => {
    const msg = makePhotoMsg(BLOCKED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_BLOCKED);

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores message from chat ID not in ALLOWED_CHAT_IDS (populated list, ID absent)', async () => {
    const msg = makePhotoMsg(BLOCKED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('shows inline keyboard (analyze/identify only) when no restaurant is selected (F053)', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    expect(callbacks).toContain('upload_menu');
    expect(callbacks).toContain('upload_dish');
    expect(callbacks).not.toContain('upload_ingest');
  });

  it('shows inline keyboard (analyze/identify only) when state has no selectedRestaurant (F053)', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ pendingSearch: 'something' }));

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    const callbacks = (options.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    expect(callbacks).toContain('upload_menu');
    expect(callbacks).not.toContain('upload_ingest');
  });

  it('sends "El archivo supera el límite" message when file_size > 10MB', async () => {
    const bigSize = 11 * 1024 * 1024;
    const msg = makePhotoMsg(ALLOWED_CHAT_ID, undefined, bigSize);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('10 mb');
    // No inline keyboard sent
    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    expect(opts?.reply_markup).toBeUndefined();
  });

  it('stores pendingPhotoFileId in Redis and sends 3-button inline keyboard', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // setState must be called with pendingPhotoFileId
    expect(redis.set).toHaveBeenCalledOnce();
    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { pendingPhotoFileId?: string };
    expect(saved.pendingPhotoFileId).toBe('file-id-high-res');

    // sendMessage must be called with 3-button keyboard
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    const keyboard = (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] })?.inline_keyboard;
    expect(keyboard).toBeDefined();
    expect(keyboard?.length).toBe(3);
  });

  it('inline keyboard buttons have correct callback_data values', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    const keyboard = (opts?.reply_markup as { inline_keyboard: TelegramBot.InlineKeyboardButton[][] })?.inline_keyboard;
    const allCallbackData = keyboard?.flat().map((btn) => btn.callback_data);
    expect(allCallbackData).toContain('upload_ingest');
    expect(allCallbackData).toContain('upload_menu');
    expect(allCallbackData).toContain('upload_dish');
  });

  it('setState preserves existing state fields alongside pendingPhotoFileId', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    const existingState = {
      selectedRestaurant: SELECTED_RESTAURANT,
      pendingSearch: 'old search',
    };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(existingState));

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const saved = JSON.parse(serialized) as { selectedRestaurant?: unknown; pendingSearch?: string; pendingPhotoFileId?: string };
    expect(saved.selectedRestaurant).toEqual(SELECTED_RESTAURANT);
    expect(saved.pendingSearch).toBe('old search');
    expect(saved.pendingPhotoFileId).toBe('file-id-high-res');
  });

  it('uses MarkdownV2 parse_mode for the keyboard message', async () => {
    const msg = makePhotoMsg(ALLOWED_CHAT_ID);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handlePhoto(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [, , opts] = bot.sendMessage.mock.calls[0] as [number, string, TelegramBot.SendMessageOptions];
    expect(opts?.parse_mode).toBe('MarkdownV2');
  });
});

// ---------------------------------------------------------------------------
// handleDocument
// ---------------------------------------------------------------------------

describe('handleDocument', () => {
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

  it('silently ignores document from chat ID not in ALLOWED_CHAT_IDS', async () => {
    const msg = makeDocMsg(BLOCKED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_BLOCKED);

    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends MIME error for non-PDF, non-image MIME type (docx)', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toMatch(/pdf|imagen/);
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
    expect(apiClient.uploadImage).not.toHaveBeenCalled();
  });

  it('sends "Primero selecciona" when no restaurant is selected (PDF)', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('restaurante');
  });

  it('sends file-too-large error for PDF > 10MB', async () => {
    const bigSize = 11 * 1024 * 1024;
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', bigSize);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('10 mb');
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
  });

  it('PDF: sends "Procesando…", calls uploadPdf with correct params, sends success summary', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', 1024, 'menu.pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    // First message: "Procesando…"
    const firstCall = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(firstCall[1].toLowerCase()).toContain('procesando');

    // uploadPdf called with correct sourceId
    expect(apiClient.uploadPdf).toHaveBeenCalledOnce();
    const uploadCall = apiClient.uploadPdf.mock.calls[0] as [{ sourceId: string; restaurantId: string; filename: string }];
    expect(uploadCall[0].sourceId).toBe('00000000-0000-0000-0000-000000000099');
    expect(uploadCall[0].restaurantId).toBe(SELECTED_RESTAURANT.id);
    expect(uploadCall[0].filename).toBe('menu.pdf');

    // Second message: success summary
    const secondCall = bot.sendMessage.mock.calls[1] as [number, string, TelegramBot.SendMessageOptions];
    expect(secondCall[1]).toContain('Ingesta');
    expect(secondCall[2]?.parse_mode).toBe('MarkdownV2');
  });

  it('PDF success summary contains restaurant name and dish counts', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const [, text] = bot.sendMessage.mock.calls[1] as [number, string, unknown];
    expect(text).toContain(SELECTED_RESTAURANT.name);
    expect(text).toContain('5');  // dishesFound
    expect(text).toContain('4');  // dishesUpserted
    expect(text).toContain('1');  // dishesSkipped
  });

  it('JPEG document (image as file): calls uploadImage, not uploadPdf', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'image/jpeg', 1024, 'photo.jpg');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.uploadImage).toHaveBeenCalledOnce();
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
    const uploadCall = apiClient.uploadImage.mock.calls[0] as [{ sourceId: string; mimeType: string }];
    expect(uploadCall[0].sourceId).toBe('00000000-0000-0000-0000-000000000099');
    expect(uploadCall[0].mimeType).toBe('image/jpeg');
  });

  it('PNG document: calls uploadImage with mimeType image/png', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'image/png', 1024, 'menu.png');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadImage.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    expect(apiClient.uploadImage).toHaveBeenCalledOnce();
    const uploadCall = apiClient.uploadImage.mock.calls[0] as [{ mimeType: string }];
    expect(uploadCall[0].mimeType).toBe('image/png');
  });

  it('sends download error when bot.getFileLink throws', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    bot.getFileLink.mockRejectedValue(new Error('Telegram error'));

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('descargar'))).toBe(true);
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
  });

  it('sends download error when fetch rejects', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    fetchMock.mockRejectedValue(new Error('network error'));

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('descargar'))).toBe(true);
    expect(apiClient.uploadPdf).not.toHaveBeenCalled();
  });

  it('sends CONFIG_ERROR message when uploadPdf throws ApiError(CONFIG_ERROR)', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockRejectedValue(new ApiError(500, 'CONFIG_ERROR', 'ADMIN_API_KEY not configured'));

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('configurado'))).toBe(true);
  });

  it('sends no-data message when uploadPdf throws ApiError(NO_NUTRITIONAL_DATA_FOUND)', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockRejectedValue(new ApiError(422, 'NO_NUTRITIONAL_DATA_FOUND', 'No data'));

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('nutricional'))).toBe(true);
  });

  it('sends generic error message for other ApiError', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'internal error'));

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const calls = bot.sendMessage.mock.calls as Array<[number, string, unknown]>;
    const texts = calls.map(([, text]) => text.toLowerCase());
    expect(texts.some((t) => t.includes('internal error'))).toBe(true);
  });

  it('falls back to "document.pdf" filename when document.file_name is absent', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf', 1024, undefined);
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const uploadCall = apiClient.uploadPdf.mock.calls[0] as [{ filename: string }];
    expect(uploadCall[0].filename).toBe('document.pdf');
  });

  it('passes chainSlug from selectedRestaurant when available', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT_WITH_CHAIN }),
    );
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const uploadCall = apiClient.uploadPdf.mock.calls[0] as [{ chainSlug?: string }];
    expect(uploadCall[0].chainSlug).toBe('mcdonalds-es');
  });

  it('does not pass chainSlug when selectedRestaurant has no chainSlug', async () => {
    const msg = makeDocMsg(ALLOWED_CHAT_ID, 'application/pdf');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ selectedRestaurant: SELECTED_RESTAURANT }),
    );
    apiClient.uploadPdf.mockResolvedValue(UPLOAD_RESULT);

    await handleDocument(msg, bot as never, apiClient as unknown as ApiClient, redis, TEST_CONFIG_ALLOWED);

    const uploadCall = apiClient.uploadPdf.mock.calls[0] as [{ chainSlug?: string }];
    expect(uploadCall[0].chainSlug).toBeUndefined();
  });
});
