// F075 — Unit tests for handleVoice bot handler and ApiClient.sendAudio
//
// Tests handleVoice: duration/size guards, typing action, download, sendAudio, format response.
// Mocks downloadTelegramFile, apiClient.sendAudio, bot.sendChatAction, bot.sendMessage.
// Follows the makeApiClient factory pattern from f070.naturalLanguage.unit.test.ts.

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
import { ApiError } from '../apiClient.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 99999;
const ACTOR_UUID = 'fd000000-0075-4000-b000-000000000001';

const BASE_NUTRIENTS = {
  calories: 200, proteins: 8, carbohydrates: 20, sugars: 2,
  fats: 10, saturatedFats: 3, fiber: 1, salt: 0.5, sodium: 200,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'e1',
  name: 'Pinchos de tortilla',
  nameEs: 'Pinchos de tortilla',
  restaurantId: 'r1',
  chainSlug: null,
  portionGrams: 100,
  nutrients: BASE_NUTRIENTS,
  confidenceLevel: 'medium' as const,
  estimationMethod: 'official' as const,
  source: { id: 's1', name: 'src', type: 'official' as const, url: null },
  similarityDistance: 0.1,
};

const ESTIMATE_DATA: EstimateData = {
  query: 'dos pinchos de tortilla',
  chainSlug: null,
  level1Hit: false,
  level2Hit: false,
  level3Hit: true,
  level4Hit: false,
  matchType: 'similarity_dish',
  result: MOCK_RESULT,
  cachedAt: null,
  portionMultiplier: 1,
};

const ESTIMATION_MESSAGE_DATA: ConversationMessageData = {
  intent: 'estimation',
  actorId: ACTOR_UUID,
  estimation: ESTIMATE_DATA,
  activeContext: null,
};

const FAKE_AUDIO_BUFFER = Buffer.from('fake ogg audio bytes');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeBot(): TelegramBot {
  return {
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getFileLink: vi.fn().mockResolvedValue('https://cdn.telegram.org/file/fake.ogg'),
  } as unknown as TelegramBot;
}

function makeApiClient(sendAudioImpl: ApiClient['sendAudio']): ApiClient {
  return {
    sendAudio: sendAudioImpl,
    // stubs for unused methods
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
}): TelegramBot.Message {
  return {
    chat: { id: CHAT_ID },
    voice: {
      duration: opts.duration ?? 10,
      file_size: opts.file_size ?? 50_000,
      file_id: opts.file_id ?? 'file_id_123',
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

describe('handleVoice (F075)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetState.mockResolvedValue(null);
    mockDownloadTelegramFile.mockResolvedValue(FAKE_AUDIO_BUFFER);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('valid voice message → sends typing action, downloads file, calls sendAudio, sends response', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ duration: 10, file_size: 50_000 }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendChatAction).toHaveBeenCalledWith(CHAT_ID, 'typing');
    expect(mockDownloadTelegramFile).toHaveBeenCalledWith(bot, 'file_id_123');
    expect(sendAudioMock).toHaveBeenCalledOnce();
    expect(sendAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audioBuffer: FAKE_AUDIO_BUFFER,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        duration: 10,
        chatId: CHAT_ID,
      }),
    );
    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(typeof sentText).toBe('string');
    expect(sentText.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Duration guard
  // -------------------------------------------------------------------------

  it('duration > 120 → sends duration error message immediately, no API call', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ duration: 121 }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('menos de 2 minutos');
    expect(sendAudioMock).not.toHaveBeenCalled();
    expect(mockDownloadTelegramFile).not.toHaveBeenCalled();
  });

  it('duration exactly 120 → proceeds normally (boundary)', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ duration: 120 }), bot, apiClient, mockRedis, mockConfig);

    expect(sendAudioMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // File size guard
  // -------------------------------------------------------------------------

  it('file_size > 10MB → sends file too large message immediately, no API call', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({ file_size: 10 * 1024 * 1024 + 1 }), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('demasiado grande');
    expect(sendAudioMock).not.toHaveBeenCalled();
    expect(mockDownloadTelegramFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Download failure
  // -------------------------------------------------------------------------

  it('downloadTelegramFile throws → sends error message, no sendAudio call', async () => {
    mockDownloadTelegramFile.mockRejectedValue(new Error('Telegram CDN unavailable'));
    const bot = makeBot();
    const sendAudioMock = vi.fn();
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(sendAudioMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // ApiError error code routing
  // -------------------------------------------------------------------------

  it('ApiError EMPTY_TRANSCRIPTION → sends "no he podido entender" message', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockRejectedValue(
      new ApiError(422, 'EMPTY_TRANSCRIPTION', 'Empty transcription'),
    );
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('entender el audio');
  });

  it('ApiError TRANSCRIPTION_FAILED → sends "no he podido procesar" message', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockRejectedValue(
      new ApiError(502, 'TRANSCRIPTION_FAILED', 'Transcription failed'),
    );
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('procesar el audio');
  });

  it('ApiError TIMEOUT (408) → sends timeout message', async () => {
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockRejectedValue(
      new ApiError(408, 'TIMEOUT', 'Request timed out'),
    );
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('tardado demasiado');
  });

  // -------------------------------------------------------------------------
  // Response formatting — comparison intent
  // -------------------------------------------------------------------------

  it('comparison intent → formats comparison response', async () => {
    const bot = makeBot();
    const comparisonData: ConversationMessageData = {
      intent: 'comparison',
      actorId: ACTOR_UUID,
      comparison: {
        dishA: ESTIMATE_DATA,
        dishB: { ...ESTIMATE_DATA, query: 'cañas' },
      },
      activeContext: null,
    };
    const sendAudioMock = vi.fn().mockResolvedValue(comparisonData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Response formatting — context_set intent
  // -------------------------------------------------------------------------

  it('context_set intent → formats context confirmation response', async () => {
    const bot = makeBot();
    const contextSetData: ConversationMessageData = {
      intent: 'context_set',
      actorId: ACTOR_UUID,
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
      activeContext: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
    };
    const sendAudioMock = vi.fn().mockResolvedValue(contextSetData);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const sentText = (bot.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(sentText).toContain('Contexto establecido');
  });

  // -------------------------------------------------------------------------
  // Legacy chainContext passthrough
  // -------------------------------------------------------------------------

  it('legacy chainContext from bot:state passed to sendAudio', async () => {
    mockGetState.mockResolvedValue({
      chainContext: { chainSlug: 'bk-es', chainName: 'Burger King' },
    });
    const bot = makeBot();
    const sendAudioMock = vi.fn().mockResolvedValue(ESTIMATION_MESSAGE_DATA);
    const apiClient = makeApiClient(sendAudioMock);

    await handleVoice(makeVoiceMsg({}), bot, apiClient, mockRedis, mockConfig);

    expect(sendAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyChainContext: { chainSlug: 'bk-es', chainName: 'Burger King' },
      }),
    );
  });
});
