// F-MULTITURN-001 Step 5 — Query logging integration tests for new intents
//
// Tests logQueryAfterReply (text route) and logAudioQueryAfterReply (audio route)
// for the two new intents: follow_up_attribute and follow_up_refinement.
// AC-19 (text path + audio path).
//
// Uses mocked processMessage to inject the new intent responses, isolating
// the query logging logic from the classifier pipeline.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock processMessage — injects controlled intent responses
// ---------------------------------------------------------------------------

const { mockProcessMessage } = vi.hoisted(() => ({
  mockProcessMessage: vi.fn(),
}));

vi.mock('../conversation/conversationCore.js', () => ({
  processMessage: mockProcessMessage,
}));

// ---------------------------------------------------------------------------
// Mock runEstimationCascade (not called in these tests, but needed by imports)
// ---------------------------------------------------------------------------

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock openaiClient (needed for audio route)
// ---------------------------------------------------------------------------

const { mockCallWhisperTranscription, mockIsWhisperHallucination } = vi.hoisted(() => ({
  mockCallWhisperTranscription: vi.fn(),
  mockIsWhisperHallucination: vi.fn(),
}));

vi.mock('../lib/openaiClient.js', () => ({
  callWhisperTranscription: mockCallWhisperTranscription,
  isWhisperHallucination: mockIsWhisperHallucination,
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn(),
  sleep: vi.fn(),
  callChatCompletion: vi.fn(),
  callVisionCompletion: vi.fn(),
  callOpenAIEmbeddingsOnce: vi.fn(),
  WHISPER_HALLUCINATIONS: new Set(),
}));

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet, mockRedisIncr, mockRedisExpire } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisIncr: vi.fn(),
  mockRedisExpire: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma — expose mockQueryLogCreate for assertions
// ---------------------------------------------------------------------------

const {
  mockPrismaActorUpsert,
  mockPrismaApiKeyFindUnique,
  mockPrismaExecuteRaw,
  mockQueryLogCreate,
} = vi.hoisted(() => ({
  mockPrismaActorUpsert: vi.fn(),
  mockPrismaApiKeyFindUnique: vi.fn(),
  mockPrismaExecuteRaw: vi.fn(),
  mockQueryLogCreate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: { upsert: mockPrismaActorUpsert },
    apiKey: { findUnique: mockPrismaApiKeyFindUnique },
    queryLog: { create: mockQueryLogCreate },
    $executeRaw: mockPrismaExecuteRaw,
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely — fluent stub (needed by buildApp chain loading)
// ---------------------------------------------------------------------------

const { mockKyselyExecute, mockKyselyChainStubs } = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);
  const chainMethodNames = ['selectFrom', 'select', 'where', 'distinct', 'innerJoin', 'orderBy', 'limit', 'offset', '$if'] as const;
  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({});
  stub['fn'] = { countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }) };
  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }
  return { mockKyselyExecute: execute, mockKyselyChainStubs: stub };
});

function resetKyselyChain() {
  const chainMethodNames = ['selectFrom', 'select', 'where', 'distinct', 'innerJoin', 'orderBy', 'limit', 'offset', '$if'] as const;
  for (const method of chainMethodNames) {
    (mockKyselyChainStubs[method] as ReturnType<typeof vi.fn>).mockReturnValue(mockKyselyChainStubs);
  }
  mockKyselyExecute.mockResolvedValue([]);
}

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_UUID = 'fd000000-0070-4000-a000-000000000099';
const API_KEY_VALUE = 'test-api-key-value';
const ACTOR_EXTERNAL_ID = 'fd000000-0070-4000-a000-000000000001';

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

const PRIOR_ESTIMATE = {
  query: 'paella valenciana',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: true, level2Hit: false, level3Hit: false, level4Hit: false,
  matchType: 'exact_dish' as const, result: MOCK_RESULT, cachedAt: null,
};

const REFINEMENT_ESTIMATE = {
  query: 'paella valenciana de pollo',
  chainSlug: null,
  portionMultiplier: 1,
  level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
  matchType: 'semantic_similarity' as const, result: MOCK_RESULT, cachedAt: null,
};

const FOLLOW_UP_ATTRIBUTE_RESPONSE = {
  intent: 'follow_up_attribute' as const,
  actorId: ACTOR_UUID,
  activeContext: null,
  followUpAttribute: {
    nutrientKey: 'carbohydrates' as const,
    nutrientLabel: 'Carbohidratos',
    value: 45,
    unit: 'g' as const,
    dishName: 'Paella valenciana',
    priorTurnQuery: 'paella valenciana',
    priorEstimation: PRIOR_ESTIMATE,
  },
  followUpMeta: { classifierType: 'attribute' as const, confidence: 0.95, turnStateHit: true },
};

const FOLLOW_UP_REFINEMENT_RESPONSE = {
  intent: 'follow_up_refinement' as const,
  actorId: ACTOR_UUID,
  activeContext: null,
  followUpRefinement: {
    originalQuery: 'paella valenciana',
    mergedQuery: 'paella valenciana de pollo',
    estimation: REFINEMENT_ESTIMATE,
  },
  followUpMeta: { classifierType: 'refinement' as const, confidence: 0.85, turnStateHit: true },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-001', keyHash: 'hashed-key', tier: 'free', isActive: true, expiresAt: null,
  });
  mockPrismaActorUpsert.mockResolvedValue({ id: ACTOR_UUID });
  mockPrismaExecuteRaw.mockResolvedValue(undefined);
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
}

// Multipart audio body builder
const BOUNDARY = 'f075-test-boundary';
const FAKE_AUDIO = Buffer.from('FAKE_OGG_AUDIO_DATA');

function buildMultipartBody(opts: { audioPart: { content: Buffer; filename: string; mimeType: string }; duration?: string }): Buffer {
  const parts: Buffer[] = [];
  const { audioPart, duration = '5' } = opts;
  parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="${audioPart.filename}"\r\nContent-Type: ${audioPart.mimeType}\r\n\r\n`));
  parts.push(audioPart.content);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="duration"\r\n\r\n${duration}\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// AC-19 — Text route (logQueryAfterReply)
// ---------------------------------------------------------------------------

describe('AC-19 text route — logQueryAfterReply for new follow-up intents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockQueryLogCreate.mockResolvedValue({});
    setupAuthMocks();
  });

  it('follow_up_attribute → writeQueryLog with priorTurnQuery, cacheHit: true, levelHit: l1', async () => {
    mockProcessMessage.mockResolvedValue(FOLLOW_UP_ATTRIBUTE_RESPONSE);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY_VALUE, 'X-Actor-Id': ACTOR_EXTERNAL_ID },
      payload: { text: 'y los carbs?' },
    });

    expect(response.statusCode).toBe(200);

    // Flush fire-and-forget 'finish' listener
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockQueryLogCreate).toHaveBeenCalledOnce();
    const logEntry = mockQueryLogCreate.mock.calls[0][0];
    expect(logEntry.data.queryText).toBe('paella valenciana'); // priorTurnQuery, not user text
    expect(logEntry.data.cacheHit).toBe(true);                // no cascade call issued
    expect(logEntry.data.levelHit).toBe('l1');                // from priorEstimation.level1Hit
  });

  it('follow_up_refinement → writeQueryLog with mergedQuery, cacheHit: false, levelHit: l3', async () => {
    mockProcessMessage.mockResolvedValue(FOLLOW_UP_REFINEMENT_RESPONSE);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/message',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY_VALUE, 'X-Actor-Id': ACTOR_EXTERNAL_ID },
      payload: { text: 'hazlo de pollo' },
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockQueryLogCreate).toHaveBeenCalledOnce();
    const logEntry = mockQueryLogCreate.mock.calls[0][0];
    expect(logEntry.data.queryText).toBe('paella valenciana de pollo'); // mergedQuery
    expect(logEntry.data.cacheHit).toBe(false);                        // cascade was called
    expect(logEntry.data.levelHit).toBe('l3');                         // from estimation.level3Hit
  });
});

// ---------------------------------------------------------------------------
// AC-19 — Audio route (logAudioQueryAfterReply) — Plan-R1 fix symmetric coverage
// ---------------------------------------------------------------------------

describe('AC-19 audio route — logAudioQueryAfterReply for new follow-up intents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockQueryLogCreate.mockResolvedValue({});
    mockCallWhisperTranscription.mockResolvedValue('y los carbs?');
    mockIsWhisperHallucination.mockReturnValue(false);
    setupAuthMocks();
  });

  it('follow_up_attribute via audio route → writeQueryLog with priorTurnQuery, cacheHit: true, levelHit: l1', async () => {
    mockCallWhisperTranscription.mockResolvedValue('y los carbs?');
    mockProcessMessage.mockResolvedValue(FOLLOW_UP_ATTRIBUTE_RESPONSE);

    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '3',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'X-API-Key': API_KEY_VALUE, 'X-Actor-Id': ACTOR_EXTERNAL_ID },
      payload: body,
    });

    expect(response.statusCode).toBe(200);

    // Use setImmediate to flush fire-and-forget (consistent with f075.audio.edge-cases pattern)
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockQueryLogCreate).toHaveBeenCalledOnce();
    const logEntry = mockQueryLogCreate.mock.calls[0][0];
    expect(logEntry.data.queryText).toBe('paella valenciana'); // priorTurnQuery
    expect(logEntry.data.cacheHit).toBe(true);
    expect(logEntry.data.levelHit).toBe('l1');
  });

  it('follow_up_refinement via audio route → writeQueryLog with mergedQuery, cacheHit: false, levelHit: l3', async () => {
    mockCallWhisperTranscription.mockResolvedValue('hazlo de pollo en vez de cerdo');
    mockProcessMessage.mockResolvedValue(FOLLOW_UP_REFINEMENT_RESPONSE);

    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '4',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'X-API-Key': API_KEY_VALUE, 'X-Actor-Id': ACTOR_EXTERNAL_ID },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockQueryLogCreate).toHaveBeenCalledOnce();
    const logEntry = mockQueryLogCreate.mock.calls[0][0];
    expect(logEntry.data.queryText).toBe('paella valenciana de pollo'); // mergedQuery
    expect(logEntry.data.cacheHit).toBe(false);
    expect(logEntry.data.levelHit).toBe('l3');
  });
});
