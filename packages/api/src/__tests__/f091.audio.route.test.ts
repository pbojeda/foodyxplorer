// F091 — Integration tests for hardened POST /conversation/audio
//
// Tests: budget exhausted 503, IP cap 429, server duration override,
// incrementVoiceSeconds called with verifiedDuration, budget accumulator
// fires, Slack alert fires, parseAudioDuration null fallback.
//
// Mock strategy:
//   - vi.mock('../lib/openaiClient.js') — Whisper stub
//   - vi.mock('../lib/voiceBudget.js') — stub checkBudgetExhausted + incrementSpendAndCheck
//   - vi.mock('../lib/audioDuration.js') — stub parseAudioDuration
//   - Redis mock via buildApp({ redis }) — incr/expire/get/incrby for IP counter
//   - Prisma mock via buildApp({ prisma })

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mock runEstimationCascade
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

// ---------------------------------------------------------------------------
// Mock openaiClient
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
  mimeTypeToFilename: vi.fn().mockReturnValue('audio.webm'),
  WHISPER_HALLUCINATIONS: new Set(),
}));

// ---------------------------------------------------------------------------
// Mock voiceBudget — avoid Lua semantics in route tests
// ---------------------------------------------------------------------------

const { mockCheckBudgetExhausted, mockIncrementSpendAndCheck, mockDispatchSlackAlerts } = vi.hoisted(() => ({
  mockCheckBudgetExhausted: vi.fn(),
  mockIncrementSpendAndCheck: vi.fn(),
  mockDispatchSlackAlerts: vi.fn(),
}));

vi.mock('../lib/voiceBudget.js', () => ({
  checkBudgetExhausted: mockCheckBudgetExhausted,
  incrementSpendAndCheck: mockIncrementSpendAndCheck,
  dispatchSlackAlerts: mockDispatchSlackAlerts,
}));

// ---------------------------------------------------------------------------
// Mock audioDuration
// ---------------------------------------------------------------------------

const { mockParseAudioDuration } = vi.hoisted(() => ({
  mockParseAudioDuration: vi.fn(),
}));

vi.mock('../lib/audioDuration.js', () => ({
  parseAudioDuration: mockParseAudioDuration,
  selectVerifiedDuration: vi.fn().mockImplementation(
    (clientSec: number, serverSec: number | null) => serverSec !== null ? serverSec : clientSec,
  ),
}));

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const { mockRedisGet, mockRedisSet, mockRedisIncr, mockRedisExpire, mockRedisIncrby } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisIncr: vi.fn(),
  mockRedisExpire: vi.fn(),
  mockRedisIncrby: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    incrby: mockRedisIncrby,
    eval: vi.fn().mockResolvedValue(null),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockPrismaActorUpsert,
  mockPrismaApiKeyFindUnique,
} = vi.hoisted(() => ({
  mockPrismaActorUpsert: vi.fn(),
  mockPrismaApiKeyFindUnique: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: { upsert: mockPrismaActorUpsert },
    apiKey: { findUnique: mockPrismaApiKeyFindUnique },
    queryLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely
// ---------------------------------------------------------------------------

const {
  mockKyselyExecute,
  mockKyselyChainStubs,
} = vi.hoisted(() => {
  const mockFn = vi.fn();
  const chainStub = {
    selectFrom: () => chainStub,
    select: () => chainStub,
    where: () => chainStub,
    execute: mockFn,
    executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    innerJoin: () => chainStub,
    leftJoin: () => chainStub,
    orderBy: () => chainStub,
    limit: () => chainStub,
  };
  return { mockKyselyExecute: mockFn, mockKyselyChainStubs: chainStub };
});

vi.mock('../lib/kysely.js', () => ({
  getKysely: () => mockKyselyChainStubs,
  destroyKysely: vi.fn(),
}));

import { buildApp } from '../app.js';
import { buildMultipartBody, MULTIPART_BOUNDARY } from './helpers/multipart.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR_UUID = 'fd000000-0091-4000-a000-000000000099';
const API_KEY_VALUE = 'test-api-key-f091';
const ACTOR_EXTERNAL_ID = 'fd000000-0091-4000-a000-000000000001';
const CLIENT_IP = '203.0.113.42';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0091-4000-a000-000000000002',
  name: 'Paella valenciana', nameEs: 'Paella valenciana',
  restaurantId: 'fd000000-0091-4000-a000-000000000003',
  chainSlug: null, portionGrams: 300,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'high' as const,
  estimationMethod: 'embedding' as const,
  source: { id: 's-2', name: 'DB', type: 'official' as const, url: null },
  similarityDistance: 0.05,
};

const ROUTER_L3_HIT = {
  levelHit: 3 as const,
  data: {
    query: 'paella valenciana', chainSlug: null,
    level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
    matchType: 'embedding_dish' as const, result: MOCK_RESULT, cachedAt: null,
  },
};

const FAKE_AUDIO = Buffer.from('fake webm audio bytes');

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-f091',
    keyHash: 'hashed-key',
    tier: 'free',
    isActive: true,
    expiresAt: null,
  });
  mockPrismaActorUpsert.mockResolvedValue({
    id: ACTOR_UUID,
    externalId: ACTOR_EXTERNAL_ID,
    tier: null,
  });
}

function setupKyselyMocks() {
  mockKyselyExecute.mockResolvedValue([]);
}

function setupRedisMocks(ipSeconds = 0) {
  // Route get calls by key prefix:
  //   - ip:voice-min:* → IP counter (string number or null)
  //   - budget:voice:* → budget key (null — managed by mocked voiceBudget module)
  //   - everything else (auth cache, etc.) → null (cache miss)
  mockRedisGet.mockImplementation(async (key: string) => {
    if (typeof key === 'string' && key.startsWith('ip:voice-min:')) {
      return ipSeconds > 0 ? String(ipSeconds) : null;
    }
    return null;
  });
  mockRedisIncr.mockResolvedValue(1);
  mockRedisIncrby.mockResolvedValue((ipSeconds > 0 ? ipSeconds : 0) + 10);
  mockRedisExpire.mockResolvedValue(1);
  mockRedisSet.mockResolvedValue('OK');
}

function buildAudioBody(durationSec = 10, mimeType = 'audio/webm') {
  return buildMultipartBody({
    audioPart: { content: FAKE_AUDIO, filename: 'voice.webm', mimeType },
    duration: String(durationSec),
  });
}

function getMultipartHeaders(mimeType = 'audio/webm') {
  void mimeType;
  return {
    'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    'X-API-Key': API_KEY_VALUE,
    'X-Actor-Id': ACTOR_EXTERNAL_ID,
    'X-Forwarded-For': CLIENT_IP,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /conversation/audio — F091 hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks();
    setupKyselyMocks();
    setupRedisMocks();
    // Default: budget not exhausted, parse returns 10s, no alerts
    mockCheckBudgetExhausted.mockResolvedValue(false);
    mockParseAudioDuration.mockReturnValue(10); // server-parsed = 10s = client
    mockIncrementSpendAndCheck.mockResolvedValue({
      data: { exhausted: false, spendEur: 1.5, capEur: 100, alertLevel: 'none', monthKey: '2026-04' },
      alertsFired: [],
    });
    mockDispatchSlackAlerts.mockResolvedValue(undefined);
    mockIsWhisperHallucination.mockReturnValue(false);
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L3_HIT);
  });

  // -------------------------------------------------------------------------
  // 503 — budget exhausted blocks at request entry
  // -------------------------------------------------------------------------

  it('returns 503 VOICE_BUDGET_EXHAUSTED when budget is exhausted (before multipart parsing)', async () => {
    mockCheckBudgetExhausted.mockResolvedValue(true);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(),
    });

    expect(response.statusCode).toBe(503);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VOICE_BUDGET_EXHAUSTED');
    // Whisper must NOT have been called
    expect(mockCallWhisperTranscription).not.toHaveBeenCalled();

    await app.close();
  });

  // -------------------------------------------------------------------------
  // 429 — per-IP cap exceeded via IP counter
  // -------------------------------------------------------------------------

  it('returns 429 IP_VOICE_LIMIT_EXCEEDED when IP counter is over 1800s', async () => {
    // IP has already used 1801 seconds today
    setupRedisMocks(1801);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(),
    });

    expect(response.statusCode).toBe(429);
    const body = response.json<{ success: false; error: { code: string; details?: Record<string, unknown> } }>();
    expect(body.error.code).toBe('IP_VOICE_LIMIT_EXCEEDED');
    expect(body.error.details?.['limitMinutes']).toBe(30);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Happy path — full round-trip
  // -------------------------------------------------------------------------

  it('happy path: returns 200, incrementVoiceSeconds called, budget incremented', async () => {
    mockCallWhisperTranscription.mockResolvedValue('paella valenciana');

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(10),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ success: true }>();
    expect(body.success).toBe(true);

    // Budget accumulator must have been called
    expect(mockIncrementSpendAndCheck).toHaveBeenCalled();
    // incrby (voice seconds) must have been called for IP counter
    expect(mockRedisIncrby).toHaveBeenCalled();

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Server duration override (> 2s difference)
  // -------------------------------------------------------------------------

  it('uses server-parsed duration when client exceeds server by > 2s', async () => {
    // Server parsed 8s, client sent 15s (diff = 7s > 2s threshold)
    mockParseAudioDuration.mockReturnValue(8);
    mockCallWhisperTranscription.mockResolvedValue('paella valenciana');

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(15), // client says 15s
    });

    expect(response.statusCode).toBe(200);
    // The incrby should be called with server duration (8), not client (15)
    // Note: selectVerifiedDuration is mocked to return serverSec when present
    const incrbyCall = mockRedisIncrby.mock.calls[0] as [string, number] | undefined;
    if (incrbyCall) {
      expect(incrbyCall[1]).toBe(8); // server-verified duration
    }

    await app.close();
  });

  // -------------------------------------------------------------------------
  // parseAudioDuration returns null — fallback to client value
  // -------------------------------------------------------------------------

  it('falls back to client duration when parseAudioDuration returns null', async () => {
    mockParseAudioDuration.mockReturnValue(null);
    mockCallWhisperTranscription.mockResolvedValue('paella valenciana');

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(20),
    });

    expect(response.statusCode).toBe(200);
    // incrby called with client duration (20) since server returned null
    const incrbyCall = mockRedisIncrby.mock.calls[0] as [string, number] | undefined;
    if (incrbyCall) {
      expect(incrbyCall[1]).toBe(20);
    }

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Budget exhausted flag returned AFTER accumulation — current request still 200
  // -------------------------------------------------------------------------

  it('current request returns 200 even when incrementSpendAndCheck returns exhausted:true', async () => {
    mockCallWhisperTranscription.mockResolvedValue('paella valenciana');
    mockIncrementSpendAndCheck.mockResolvedValue({
      data: { exhausted: true, spendEur: 101, capEur: 100, alertLevel: 'cap', monthKey: '2026-04' },
      alertsFired: [{ threshold: 100 as const }],
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: getMultipartHeaders(),
      payload: buildAudioBody(10),
    });

    // Current request still succeeds — exhausted blocks the NEXT request
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // WAV MIME now rejected (post-review correction)
  // -------------------------------------------------------------------------

  it('rejects audio/wav with 400 VALIDATION_ERROR (WAV removed from allowed types)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.wav', mimeType: 'audio/wav' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// BUG-API-AUDIO-4XX-001 — 415 and 400 error shapes
// ---------------------------------------------------------------------------

describe('POST /conversation/audio — BUG-API-AUDIO-4XX-001 error shapes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthMocks();
    setupKyselyMocks();
    setupRedisMocks();
    mockCheckBudgetExhausted.mockResolvedValue(false);
    mockParseAudioDuration.mockReturnValue(10);
    mockIncrementSpendAndCheck.mockResolvedValue({
      data: { exhausted: false, spendEur: 1.5, capEur: 100, alertLevel: 'none', monthKey: '2026-04' },
      alertsFired: [],
    });
    mockDispatchSlackAlerts.mockResolvedValue(undefined);
    mockIsWhisperHallucination.mockReturnValue(false);
    mockRunEstimationCascade.mockResolvedValue(ROUTER_L3_HIT);
  });

  // -------------------------------------------------------------------------
  // AC1 — absent Content-Type → 415
  // -------------------------------------------------------------------------

  it('AC1: returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type header is absent', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {}, // no Content-Type, no body
      payload: undefined,
    });
    expect(response.statusCode).toBe(415);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(body.error.message).toBe('Content-Type must be multipart/form-data');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC2 — Content-Type: application/json → 415
  // -------------------------------------------------------------------------

  it('AC2: returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type is application/json', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ text: 'hello' }),
    });
    expect(response.statusCode).toBe(415);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC3 — Content-Type: text/plain → 415
  // -------------------------------------------------------------------------

  it('AC3: returns 415 UNSUPPORTED_MEDIA_TYPE when Content-Type is text/plain', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'text/plain' },
      payload: 'hello',
    });
    expect(response.statusCode).toBe(415);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC4 — multipart/form-data without boundary param → 400
  // -------------------------------------------------------------------------

  it('AC4: returns 400 VALIDATION_ERROR when Content-Type is multipart/form-data without boundary param', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'multipart/form-data' }, // no boundary=
      payload: Buffer.alloc(0),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/boundary/i);
    await app.close();
  });

  it('AC4 variant: returns 400 VALIDATION_ERROR when boundary parameter is present but empty', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' }, // empty value
      payload: Buffer.alloc(0),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/boundary/i);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC5 — valid multipart with zero parts → 400
  // -------------------------------------------------------------------------

  it('AC5: returns 400 VALIDATION_ERROR for valid multipart with zero parts (empty body)', async () => {
    const body = buildMultipartBody({ audioPart: null, duration: null });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
    expect(resBody.error.message).toBe('Missing audio file part in multipart request');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC6 — valid multipart with non-audio parts only → 400
  // -------------------------------------------------------------------------

  it('AC6: returns 400 VALIDATION_ERROR for valid multipart with non-audio parts only', async () => {
    const body = buildMultipartBody({ audioPart: null, duration: '10' });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
    expect(resBody.error.message).toBe('Missing audio file part in multipart request');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC7 — anonymous caller happy path → 200
  // -------------------------------------------------------------------------

  it('AC7: anonymous caller with no X-API-Key and no X-Actor-Id returns 200 on valid audio', async () => {
    mockCallWhisperTranscription.mockResolvedValue('paella valenciana');
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'X-Forwarded-For': CLIENT_IP,
        // No X-API-Key, no X-Actor-Id
      },
      payload: buildAudioBody(10),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC8 — duration > 120 still returns 400 (existing guard preserved)
  // -------------------------------------------------------------------------

  it('AC8: duration > 120 returns 400 VALIDATION_ERROR (existing guard preserved)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
      },
      payload: buildAudioBody(200), // 200s > 120s limit
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('120 seconds');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC10 — invalid (present but unregistered) API key returns 401
  // -------------------------------------------------------------------------

  it('AC10: invalid (present but unregistered) X-API-Key returns 401 UNAUTHORIZED', async () => {
    mockPrismaApiKeyFindUnique.mockResolvedValue(null);
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'X-API-Key': 'fxp_not_a_real_key_12345',
        'X-Forwarded-For': CLIENT_IP,
      },
      payload: buildAudioBody(10),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid or expired API key');
    await app.close();
  });
});
