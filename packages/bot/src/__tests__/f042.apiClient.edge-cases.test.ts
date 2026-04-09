// F042 QA Edge Cases — apiClient.estimate() portionMultiplier param
//
// Focuses on gaps NOT covered by apiClient.test.ts:
//  - portionMultiplier=0.1 (minimum, non-1.0) IS sent in querystring
//  - portionMultiplier=5.0 (maximum) IS sent in querystring
//  - portionMultiplier=0.5 IS sent in querystring
//  - portionMultiplier=1.0 is NOT sent (covered in existing tests — included as regression)
//  - portionMultiplier=undefined is NOT sent
//  - portionMultiplier is the ONLY change in querystring vs a base estimate call

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { firstCallArg } from './helpers/mocks.js';

let createApiClient: (config: BotConfig) => ApiClient;

beforeAll(async () => {
  const mod = await import('../apiClient.js');
  createApiClient = mod.createApiClient;
});

const TEST_CONFIG: BotConfig = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-api-key',
  BOT_VERSION: '0.0.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_CHAT_IDS: [],
};

// Minimal EstimateData stub
const STUB_ESTIMATE_DATA = {
  query: 'big mac',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: false,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
};

describe('apiClient.estimate() — F042 portionMultiplier querystring', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = createApiClient(TEST_CONFIG);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: STUB_ESTIMATE_DATA }),
      text: async () => JSON.stringify({ success: true, data: STUB_ESTIMATE_DATA }),
    } as unknown as Response);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('portionMultiplier=0.1 (minimum, not 1.0) IS sent in querystring', async () => {
    await client.estimate({ query: 'big mac', portionMultiplier: 0.1 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('0.1');
  });

  it('portionMultiplier=5.0 (maximum) IS sent in querystring', async () => {
    await client.estimate({ query: 'big mac', portionMultiplier: 5.0 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('5');
  });

  it('portionMultiplier=0.5 IS sent in querystring', async () => {
    await client.estimate({ query: 'big mac', portionMultiplier: 0.5 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('0.5');
  });

  it('portionMultiplier=0.7 IS sent in querystring', async () => {
    await client.estimate({ query: 'ensalada', portionMultiplier: 0.7 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('0.7');
  });

  it('portionMultiplier=3.0 IS sent in querystring', async () => {
    await client.estimate({ query: 'sandwich', portionMultiplier: 3.0 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('3');
  });

  it('portionMultiplier=1.0 is NOT sent (regression: already covered)', async () => {
    await client.estimate({ query: 'big mac', portionMultiplier: 1.0 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.has('portionMultiplier')).toBe(false);
  });

  it('portionMultiplier absent is NOT sent (regression: already covered)', async () => {
    await client.estimate({ query: 'big mac' });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.has('portionMultiplier')).toBe(false);
  });

  it('portionMultiplier=0.5 with chainSlug → both params present in querystring', async () => {
    await client.estimate({ query: 'big mac', chainSlug: 'mcdonalds-es', portionMultiplier: 0.5 });

    const url = new URL(firstCallArg<string>(fetchMock));
    expect(url.searchParams.get('portionMultiplier')).toBe('0.5');
    expect(url.searchParams.get('chainSlug')).toBe('mcdonalds-es');
    expect(url.searchParams.get('query')).toBe('big mac');
  });

  it('portionMultiplier param is sent as a string representation of the number', async () => {
    // Spec §4: sp['portionMultiplier'] = String(params.portionMultiplier)
    await client.estimate({ query: 'test', portionMultiplier: 2.0 });

    const url = new URL(firstCallArg<string>(fetchMock));
    // String(2.0) === '2' in JS — not '2.0'
    const rawParam = url.searchParams.get('portionMultiplier');
    expect(typeof rawParam).toBe('string');
    // Must be a parseable number equal to 2
    expect(Number(rawParam)).toBe(2);
  });
});
