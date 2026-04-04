// F075 — Edge-case tests for handleVoice bot handler and ApiClient.sendAudio
//
// Covers gaps not addressed by f075.voice.unit.test.ts:
//   1. msg.voice === undefined → silent early return (no crash, no message)
//   2. text_too_long intent → sends TOO_LONG_MESSAGE
//   3. estimation intent with data.estimation === null → fallback message sent
//   4. comparison intent with data.comparison === null → fallback message sent
//   5. Generic non-ApiError from sendAudio → generic Spanish error message
//   6. ApiError with unknown code → generic fallback (not a specific message)
//   7. VOICE_TIMEOUT_MS constant is 30_000 (not the default 10s)
//   8. sendAudio sends X-Actor-Id header with correct chatId format
//   9. duration guard: exactly 120 is allowed (bot-side boundary)
//  10. file_size undefined → treated as 0, proceeds normally
//  11. sendChatAction throws → error is swallowed, sendAudio still called

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { ApiClient } from '../apiClient.js';
import type { ConversationMessageData, EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import type { BotConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Mock downloadTelegramFile
// ---------------------------------------------------------------------------

const { mockDownloadTelegramFile } = vi.hoisted(() => ({
  mockDownloadTelegramFile: vi.fn(),
}));

vi.mock('../handlers/fileUpload.js', () => ({
  downloadTelegramFile: mockDownloadTelegramFile,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
}));

// ---------------------------------------------------------------------------
// Mock conversationState.getState
// ---------------------------------------------------------------------------

const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
}));

vi.mock('../lib/conversationState.js', () => ({
  getState: mockGetState,
  setState: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { handleVoice } from '../handlers/voice.js';
import { ApiError, VOICE_TIMEOUT_MS } from '../apiClient.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 77777;
const ACTOR_UUID = 'fd000000-0075-4000-b000-000000000099';

const BASE_NUTRIENTS = {
  calories: 200, proteins: 8, carbohydrates: 20, sugars: 2,
  fats: 10, saturatedFats: 3, fiber: 1, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'e1', name: 'Pinchos de tortilla', nameEs: 'Pinchos de tortilla',
  restaurantId: 'r1', chainSlug: null, portionGrams: 100,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'medium' as const,
  estimationMethod: 'official' as const,
  source: { id: 's1', name: 'src', type: 'official' as const, url: null },
  similarityDistance: 0.1,
};

const ESTIMATE_DATA: EstimateData = {
  query: 'dos pinchos de tortilla', chainSlug: null,
  level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
  matchType: 'similarity_dish', result: MOCK_RESULT, cachedAt: null, portionMultiplier: 1,
};

const ESTIMATION_MESSAGE_DATA: ConversationMessageData = {
  intent: 'estimation', actorId: ACTOR_UUID, estimation: ESTIMATE_DATA, activeContext: null,
};

const FAKE_AUDIO_BUFFER = Buffer.from('fake ogg audio bytes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBot(overrides?: Partial<Record<string, ReturnType<typeof vi.fn>>>): TelegramBot {
  return {
    sendChatAction: overrides?.['sendChatAction'] ?? vi.fn().mockResolvedValue(undefined),
    sendMessage: overrides?.['sendMessage'] ?? vi.fn().mockResolvedValue(undefined),
    getFileLink: vi.fn().mockResolvedValue('https://cdn.telegram.org/file/fake.ogg'),
  } as unknown as TelegramBot;
}

function makeApiClient(sendAudioImpl: ApiClient['sendAudio']): ApiClient {
  return {
    sendAudio: sendAudioImpl,
    processMessage: vi.fn(),
    estimate: vi.fn(),
    searchDishes: vi.fn(),
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
  } as unknown as ApiClient;
}

function makeVoiceMsg(opts: {
  duration?: number;
  file_size?: number;
  file_id?: string;
  noVoice?: boolean;
}): TelegramBot.Message {
  if (opts.noVoice) {
    return { chat: { id: CHAT_ID } } as TelegramBot.Message;
  }
  return {
    chat: { id: CHAT_ID },
    voice: {
      duration: opts.duration ?? 10,
      ...(opts.file_size !== undefined ? { file_size: opts.file_size } : {}),
      file_id: opts.file_id ?? 'file_id_edge_001',
      mime_type: 'audio/ogg',
    },
  } as TelegramBot.Message;
}

const mockRedis = {} as Redis;

const mockConfig: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-bot-key',
  BOT_VERSION: '0.0.0-test',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: undefined,
  ALLOWED_CHAT_IDS: [CHAT_ID],
  REDIS_URL: 'redis://localhost:6380',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleVoice — edge cases (F075)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetState.mockResolvedValue(null);
    mockDownloadTelegramFile.mockResolvedValue(FAKE_AUDIO_BUFFER);
  });

  // -------------------------------------------------------------------------
  // msg.voice null guard
  // -------------------------------------------------------------------------

  it('msg.voice is undefined → silent return, no message sent, no API call', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    // A 'voice' event where msg.voice is absent (malformed Telegram message)
    await handleVoice(makeVoiceMsg({ noVoice: true }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(sendAudioMock).not.toHaveBeenCalled();
    expect(mockDownloadTelegramFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response formatting — text_too_long intent
  // -------------------------------------------------------------------------

  it('text_too_long intent → sends TOO_LONG_MESSAGE (MarkdownV2 format)', async () => {
    const bot = makeBot();
    const tooLongData: ConversationMessageData = {
      intent: 'text_too_long',
      actorId: ACTOR_UUID,
      activeContext: null,
    };
    const sendAudioMock = vi.fn().mockResolvedValue(tooLongData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    // The TOO_LONG_MESSAGE contains "específico" — verify it's the right message
    expect(sentText).toContain('específico');
    const opts = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts?.['parse_mode']).toBe('MarkdownV2');
  });

  // -------------------------------------------------------------------------
  // Response formatting — estimation with null estimation data
  // -------------------------------------------------------------------------

  it('estimation intent with estimation=undefined → sends fallback "no se encontraron datos" message', async () => {
    const bot = makeBot();
    const noEstimationData: ConversationMessageData = {
      intent: 'estimation',
      actorId: ACTOR_UUID,
      estimation: undefined,
      activeContext: null,
    };
    const sendAudioMock = vi.fn().mockResolvedValue(noEstimationData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('No se encontraron datos nutricionales');
  });

  // -------------------------------------------------------------------------
  // Response formatting — comparison with null comparison data
  // -------------------------------------------------------------------------

  it('comparison intent with comparison=undefined → sends fallback "no se encontraron datos de comparación" message', async () => {
    const bot = makeBot();
    const noComparisonData: ConversationMessageData = {
      intent: 'comparison',
      actorId: ACTOR_UUID,
      comparison: undefined,
      activeContext: null,
    };
    const sendAudioMock = vi.fn().mockResolvedValue(noComparisonData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('comparación');
  });

  // -------------------------------------------------------------------------
  // Error handling — non-ApiError (generic TypeError, network failure, etc.)
  // -------------------------------------------------------------------------

  it('generic TypeError from sendAudio → sends generic Spanish error message', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockRejectedValue(new TypeError('Cannot read properties of undefined'));
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    // Generic fallback message (not the specific TRANSCRIPTION_FAILED or EMPTY_TRANSCRIPTION messages)
    expect(sentText).toContain('error al procesar el audio');
  });

  it('ApiError with unknown code → sends generic Spanish error message (not specific EMPTY_TRANSCRIPTION message)', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockRejectedValue(
      new ApiError(500, 'UNKNOWN_CODE', 'Some unknown error'),
    );
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    // Falls through to generic catch — NOT the specific "entender el audio" (EMPTY_TRANSCRIPTION)
    // or "Intenta escribir el mensaje" (TRANSCRIPTION_FAILED) messages.
    // The generic fallback is "Lo siento, ha ocurrido un error al procesar el audio. Inténtalo de nuevo."
    expect(sentText).not.toContain('entender el audio');
    expect(sentText).not.toContain('Intenta escribir el mensaje');
    expect(sentText).toContain('Lo siento');
  });

  // -------------------------------------------------------------------------
  // VOICE_TIMEOUT_MS constant value
  // -------------------------------------------------------------------------

  it('VOICE_TIMEOUT_MS is exported and equals 30_000ms (not default 10s)', () => {
    expect(VOICE_TIMEOUT_MS).toBe(30_000);
  });

  // -------------------------------------------------------------------------
  // Duration boundary: exactly 120 at bot level
  // -------------------------------------------------------------------------

  it('duration exactly 120 → proceeds normally (bot boundary is > 120, not >= 120)', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ duration: 120 }), bot, apiClient, mockRedis, mockConfig);

    // Should NOT have been blocked — 120 is the maximum allowed value
    expect(sendAudioMock).toHaveBeenCalledOnce();
    expect(bot.sendMessage).toHaveBeenCalledWith(
      CHAT_ID,
      expect.not.stringContaining('menos de 2 minutos'),
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // file_size missing (undefined) → treated as 0, no size guard triggered
  // -------------------------------------------------------------------------

  it('voice.file_size is undefined → treated as 0, proceeds to download and sendAudio', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    // makeVoiceMsg without file_size → file_size is omitted from voice object
    await handleVoice(makeVoiceMsg({ file_size: undefined }), bot, apiClient, mockRedis, mockConfig);

    expect(sendAudioMock).toHaveBeenCalledOnce();
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).not.toContain('demasiado grande');
  });

  // -------------------------------------------------------------------------
  // BUG: sendChatAction throws → propagates to caller (typing action not fail-open)
  // -------------------------------------------------------------------------

  it('sendChatAction rejects → swallowed (fail-open), processing continues', async () => {
    // BUG-F075-01 fixed: sendChatAction wrapped in try/catch (best-effort).
    // When Telegram returns an error (bot blocked, chat not found), the typing
    // action fails silently and audio processing continues normally.
    const failingChatAction = vi.fn().mockRejectedValue(new Error('Telegram API error: chat not found'));
    const bot = makeBot({ sendChatAction: failingChatAction });
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    await expect(
      handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig),
    ).resolves.toBeUndefined();

    // sendAudio was reached despite sendChatAction failure
    expect(sendAudioMock).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // context_set: ambiguous flag triggers "múltiples cadenas" message
  // -------------------------------------------------------------------------

  it('context_set intent with ambiguous=true → sends "múltiples cadenas" message', async () => {
    const bot = makeBot();
    const ambiguousData: ConversationMessageData = {
      intent: 'context_set',
      actorId: ACTOR_UUID,
      ambiguous: true,
      contextSet: undefined,
      activeContext: null,
    };
    const sendAudioMock = vi.fn().mockResolvedValue(ambiguousData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('cadenas');
  });

  // -------------------------------------------------------------------------
  // All response messages use MarkdownV2 parse_mode
  // -------------------------------------------------------------------------

  it('all error messages use parse_mode: MarkdownV2', async () => {
    const errorCases = [
      new ApiError(422, 'EMPTY_TRANSCRIPTION', 'Empty'),
      new ApiError(422, 'TRANSCRIPTION_FAILED', 'Failed'),
      new ApiError(408, 'TIMEOUT', 'Timed out'),
      new Error('Generic error'),
    ];

    for (const err of errorCases) {
      vi.resetAllMocks();
      mockGetState.mockResolvedValue(null);
      mockDownloadTelegramFile.mockResolvedValue(FAKE_AUDIO_BUFFER);

      const bot = makeBot();
      const sendAudioMock = vi.fn().mockRejectedValue(err);
      const apiClient = makeApiClient(sendAudioMock);

      await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

      expect(bot.sendMessage).toHaveBeenCalledOnce();
      const opts = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<string, unknown>;
      expect(opts?.['parse_mode']).toBe('MarkdownV2');
    }
  });

  it('duration guard message uses parse_mode: MarkdownV2', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ duration: 121 }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const opts = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts?.['parse_mode']).toBe('MarkdownV2');
  });

  it('file size guard message uses parse_mode: MarkdownV2', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ file_size: 10 * 1024 * 1024 + 1 }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const opts = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts?.['parse_mode']).toBe('MarkdownV2');
  });
});
