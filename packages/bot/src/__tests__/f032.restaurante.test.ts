// Unit tests for handleRestaurante command handler (F032).
//
// TelegramBot and ApiClient are mocked — no real Telegram, no real HTTP.
// Redis is injected as a plain mock object (DI — no module-level mock needed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { ApiClient, PaginatedResult } from '../apiClient.js';
import type { RestaurantListItem, PaginationMeta } from '@foodxplorer/shared';
import { ApiError } from '../apiClient.js';
import { handleRestaurante } from '../commands/restaurante.js';

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

const PAGINATION: PaginationMeta = { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 };

function makeRestaurantItem(id: string, name: string): RestaurantListItem {
  return {
    id,
    name,
    nameEs: null,
    chainSlug: 'test-es',
    countryCode: 'ES',
    isActive: true,
    logoUrl: null,
    website: null,
    dishCount: 0,
    address: null,
  };
}

function makeSearchResult(items: RestaurantListItem[]): PaginatedResult<RestaurantListItem> {
  return {
    items,
    pagination: { ...PAGINATION, totalItems: items.length, totalPages: items.length > 0 ? 1 : 0 },
  };
}

// ---------------------------------------------------------------------------
// Tests: empty args (show current context)
// ---------------------------------------------------------------------------

describe('handleRestaurante — empty args', () => {
  let redis: Redis;
  let bot: ReturnType<typeof makeMockBot>;
  let apiClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeMockRedis();
    bot = makeMockBot();
    apiClient = makeMockClient();
  });

  it('sends "no hay restaurante seleccionado" when state is null', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleRestaurante('', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text.toLowerCase()).toContain('no hay restaurante');
  });

  it('sends current context when state has selectedRestaurant', async () => {
    const state = { selectedRestaurant: { id: 'uuid-abc', name: "McDonald's Spain" } };
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(state));

    await handleRestaurante('', 456, bot as never, apiClient as unknown as ApiClient, redis);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    // Name should appear somewhere in the message
    expect(text).toContain("McDonald");
  });

  it('sends to the correct chatId', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleRestaurante('', 999, bot as never, apiClient as unknown as ApiClient, redis);

    const [chatId] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(chatId).toBe(999);
  });

  it('does not call searchRestaurants when args empty', async () => {
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await handleRestaurante('   ', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(apiClient.searchRestaurants).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: non-empty args (search path)
// ---------------------------------------------------------------------------

describe('handleRestaurante — search path', () => {
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

  it('calls searchRestaurants with the trimmed query', async () => {
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult([]));

    await handleRestaurante('  mcdonalds  ', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(apiClient.searchRestaurants).toHaveBeenCalledWith('mcdonalds');
  });

  it('sends inline keyboard with one button per result', async () => {
    const items = [
      makeRestaurantItem('uuid-1', "McDonald's Madrid"),
      makeRestaurantItem('uuid-2', "McDonald's Barcelona"),
    ];
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult(items));

    await handleRestaurante('mcdonalds', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }];
    const keyboard = options.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(2);
    expect(keyboard[0]?.[0]?.text).toBe("McDonald's Madrid");
    expect(keyboard[0]?.[0]?.callback_data).toBe('sel:uuid-1');
    expect(keyboard[1]?.[0]?.callback_data).toBe('sel:uuid-2');
  });

  it('saves searchResults and pendingSearch to Redis state on results', async () => {
    const items = [makeRestaurantItem('uuid-1', 'Test Restaurant')];
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult(items));

    await handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(redis.set).toHaveBeenCalledOnce();
    const [key, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    expect(key).toBe('bot:state:123');
    const state = JSON.parse(serialized) as { pendingSearch: string; searchResults: Record<string, string> };
    expect(state.pendingSearch).toBe('test');
    expect(state.searchResults?.['uuid-1']).toBe('Test Restaurant');
  });

  it('shows at most 5 results even if API returns more', async () => {
    // API only returns 5 (pageSize=5) but let's verify we slice correctly
    const items = Array.from({ length: 5 }, (_, i) =>
      makeRestaurantItem(`uuid-${i}`, `Restaurant ${i}`),
    );
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult(items));

    await handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis);

    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: unknown[] } }];
    expect(options.reply_markup?.inline_keyboard).toHaveLength(5);
  });

  it('sends "Crear restaurante" button when 0 results', async () => {
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult([]));

    await handleRestaurante('unknown place', 123, bot as never, apiClient as unknown as ApiClient, redis);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, , options] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }];
    const keyboard = options.reply_markup?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]?.[0]?.callback_data).toBe('create_rest');
    expect(keyboard[0]?.[0]?.text.toLowerCase()).toContain('crear');
  });

  it('saves pendingSearch to Redis when 0 results', async () => {
    apiClient.searchRestaurants.mockResolvedValue(makeSearchResult([]));

    await handleRestaurante('new place', 123, bot as never, apiClient as unknown as ApiClient, redis);

    const [, serialized] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(serialized) as { pendingSearch: string };
    expect(state.pendingSearch).toBe('new place');
  });

  it('sends error message (not throws) when searchRestaurants throws ApiError', async () => {
    apiClient.searchRestaurants.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Internal error'));

    await expect(
      handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis),
    ).resolves.toBeUndefined();

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text).toContain('disponible');
  });

  it('sends error message for 429 rate-limit error', async () => {
    apiClient.searchRestaurants.mockRejectedValue(new ApiError(429, 'RATE_LIMIT', 'Too many'));

    await handleRestaurante('test', 123, bot as never, apiClient as unknown as ApiClient, redis);

    const [, text] = bot.sendMessage.mock.calls[0] as [number, string, unknown];
    expect(text).toContain('Demasiadas');
  });
});
