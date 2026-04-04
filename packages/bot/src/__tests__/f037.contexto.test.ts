// F037 — handleContexto unit tests
// TDD: tests written BEFORE implementation

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ChainListItem } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { ApiError } from '../apiClient.js';
import { handleContexto } from '../commands/contexto.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAIN_MCDONALDS: ChainListItem = {
  chainSlug: 'mcdonalds-es',
  name: "McDonald's",
  nameEs: 'McDonalds',
  countryCode: 'ES',
  dishCount: 150,
  isActive: true,
};

const CHAIN_BURGER_KING: ChainListItem = {
  chainSlug: 'burger-king-es',
  name: 'Burger King',
  nameEs: 'Burger King',
  countryCode: 'ES',
  dishCount: 100,
  isActive: true,
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(chains: ChainListItem[] = [CHAIN_MCDONALDS, CHAIN_BURGER_KING]): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn().mockResolvedValue(chains),
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

function makeMockRedis(storedJson: string | null = null, ttlValue = 3600): ReturnType<typeof vi.fn> & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
} {
  const mock = {
    get: vi.fn().mockResolvedValue(storedJson),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(ttlValue),
  };
  return mock as unknown as ReturnType<typeof vi.fn> & typeof mock;
}

const CHAT_ID = 42;

// ---------------------------------------------------------------------------
// View flow
// ---------------------------------------------------------------------------

describe('handleContexto — view flow (empty args)', () => {
  it('no context → returns "No hay contexto activo" with /contexto hint', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const result = await handleContexto('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No hay contexto activo');
    expect(result).toContain('/contexto');
  });

  it('context present → returns "Contexto activo" with chainName', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state, 3600);
    const client = makeMockClient();
    const result = await handleContexto('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto activo');
    expect(result).toContain('McDonalds');
  });

  it('context present → calls redis.ttl to get remaining time', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state, 1800);
    const client = makeMockClient();
    await handleContexto('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(redis.ttl).toHaveBeenCalled();
  });

  it('context present, ttl throws → defaults to -1 (shows "Expira pronto")', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    redis.ttl.mockRejectedValue(new Error('redis error'));
    const client = makeMockClient();
    const result = await handleContexto('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Expira pronto');
  });
});

// ---------------------------------------------------------------------------
// Clear flow
// ---------------------------------------------------------------------------

describe('handleContexto — clear flow (args = "borrar")', () => {
  it('no context → returns formatContextCleared immediately', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const result = await handleContexto('borrar', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto borrado');
  });

  it('context present → deletes chainContext and returns formatContextCleared', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    const result = await handleContexto('borrar', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto borrado');
    // redis.set should have been called to persist state without chainContext
    expect(redis.set).toHaveBeenCalled();
  });

  it('whitespace around "borrar" is handled', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const result = await handleContexto('  borrar  ', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto borrado');
  });
});

// ---------------------------------------------------------------------------
// Set flow
// ---------------------------------------------------------------------------

describe('handleContexto — set flow (args = chain name)', () => {
  it('resolves chain → returns formatContextConfirmation with chainName and slug', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const result = await handleContexto('mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(result).toContain('mcdonalds-es');
  });

  it('resolves chain → saves chainContext to Redis', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    await handleContexto('mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(redis.set).toHaveBeenCalled();
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as { chainContext?: { chainSlug: string; chainName: string } };
    expect(saved.chainContext?.chainSlug).toBe('mcdonalds-es');
  });

  it('null → no chain found message with /cadenas hint', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    const result = await handleContexto('subway', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No encontré ninguna cadena');
    expect(result).toContain('/cadenas');
  });

  it('"ambiguous" → ambiguity message with slug example', async () => {
    const anotherBurger: ChainListItem = {
      chainSlug: 'burger-another-es',
      name: 'Burger Another',
      nameEs: null,
      countryCode: 'ES',
      dishCount: 10,
      isActive: true,
    };
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_BURGER_KING, anotherBurger]);
    const result = await handleContexto('burger', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Encontré varias cadenas');
    expect(result).toContain('/cadenas');
  });

  it('ApiError from listChains → transient error message', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    client.listChains.mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'down'));
    const result = await handleContexto('mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No pude comprobar las cadenas');
  });

  it('setStateStrict returns false → returns "No pude guardar el contexto"', async () => {
    const redis = makeMockRedis(null);
    redis.set.mockRejectedValue(new Error('redis down'));
    const client = makeMockClient();
    const result = await handleContexto('mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No pude guardar el contexto');
  });

  it('existing state preserved when setting chain context', async () => {
    const existingState = JSON.stringify({ pendingSearch: 'pizza' });
    const redis = makeMockRedis(existingState);
    const client = makeMockClient();
    await handleContexto('mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as { pendingSearch?: string; chainContext?: unknown };
    // Existing state should be preserved
    expect(saved.pendingSearch).toBe('pizza');
    expect(saved.chainContext).toBeDefined();
  });
});
