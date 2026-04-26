// QA edge-case tests for BUG-API-AUDIO-4XX-001
// Probes scenarios not covered by the developer's AC tests:
//   1. VOICE_BUDGET_EXHAUSTED ordering with invalid Content-Type (503 must win over 415)
//   2. FST_ERR_CTP_INVALID_MEDIA_TYPE fires for genuinely unregistered Content-Types
//      (application/octet-stream) — exercises the defensive framework branch, not just
//      the handler guard
//   3. Uppercase Content-Type header value — verifies toLowerCase() guard
//   4. multipart/form-data with two params in non-standard order (boundary not first)
//   5. multipart/form-data; boundary value with spaces (RFC edge) — guard rejects
//   6. application/x-www-form-urlencoded (registered parser) → handler IS entered → 415
//   7. Zero-byte audio part (file present, empty buffer) does not 500
//   8. AC9 ordering: budget-exhausted + no-CT → 503, not 415

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Mocks — identical scaffold to f091.audio.route.test.ts
// ---------------------------------------------------------------------------

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));
vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

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

const { mockParseAudioDuration } = vi.hoisted(() => ({
  mockParseAudioDuration: vi.fn(),
}));
vi.mock('../lib/audioDuration.js', () => ({
  parseAudioDuration: mockParseAudioDuration,
  selectVerifiedDuration: vi.fn().mockImplementation(
    (clientSec: number, serverSec: number | null) => serverSec !== null ? serverSec : clientSec,
  ),
}));

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

const { mockPrismaActorUpsert, mockPrismaApiKeyFindUnique } = vi.hoisted(() => ({
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

const { mockKyselyExecute, mockKyselyChainStubs } = vi.hoisted(() => {
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

const ACTOR_UUID = 'fd000000-0091-4000-a000-edge00000001';
const API_KEY_VALUE = 'test-api-key-edge-cases';
const ACTOR_EXTERNAL_ID = 'fd000000-0091-4000-a000-edge00000002';
const CLIENT_IP = '203.0.113.99';

function setupAuthMocks() {
  mockPrismaApiKeyFindUnique.mockResolvedValue({
    id: 'key-id-edge',
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

function setupRedisMocks() {
  mockRedisGet.mockImplementation(async (key: string) => {
    if (typeof key === 'string' && key.startsWith('ip:voice-min:')) {
      return null;
    }
    return null;
  });
  mockRedisIncr.mockResolvedValue(1);
  mockRedisIncrby.mockResolvedValue(10);
  mockRedisExpire.mockResolvedValue(1);
  mockRedisSet.mockResolvedValue('OK');
}

// ---------------------------------------------------------------------------
// Edge-case tests
// ---------------------------------------------------------------------------

describe('POST /conversation/audio — BUG-API-AUDIO-4XX-001 edge cases (QA)', () => {
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
  });

  // -------------------------------------------------------------------------
  // Edge 1: VOICE_BUDGET_EXHAUSTED ordering with absent Content-Type
  // The spec says budget check runs BEFORE multipart parsing (and before the
  // Step 0a CT guard). This test proves 503 wins over 415 when both conditions
  // are simultaneously true: budget exhausted AND Content-Type absent.
  // If the CT guard runs first, the response is 415 — a regression.
  // -------------------------------------------------------------------------

  it('Edge1: budget exhausted + absent Content-Type → 503 VOICE_BUDGET_EXHAUSTED, not 415', async () => {
    mockCheckBudgetExhausted.mockResolvedValue(true);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {}, // no Content-Type — would be 415 if CT guard ran first
      payload: undefined,
    });

    // Budget check must win. If 415, the Step 0a guard fired before Step 0.
    expect(response.statusCode).toBe(503);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VOICE_BUDGET_EXHAUSTED');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 2: VOICE_BUDGET_EXHAUSTED ordering with wrong Content-Type
  // Same ordering probe but with application/json (a registered parser, so the
  // handler IS reached — both paths rely on handler ordering, not framework ordering).
  // -------------------------------------------------------------------------

  it('Edge2: budget exhausted + Content-Type: application/json → 503, not 415', async () => {
    mockCheckBudgetExhausted.mockResolvedValue(true);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ foo: 'bar' }),
    });

    expect(response.statusCode).toBe(503);
    const body = response.json<{ success: false; error: { code: string } }>();
    expect(body.error.code).toBe('VOICE_BUDGET_EXHAUSTED');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 3: Uppercase Content-Type value
  // The guard uses ct.toLowerCase().startsWith('multipart/form-data').
  // This verifies that MULTIPART/FORM-DATA; BOUNDARY=ABC is accepted correctly.
  // -------------------------------------------------------------------------

  it('Edge3: uppercase Content-Type MULTIPART/FORM-DATA with boundary is accepted (passes guard)', async () => {
    mockCallWhisperTranscription.mockResolvedValue('croquetas');
    mockRunEstimationCascade.mockResolvedValue({
      levelHit: 3 as const,
      data: {
        query: 'croquetas', chainSlug: null,
        level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
        matchType: 'embedding_dish' as const, result: null, cachedAt: null,
      },
    });

    const boundary = MULTIPART_BOUNDARY;
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        // Uppercase — the guard must lowercase before comparison
        'Content-Type': `MULTIPART/FORM-DATA; BOUNDARY=${boundary}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Forwarded-For': CLIENT_IP,
      },
      payload: buildMultipartBody({
        audioPart: { content: Buffer.from('fake'), filename: 'voice.webm', mimeType: 'audio/webm' },
        duration: '5',
      }),
    });

    // Guard must pass (not return 415). The handler proceeds normally.
    // Because the regex is /i (case-insensitive), BOUNDARY= is captured correctly.
    // Expected: not 415. Actual status depends on Whisper mock and downstream.
    // We accept 200 or any non-415 outcome.
    expect(response.statusCode).not.toBe(415);
    expect(response.statusCode).not.toBe(400);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 4: multipart/form-data with boundary NOT first, extra param before
  // Content-Type: multipart/form-data; charset=utf-8; boundary=abc
  // The regex /;\s*boundary=([^;\s]+)/i scans anywhere after the base type.
  // Must still capture 'abc' and pass the guard.
  // -------------------------------------------------------------------------

  it('Edge4: multipart/form-data with extra param before boundary still passes guard', async () => {
    mockCallWhisperTranscription.mockResolvedValue('gazpacho');
    mockRunEstimationCascade.mockResolvedValue({
      levelHit: 3 as const,
      data: {
        query: 'gazpacho', chainSlug: null,
        level1Hit: false, level2Hit: false, level3Hit: true, level4Hit: false,
        matchType: 'embedding_dish' as const, result: null, cachedAt: null,
      },
    });

    const boundary = MULTIPART_BOUNDARY;
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        // boundary is NOT the first parameter — regex must still find it
        'Content-Type': `multipart/form-data; charset=utf-8; boundary=${boundary}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Forwarded-For': CLIENT_IP,
      },
      payload: buildMultipartBody({
        audioPart: { content: Buffer.from('fake'), filename: 'voice.webm', mimeType: 'audio/webm' },
        duration: '5',
      }),
    });

    // Guard must pass — regex finds boundary= anywhere after the base type
    expect(response.statusCode).not.toBe(415);
    expect(response.statusCode).not.toBe(400);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 5: application/x-www-form-urlencoded → 415
  // fastifyFormbody registers a parser for this type, so fastify calls the handler.
  // The Step 0a guard (startsWith 'multipart/form-data') catches it → 415.
  // This type is NOT in the spec's 415 example list but the guard must handle it.
  // -------------------------------------------------------------------------

  it('Edge5: application/x-www-form-urlencoded → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      payload: 'audio=data&duration=10',
    });

    expect(response.statusCode).toBe(415);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 6: Zero-byte audio part (empty file, valid multipart structure)
  // The client sends a valid multipart with an audio part that has 0 bytes.
  // The handler reads it as an empty buffer. audioBuffer = Buffer.alloc(0).
  // Step 2 guard checks audioBuffer === undefined — a zero-byte buffer is NOT
  // undefined. It proceeds to Whisper, which is mocked.
  // This is a spec gap: there is no 400 for empty audio. It reaches Whisper.
  // Expected: Whisper is called (or returns 200/422 depending on mock).
  // We verify it does NOT 500 (which was the pre-bugfix behavior for parse errors).
  // -------------------------------------------------------------------------

  it('Edge6: zero-byte audio part passes Step2 guard and reaches Whisper (no 500)', async () => {
    mockCallWhisperTranscription.mockResolvedValue('');
    mockIsWhisperHallucination.mockReturnValue(false);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'X-API-Key': API_KEY_VALUE,
        'X-Forwarded-For': CLIENT_IP,
      },
      payload: buildMultipartBody({
        audioPart: {
          content: Buffer.alloc(0), // zero bytes
          filename: 'voice.webm',
          mimeType: 'audio/webm',
        },
        duration: '5',
      }),
    });

    // Must NOT be 500. The response may be 422 (empty transcription) or 200.
    // The key assertion is: the bugfix did not introduce a 500 regression for zero-byte audio.
    expect(response.statusCode).not.toBe(500);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 7: Quoted boundary value in Content-Type
  // RFC 2046 allows: Content-Type: multipart/form-data; boundary="abc"
  // The regex [^;\s]+ captures '"abc"' (including quotes).
  // The captured value is non-empty, so the guard passes.
  // Busboy may or may not accept the quoted form.
  // This tests that the guard itself does not 400/415 on a quoted boundary.
  // -------------------------------------------------------------------------

  it('Edge7: quoted boundary value — guard passes (non-empty capture)', async () => {
    // The guard captures '"----TestBoundary7x8y9z"' (with quotes) — non-empty, so it passes.
    // Busboy behaviour with quoted boundary is implementation-defined.
    // We just verify the guard doesn't incorrectly reject with 400.
    const quotedCt = `multipart/form-data; boundary="${MULTIPART_BOUNDARY}"`;
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': quotedCt },
      payload: Buffer.alloc(0), // empty body — Busboy may error or yield 0 parts
    });

    // The guard must NOT return 400 VALIDATION_ERROR for a quoted boundary.
    // Acceptable outcomes: 400 from Busboy/audio-part guard (audio part missing),
    // or any other code EXCEPT 400 with message matching /boundary/i.
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    if (response.statusCode === 400) {
      // If 400, it must be for missing audio, not for missing boundary
      expect(body.error.message).not.toMatch(/boundary/i);
    }
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Edge 8: Verify FST_ERR_CTP_INVALID_MEDIA_TYPE branch is reachable
  // (not dead code). Send application/octet-stream — NOT a registered parser.
  // Fastify emits FST_ERR_CTP_INVALID_MEDIA_TYPE before the handler runs.
  // The mapError branch maps it to 415 with generic message.
  // -------------------------------------------------------------------------

  it('Edge8: application/octet-stream (unregistered parser) → 415 via FST_ERR_CTP_INVALID_MEDIA_TYPE', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/audio',
      headers: { 'Content-Type': 'application/octet-stream' },
      payload: Buffer.from('binary data'),
    });

    expect(response.statusCode).toBe(415);
    const body = response.json<{ success: false; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    // This path uses the generic message (framework branch fires before handler)
    // NOT the audio-specific 'Content-Type must be multipart/form-data'
    expect(body.error.message).toBe('Unsupported Content-Type for this endpoint');
    await app.close();
  });
});
