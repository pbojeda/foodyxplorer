// F-MULTITURN-001 Step 7 — Bot voice handler tests for new intents
//
// Tests the two new cases in handleVoice switch:
//   case 'follow_up_attribute'
//   case 'follow_up_refinement'
// AC-22: neither case reaches the default (_exhaustive: never) branch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type TelegramBot from 'node-telegram-bot-api';
import type { ApiClient } from '../apiClient.js';
import type { ConversationMessageData } from '@foodxplorer/shared';
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
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

// ---------------------------------------------------------------------------
// Mock conversationState.getState
// ---------------------------------------------------------------------------

vi.mock('../lib/conversationState.js', () => ({
  getState: vi.fn().mockResolvedValue(null),
  setState: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock formatEstimate (used for follow_up_refinement)
// ---------------------------------------------------------------------------

const { mockFormatEstimate } = vi.hoisted(() => ({
  mockFormatEstimate: vi.fn().mockReturnValue('*Paella de pollo* — 420 kcal'),
}));

vi.mock('../formatters/estimateFormatter.js', () => ({
  formatEstimate: mockFormatEstimate,
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import { handleVoice } from '../handlers/voice.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 99999;
const ACTOR_UUID = 'fd000000-0070-4000-a000-000000000099';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0070-4000-a000-000000000001',
  name: 'Paella Valenciana', nameEs: 'Paella valenciana',
  restaurantId: null, chainSlug: null, portionGrams: 350,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'official' as const,
  source: { id: 'fd000000-0070-4000-a000-000000000099', name: 'Source', type: 'official' as const, url: 'https://example.com' },
  similarityDistance: null,
};

const MOCK_ESTIMATE_DATA = {
  query: 'paella valenciana de pollo',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish' as const,
  result: MOCK_RESULT,
  cachedAt: null,
};

function buildAttributeResponse(): ConversationMessageData {
  return {
    intent: 'follow_up_attribute',
    actorId: ACTOR_UUID,
    activeContext: null,
    followUpAttribute: {
      nutrientKey: 'carbohydrates',
      nutrientLabel: 'Carbohidratos',
      value: 45,
      unit: 'g',
      dishName: 'Paella valenciana',
      priorTurnQuery: 'paella valenciana',
      priorEstimation: MOCK_ESTIMATE_DATA,
    },
    followUpMeta: { classifierType: 'attribute', confidence: 0.95, turnStateHit: true },
  };
}

function buildRefinementResponse(): ConversationMessageData {
  return {
    intent: 'follow_up_refinement',
    actorId: ACTOR_UUID,
    activeContext: null,
    followUpRefinement: {
      originalQuery: 'paella valenciana',
      mergedQuery: 'paella valenciana de pollo',
      estimation: MOCK_ESTIMATE_DATA,
    },
    followUpMeta: { classifierType: 'refinement', confidence: 0.85, turnStateHit: true },
  };
}

// ---------------------------------------------------------------------------
// Bot + ApiClient mocks
// ---------------------------------------------------------------------------

function buildMockBot(): { sendMessage: ReturnType<typeof vi.fn>; sendChatAction: ReturnType<typeof vi.fn> } {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
  };
}

function buildMockApiClient(response: ConversationMessageData): ApiClient {
  return {
    processMessage: vi.fn(),
    sendAudio: vi.fn().mockResolvedValue(response),
    getMenuImage: vi.fn(),
    processMenuImage: vi.fn(),
  } as unknown as ApiClient;
}

function buildVoiceMsg(): TelegramBot.Message {
  return {
    chat: { id: CHAT_ID },
    voice: { file_id: 'file123', duration: 5, file_size: 1024 },
  } as unknown as TelegramBot.Message;
}

const mockRedis = {} as Redis;
const mockConfig = {} as BotConfig;

beforeEach(() => {
  mockDownloadTelegramFile.mockResolvedValue(Buffer.from('audio'));
  mockFormatEstimate.mockReturnValue('*Paella de pollo* — 420 kcal');
});

// ---------------------------------------------------------------------------
// Tests — follow_up_attribute
// ---------------------------------------------------------------------------

describe('handleVoice — follow_up_attribute (F-MULTITURN-001)', () => {
  it('sends formatted string with dish name, nutrient label, value, and unit', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient(buildAttributeResponse());

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).toContain('Paella valenciana');
    expect(text).toContain('Carbohidratos');
    expect(text).toContain('45');
    expect(text).toContain('g');
  });

  it('does NOT reach the default exhaustive branch', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient(buildAttributeResponse());

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).not.toContain('Intent desconocido');
  });

  it('sends fallback when followUpAttribute is missing', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient({
      intent: 'follow_up_attribute',
      actorId: ACTOR_UUID,
      activeContext: null,
    });

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).toContain('No se encontraron');
  });
});

// ---------------------------------------------------------------------------
// Tests — follow_up_refinement
// ---------------------------------------------------------------------------

describe('handleVoice — follow_up_refinement (F-MULTITURN-001)', () => {
  it('sends string containing refinement prefix and merged query', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient(buildRefinementResponse());

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).toContain('refinado');
    expect(text).toContain('paella valenciana de pollo');
  });

  it('calls formatEstimate with followUpRefinement.estimation', async () => {
    vi.clearAllMocks();
    mockDownloadTelegramFile.mockResolvedValue(Buffer.from('audio'));
    mockFormatEstimate.mockReturnValue('*Paella de pollo* — 420 kcal');

    const bot = buildMockBot();
    const apiClient = buildMockApiClient(buildRefinementResponse());

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    expect(mockFormatEstimate).toHaveBeenCalledWith(MOCK_ESTIMATE_DATA);
  });

  it('does NOT reach the default exhaustive branch', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient(buildRefinementResponse());

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).not.toContain('Intent desconocido');
  });

  it('sends fallback when followUpRefinement is missing', async () => {
    const bot = buildMockBot();
    const apiClient = buildMockApiClient({
      intent: 'follow_up_refinement',
      actorId: ACTOR_UUID,
      activeContext: null,
    });

    await handleVoice(buildVoiceMsg(), bot as unknown as TelegramBot, apiClient, mockRedis, mockConfig);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string];
    expect(text).toContain('No se encontraron');
  });
});
