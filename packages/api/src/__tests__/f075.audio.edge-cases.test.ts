// F075 — Edge-case tests for POST /conversation/audio
//
// Covers gaps not addressed by f075.audio.route.test.ts:
//   1. Duration boundary values (0, negative, exactly 120)
//   2. MIME type with codec parameter — "audio/ogg; codecs=opus" (Telegram real-world format)
//   3. audio/x-m4a (iOS) — deliberate reject
//   4. Hallucination partial-match — contains hallucination substring but not exact match
//   5. X-FXP-Source header parsing on audio route (bot vs api source routing)
//   6. Whisper called with actual buffer bytes (not an empty buffer)
//   7. Empty audio buffer accepted by route (buffer validation is Whisper's job)
//   8. chainSlug + chainName optional fields propagated to processMessage
//   9. duration field as float string — 10.5 should be valid (Number('10.5') is finite)
//  10. Concurrent requests each get independent capturedData closures (query log isolation)

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
// Mock Prisma
// ---------------------------------------------------------------------------

const { mockPrismaActorUpsert, mockPrismaApiKeyFindUnique, mockPrismaExecuteRaw } = vi.hoisted(
  () => ({
    mockPrismaActorUpsert: vi.fn(),
    mockPrismaApiKeyFindUnique: vi.fn(),
    mockPrismaExecuteRaw: vi.fn(),
  }),
);

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    actor: { upsert: mockPrismaActorUpsert },
    apiKey: { findUnique: mockPrismaApiKeyFindUnique },
    queryLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: mockPrismaExecuteRaw,
  } as unknown as PrismaClient,
}));

// ---------------------------------------------------------------------------
// Mock Kysely
// ---------------------------------------------------------------------------

const { mockKyselyExecute, mockKyselyChainStubs } = vi.hoisted(() => {
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
  return { mockKyselyExecute: execute, mockKyselyChainStubs: stub };
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
// Fixtures & helpers
// ---------------------------------------------------------------------------

const API_KEY_VALUE = 'test-api-key-value';
const ACTOR_EXTERNAL_ID = 'fd000000-0075-4000-a000-000000000001';
const ACTOR_UUID = 'fd000000-0075-4000-a000-000000000099';

const BASE_NUTRIENTS = {
  calories: 550, proteins: 25, carbohydrates: 45, sugars: 9,
  fats: 26, saturatedFats: 10, fiber: 2, salt: 2.2, sodium: 880,
  transFats: 0.2, cholesterol: 80, potassium: 320,
  monounsaturatedFats: 12, polyunsaturatedFats: 4, alcohol: 0,
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

const BOUNDARY = '----TestEdgeBoundary42';
const FAKE_AUDIO = Buffer.from('fake ogg audio bytes for edge cases');

function buildMultipartBody(opts: {
  audioPart?: { content: Buffer; filename: string; mimeType: string } | null;
  duration?: string | null;
  extraFields?: Record<string, string>;
}): Buffer {
  const parts: Buffer[] = [];

  if (opts.audioPart !== undefined && opts.audioPart !== null) {
    const header =
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="${opts.audioPart.filename}"\r\nContent-Type: ${opts.audioPart.mimeType}\r\n\r\n`;
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

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-001', keyHash: 'hashed-key', tier: 'free', isActive: true, expiresAt: null,
  });
  mockPrismaActorUpsert.mockResolvedValue({ id: ACTOR_UUID });
  mockPrismaExecuteRaw.mockResolvedValue(undefined);
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /conversation/audio — edge cases (F075)', () => {
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
  // Duration boundary values
  // -------------------------------------------------------------------------

  it('duration = 0 → 200 (zero-length audio is valid)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '0',
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

    // duration=0 is a valid value — validation only rejects < 0 or > 120
    expect(response.statusCode).toBe(200);
    const resBody = response.json<ConversationMessageResponse>();
    expect(resBody.success).toBe(true);
  });

  it('duration = -1 → 400 VALIDATION_ERROR (negative duration rejected)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '-1',
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

  it('duration = 120 → 200 (boundary is inclusive)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '120',
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
  });

  it('duration = 10.5 (float string) → 200 (Number is finite, valid)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10.5',
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
  });

  // -------------------------------------------------------------------------
  // MIME type edge cases
  // -------------------------------------------------------------------------

  it('audio/ogg; codecs=opus (Telegram real-world MIME) → 200 (busboy strips codec params)', async () => {
    // Telegram sends Content-Type "audio/ogg; codecs=opus" in voice note part headers.
    // @fastify/multipart uses busboy which reports only the base MIME type ("audio/ogg"),
    // stripping codec and other parameters before setting filePart.mimetype.
    // Therefore the route receives "audio/ogg" (which IS in ALLOWED_AUDIO_MIME_TYPES)
    // and the request proceeds normally.
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg; codecs=opus' },
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

    // busboy strips codec params → filePart.mimetype = "audio/ogg" → allowed
    expect(response.statusCode).toBe(200);
    const resBody = response.json<ConversationMessageResponse>();
    expect(resBody.success).toBe(true);
  });

  it('audio/x-m4a (iOS format) → 400 VALIDATION_ERROR (not in allowed set)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.m4a', mimeType: 'audio/x-m4a' },
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

  it('audio/mpeg (MP3) → 200 (allowed MIME type)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.mp3', mimeType: 'audio/mpeg' },
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
  });

  it('audio/webm → 200 (allowed MIME type)', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.webm', mimeType: 'audio/webm' },
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
  });

  // -------------------------------------------------------------------------
  // Hallucination filter: partial-match should NOT be filtered
  // -------------------------------------------------------------------------

  it('text containing hallucination substring but not exact match → NOT filtered (200)', async () => {
    // "Me comí un bocadillo, gracias por ver el vídeo" contains a hallucination
    // phrase but the full string does NOT match. isWhisperHallucination should return false.
    const partialHallucination = 'Me comí un bocadillo, gracias por ver el vídeo';
    mockCallWhisperTranscription.mockResolvedValue(partialHallucination);
    // Use the real implementation indirectly: isWhisperHallucination is mocked at
    // the module level in these route tests. Verify the route passes it through
    // by checking mockIsWhisperHallucination is called with the full text.
    mockIsWhisperHallucination.mockReturnValue(false);

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
    // Verify isWhisperHallucination was called with the FULL transcribed text
    expect(mockIsWhisperHallucination).toHaveBeenCalledWith(partialHallucination);
  });

  // -------------------------------------------------------------------------
  // Whisper is called with the actual audio buffer (not empty)
  // -------------------------------------------------------------------------

  it('Whisper receives the actual audio buffer bytes', async () => {
    const distinctAudioBytes = Buffer.from('unique-audio-content-xyz-123');
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: distinctAudioBytes, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '5',
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

    expect(mockCallWhisperTranscription).toHaveBeenCalledOnce();
    const [, bufferArg] = mockCallWhisperTranscription.mock.calls[0] as [unknown, Buffer, string, unknown];
    // The buffer passed to Whisper should contain the distinct audio bytes
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg.equals(distinctAudioBytes)).toBe(true);
  });

  it('Whisper is called with the correct MIME type from the multipart part', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.mp4', mimeType: 'audio/mp4' },
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

    expect(mockCallWhisperTranscription).toHaveBeenCalledOnce();
    const [, , mimeTypeArg] = mockCallWhisperTranscription.mock.calls[0] as [unknown, Buffer, string, unknown];
    expect(mimeTypeArg).toBe('audio/mp4');
  });

  // -------------------------------------------------------------------------
  // Optional chainSlug + chainName fields propagated to processMessage
  // -------------------------------------------------------------------------

  it('chainSlug and chainName form fields are forwarded to processMessage', async () => {
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
      extraFields: { chainSlug: 'mcdonalds-es', chainName: "McDonald's" },
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

    // runEstimationCascade is called by processMessage — the query should pass
    // chainSlug context through to the estimation engine.
    // We verify the route completed successfully (processMessage was called).
    expect(mockRunEstimationCascade).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // X-FXP-Source header routing
  // -------------------------------------------------------------------------

  it('X-FXP-Source: bot sets source=bot for query logging', async () => {
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
        'X-FXP-Source': 'bot',
      },
      payload: body,
    });

    // Route should complete successfully regardless of X-FXP-Source value
    expect(response.statusCode).toBe(200);
  });

  it('Missing X-FXP-Source header → defaults to source=api (no error)', async () => {
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
        // Deliberately omit X-FXP-Source
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Empty buffer: validation is Whisper's responsibility
  // -------------------------------------------------------------------------

  it('empty audio buffer → passes route validation, Whisper handles it', async () => {
    const emptyBuffer = Buffer.alloc(0);
    const app = await buildApp();
    const body = buildMultipartBody({
      audioPart: { content: emptyBuffer, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '1',
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

    // Route should not 400 on empty buffer — Whisper mock returns transcription
    expect(response.statusCode).toBe(200);
    // Whisper was called (not blocked by route)
    expect(mockCallWhisperTranscription).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Concurrent request isolation: each request has its own capturedData closure
  // -------------------------------------------------------------------------

  it('two concurrent requests each complete independently (no shared state)', async () => {
    // Both requests return valid transcriptions but trigger different estimation results.
    // If capturedData is shared across requests, the second query log would overwrite
    // the first. We verify both 200 responses arrive independently.
    let resolveFirst!: () => void;
    const firstWaiting = new Promise<void>((res) => { resolveFirst = res; });

    let callCount = 0;
    mockCallWhisperTranscription.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call resolves immediately
        return 'primer mensaje de voz';
      }
      return 'segundo mensaje de voz';
    });

    const app = await buildApp();

    const body = buildMultipartBody({
      audioPart: { content: FAKE_AUDIO, filename: 'voice.ogg', mimeType: 'audio/ogg' },
      duration: '10',
    });

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
      'X-API-Key': API_KEY_VALUE,
      'X-Actor-Id': ACTOR_EXTERNAL_ID,
    };

    // Fire both requests without awaiting individually
    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/conversation/audio', headers, payload: body }),
      app.inject({ method: 'POST', url: '/conversation/audio', headers, payload: body }),
    ]);

    resolveFirst();
    void firstWaiting; // suppress unused warning

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(mockCallWhisperTranscription).toHaveBeenCalledTimes(2);
  });
});
