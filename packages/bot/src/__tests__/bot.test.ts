// Integration-style unit tests for buildBot() wiring.
// TelegramBot is mocked — no real Telegram connection.

// vi.mock is hoisted by Vitest — must appear before any imports that use the mock.
import { vi } from 'vitest';

vi.mock('node-telegram-bot-api', () => {
  const mockInstance = {
    onText: vi.fn(),
    sendMessage: vi.fn(),
    on: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    answerCallbackQuery: vi.fn(),
    editMessageText: vi.fn(),
  };
  const MockTelegramBot = vi.fn(() => mockInstance);
  return { default: MockTelegramBot };
});

import { describe, it, expect, beforeEach } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { EstimateData } from '@foodxplorer/shared';
import { buildBot } from '../bot.js';
import type { BotConfig } from '../config.js';
import type TelegramBot from 'node-telegram-bot-api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
  chainSlug: null,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  cachedAt: null,
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0002-4000-a000-000000000001',
    chainSlug: 'mcdonalds-es',
    portionGrams: 200,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    similarityDistance: null,
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    nutrients: {
      calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
      fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
      transFats: 0, cholesterol: 0, potassium: 0,
      monounsaturatedFats: 0, polyunsaturatedFats: 0,
      referenceBasis: 'per_serving',
    },
  },
};

// ---------------------------------------------------------------------------
// MockApiClient
// ---------------------------------------------------------------------------

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
  };
}

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-api-key',
  BOT_VERSION: '0.1.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  ADMIN_API_KEY: 'test-admin-key',
  REDIS_URL: 'redis://localhost:6380',
};

// Minimal Redis mock — DI into buildBot
const MOCK_REDIS = { get: vi.fn(), set: vi.fn(), del: vi.fn() };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the mocked TelegramBot instance returned by buildBot. */
function getMockBotInstance(bot: TelegramBot) {
  // The mock instance is the returned value from the mock constructor
  return bot as unknown as {
    onText: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    startPolling: ReturnType<typeof vi.fn>;
    stopPolling: ReturnType<typeof vi.fn>;
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
  };
}

function makeMessage(text: string, chatId = 123) {
  return { chat: { id: chatId }, text } as TelegramBot.Message;
}

/** Asserts value is defined and returns it (narrowing away undefined). */
function defined<T>(value: T | undefined, label = 'value'): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildBot', () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let bot: TelegramBot;
  let mockBot: ReturnType<typeof getMockBotInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = makeMockClient();
    bot = buildBot(TEST_CONFIG, mockClient as unknown as ApiClient, MOCK_REDIS as never);
    mockBot = getMockBotInstance(bot);
  });

  it('returns a TelegramBot instance', () => {
    expect(bot).toBeDefined();
  });

  it('registers onText exactly 9 times (one per command including /restaurante)', () => {
    expect(mockBot.onText).toHaveBeenCalledTimes(9);
  });

  it('registers polling_error handler via bot.on', () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, unknown]>;
    const pollingErrorCall = onCalls.find(([event]) => event === 'polling_error');
    expect(pollingErrorCall).toBeDefined();
  });

  it('registers callback_query handler via bot.on', () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, unknown]>;
    const callbackCall = onCalls.find(([event]) => event === 'callback_query');
    expect(callbackCall).toBeDefined();
  });

  it('registers message handler via bot.on for unknown command catch-all', () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, unknown]>;
    const messageCalls = onCalls.filter(([event]) => event === 'message');
    expect(messageCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('the /buscar regex matches "/buscar big mac"', () => {
    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, unknown]>;
    const buscarCall = onTextCalls.find(([regex]) => regex.toString().includes('buscar'));
    expect(buscarCall).toBeDefined();
    expect(buscarCall?.[0].test('/buscar big mac')).toBe(true);
  });

  it('the /buscar regex matches "/buscar" alone (no args — shows usage hint)', () => {
    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, unknown]>;
    const buscarCall = onTextCalls.find(([regex]) => regex.toString().includes('buscar'));
    expect(buscarCall).toBeDefined();
    expect(buscarCall?.[0].test('/buscar')).toBe(true);
  });

  it('the /start regex matches "/start"', () => {
    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, unknown]>;
    const startCall = onTextCalls.find(([regex]) => regex.toString().includes('start'));
    expect(startCall).toBeDefined();
    expect(startCall?.[0].test('/start')).toBe(true);
  });

  it('calls sendMessage with MarkdownV2 parse_mode when /start handler fires', async () => {
    mockBot.sendMessage.mockResolvedValue({});

    // Find the /start onText handler
    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, (msg: TelegramBot.Message, match: RegExpExecArray | null) => void]>;
    const startCall = onTextCalls.find(([regex]) => regex.toString().includes('start') && !regex.toString().includes('buscar'));
    const handler = defined(startCall?.[1], '/start handler');

    const msg = makeMessage('/start');
    await handler(msg, null);

    expect(mockBot.sendMessage).toHaveBeenCalledWith(
      123,
      expect.any(String),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('calls searchDishes and sendMessage when /buscar handler fires', async () => {
    mockClient.searchDishes.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
    });
    mockBot.sendMessage.mockResolvedValue({});

    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, (msg: TelegramBot.Message, match: RegExpExecArray | null) => void]>;
    const buscarCall = onTextCalls.find(([regex]) => regex.toString().includes('buscar'));
    const handler = defined(buscarCall?.[1], '/buscar handler');

    const msg = makeMessage('/buscar big mac');
    // Simulate a regex match result (index 1 = capture group)
    const fakeMatch = ['/buscar big mac', 'big mac'] as unknown as RegExpExecArray;
    await handler(msg, fakeMatch);

    expect(mockClient.searchDishes).toHaveBeenCalled();
    expect(mockBot.sendMessage).toHaveBeenCalled();
  });

  it('sends generic error message when handler throws unexpectedly', async () => {
    // Make searchDishes throw a non-ApiError
    mockClient.searchDishes.mockRejectedValue(new Error('Unexpected crash'));
    mockBot.sendMessage.mockResolvedValue({});

    const onTextCalls = mockBot.onText.mock.calls as Array<[RegExp, (msg: TelegramBot.Message, match: RegExpExecArray | null) => void]>;
    const buscarCall = onTextCalls.find(([regex]) => regex.toString().includes('buscar'));
    const handler = defined(buscarCall?.[1], '/buscar handler');

    const msg = makeMessage('/buscar something');
    const fakeMatch = ['/buscar something', 'something'] as unknown as RegExpExecArray;
    await handler(msg, fakeMatch);

    // Should still call sendMessage (not crash)
    expect(mockBot.sendMessage).toHaveBeenCalled();
    const sentText = (mockBot.sendMessage.mock.calls[0] as [number, string, unknown])[1];
    expect(sentText).toContain('error');
  });

  it('sends unknown command message for unrecognized /command via message event', async () => {
    mockBot.sendMessage.mockResolvedValue({});

    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    await handler(makeMessage('/unknowncmd'));

    expect(mockBot.sendMessage).toHaveBeenCalled();
    const sentText = (mockBot.sendMessage.mock.calls[0] as [number, string, unknown])[1];
    expect(sentText).toContain('no reconocido');
  });

  it('does NOT send unknown command message for known commands via message event', async () => {
    mockBot.sendMessage.mockResolvedValue({});

    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    // /buscar is a known command — message handler should NOT fire a reply
    await handler(makeMessage('/buscar big mac'));

    expect(mockBot.sendMessage).not.toHaveBeenCalled();
  });

  it('routes plain text to NL handler — calls estimate and sendMessage', async () => {
    mockClient.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    mockBot.sendMessage.mockResolvedValue({});

    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    handler(makeMessage('big mac'));
    // wrapHandler fires a floating promise — drain the microtask queue
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockClient.estimate).toHaveBeenCalledOnce();
    expect(mockBot.sendMessage).toHaveBeenCalledOnce();
  });

  it('does NOT call estimate or sendMessage for media message (no msg.text)', async () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    // Media message: no text property
    await handler({ chat: { id: 123 } } as TelegramBot.Message);

    expect(mockClient.estimate).not.toHaveBeenCalled();
    expect(mockBot.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT call estimate or sendMessage for empty text message', async () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    await handler(makeMessage(''));

    expect(mockClient.estimate).not.toHaveBeenCalled();
    expect(mockBot.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT call estimate or sendMessage for whitespace-only text', async () => {
    const onCalls = mockBot.on.mock.calls as Array<[string, (msg: TelegramBot.Message) => void]>;
    const messageHandler = onCalls.find(([event]) => event === 'message');
    const handler = defined(messageHandler?.[1], 'message handler');

    await handler(makeMessage('   '));

    expect(mockClient.estimate).not.toHaveBeenCalled();
    expect(mockBot.sendMessage).not.toHaveBeenCalled();
  });
});
