// Route integration tests for POST /conversation/audio (F075)
//
// Uses buildApp() + inject() pattern with multipart/form-data body.
// Mocks callWhisperTranscription, isWhisperHallucination, runEstimationCascade,
// Redis (incr/expire for rate limit), Prisma, Kysely.
// Follows the vi.hoisted + fluent Kysely stub pattern from f070.conversation.route.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { ConversationMessageResponse } from '@foodxplorer/shared';

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
// Mock openaiClient — callWhisperTranscription + isWhisperHallucination
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
// Mock Redis (get/set for cache, incr/expire for rate limit)
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
// Mock Prisma
// ---------------------------------------------------------------------------

const {
  mockPrismaActorUpsert,
  mockPrismaApiKeyFindUnique,
  mockPrismaExecuteRaw,
} = vi.hoisted(() => ({
  mockPrismaActorUpsert: vi.fn(),
  mockPrismaApiKeyFindUnique: vi.fn(),
  mockPrismaExecuteRaw: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: {
      upsert: mockPrismaActorUpsert,
    },
    apiKey: {
      findUnique: mockPrismaApiKeyFindUnique,
    },
    queryLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: mockPrismaExecuteRaw,
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely — fluent stub that returns [] for execute()
// ---------------------------------------------------------------------------

const {
  mockKyselyExecute,
  mockKyselyChainStubs,
} = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue([]);

  const chainMethodNames = [
    'selectFrom', 'select', 'where', 'distinct', 'innerJoin',
    'orderBy', 'limit', 'offset', '$if',
  ] as const;

  const stub: Record<string, unknown> = {};
  for (const method of chainMethodNames) {
    stub[method] = vi.fn();
  }
  stub['execute'] = execute;
  stub['executeTakeFirstOrThrow'] = vi.fn().mockResolvedValue({});
  stub['fn'] = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('count') }),
  };

  for (const method of chainMethodNames) {
    (stub[method] as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  }

  return {
    mockKyselyExecute: execute,
    mockKyselyChainStubs: stub,
    chainMethodNames,
  };
});

function resetKyselyChain() {
  const chainMethodNames = [
    'selectFrom', 'select', 'where', 'distinct', 'innerJoin',
    'orderBy', 'limit', 'offset', '$if',
  ] as const;
  for (const method of chainMethodNames) {
    (mockKyselyChainStubs[method] as ReturnType<typeof vi.fn>).mockReturnValue(
      mockKyselyChainStubs,
    );
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

const ACTOR_UUID = 'fd000000-0075-4000-a000-000000000099';
const API_KEY_VALUE = 'test-api-key-value';
const ACTOR_EXTERNAL_ID = 'fd000000-0075-4000-a000-000000000001';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4,
  referenceBasis: 'per_serving' as const,
};

const MOCK_RESULT = {
  entityType: 'dish' as const,
  entityId: 'fd000000-0075-4000-a000-000000000002',
  name: 'Pinchos de tortilla', nameEs: 'Pinchos de tortilla',
  restaurantId: 'fd000000-0075-4000-a000-000000000003',
  chainSlug: null, portionGrams: 100,
  nutrients: BASE_NUTRIENTS, confidenceLevel: 'medium' as const,
  estimationMethod: 'embedding' as const,
  source: { id: 's-1', name: 'DB', type: 'official' as const, url: null },
  similarityDistance: 0.1,
};

const ROUTER_L3_HIT = {
  levelHit: 3 as const,
  data: {
    query: 'dos pinchos de tortilla', chainSlug: null,
    level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
    matchType: 'embedding_dish' as const, result: MOCK_RESULT, cachedAt: null,
  },
};

// ---------------------------------------------------------------------------
// Multipart body helpers
// ---------------------------------------------------------------------------

const BOUNDARY = '----TestBoundary7x8y9z';

/**
 * Build a minimal multipart/form-data body with an audio file part and a
 * duration text field. Additional text fields can be added via extraFields.
 */
function buildMultipartBody(opts: {
  audioPart?: { content: Buffer; filename: string; mimeType: string } | null;
  duration?: string | null;
  extraFields?: Record<string, string>;
}): Buffer {
  const parts: Buffer[] = [];

  if (opts.audioPart !== undefined && opts.audioPart !== null) {
    const header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="${opts.audioPart.filename}"\r\nContent-Type: ${opts.audioPart.mimeType}\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(opts.audioPart.content);
    parts.push(Buffer.from('\r\n'));
  }

  if (opts.duration !== null && opts.duration !== undefined) {
    const header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="duration"\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(Buffer.from(opts.duration));
    parts.push(Buffer.from('\r\n'));
  }

  for (const [key, value] of Object.entries(opts.extraFields ?? {})) {
    const header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(Buffer.from(value));
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));

  return Buffer.concat(parts);
}

const FAKE_AUDIO = Buffer.from('fake ogg audio bytes');

// ---------------------------------------------------------------------------
// Auth mock helper
// ---------------------------------------------------------------------------

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-001',
    keyHash: 'hashed-key',
    tier: 'free',
    isActive: true,
    expiresAt: null,
  });
  mockPrismaActorUpsert.mockResolvedValue({ id: ACTOR_UUID });
  mockPrismaExecuteRaw.mockResolvedValue(undefined);
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /conversation/audio (F075)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetKyselyChain();

    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

    mockRunEstimationCascade.mockResolvedValue(ROUTER_L3_HIT);
    mockCallWhisperTranscription.mockResolvedValue('dos pinchos de tortilla y una caña');
    mockIsWhisperHallucination.mockReturnValue(false);

    setupAuthMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('valid OGG multipart upload → 200, estimation intent', async () => {
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const resBody = response.json<ConversationMessageResponse>();
    expect(resBody.success).toBe(true);
    expect(resBody.data.intent).toBe('estimation');
    expect(mockCallWhisperTranscription).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 422 EMPTY_TRANSCRIPTION cases
  // -------------------------------------------------------------------------

  it('Whisper returns empty string → 422 EMPTY_TRANSCRIPTION', async () => {
    mockCallWhisperTranscription.mockResolvedValue('');
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('EMPTY_TRANSCRIPTION');
  });

  it('Whisper returns whitespace-only string → 422 EMPTY_TRANSCRIPTION', async () => {
    mockCallWhisperTranscription.mockResolvedValue('   ');
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('EMPTY_TRANSCRIPTION');
  });

  it('isWhisperHallucination returns true → 422 EMPTY_TRANSCRIPTION', async () => {
    mockCallWhisperTranscription.mockResolvedValue('Gracias por ver el vídeo');
    mockIsWhisperHallucination.mockReturnValue(true);
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('EMPTY_TRANSCRIPTION');
  });

  // -------------------------------------------------------------------------
  // 502 TRANSCRIPTION_FAILED cases (upstream Whisper failure)
  // -------------------------------------------------------------------------

  it('callWhisperTranscription returns null → 502 TRANSCRIPTION_FAILED', async () => {
    mockCallWhisperTranscription.mockResolvedValue(null);
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(502);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('TRANSCRIPTION_FAILED');
  });

  // -------------------------------------------------------------------------
  // 400 VALIDATION_ERROR cases
  // -------------------------------------------------------------------------

  it('missing audio field → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    // Body with only duration field, no audio
    const body = buildMultipartBody({
      audioPart: null,
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('unsupported MIME type → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'file.pdf', mimeType: 'application/pdf' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing duration field → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('non-numeric duration → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: 'not-a-number',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('duration > 120 → 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '121',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Rate limit
  // -------------------------------------------------------------------------

  it('rate limit exceeded → 429 ACTOR_RATE_LIMIT_EXCEEDED', async () => {
    mockRedisIncr.mockResolvedValue(51);
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(429);
    const resBody = response.json<{ success: false; error: { code: string } }>();
    expect(resBody.error.code).toBe('ACTOR_RATE_LIMIT_EXCEEDED');
  });

  // -------------------------------------------------------------------------
  // Fire-and-forget query log does NOT fire when Whisper fails
  // -------------------------------------------------------------------------

  it('Whisper returns null → no query log written', async () => {
    mockCallWhisperTranscription.mockResolvedValue(null);
    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Actor-Id': ACTOR_EXTERNAL_ID,
      },
      payload: body,
    });

    // runEstimationCascade should NOT have been called (early return on null transcription)
    expect(mockRunEstimationCascade).not.toHaveBeenCalled();
  });
});
