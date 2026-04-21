// F091 — Unit tests for voiceIpRateLimit plugin helpers
//
// Tests getClientIp (XFF parsing) and incrementVoiceSeconds (Redis key format,
// TTL on first call, threshold arithmetic).
//
// Pattern: f069.actorRateLimit.unit.test.ts — no buildApp, mock Redis via vi.fn().

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getClientIp,
  incrementVoiceSeconds,
  isOverVoiceIpLimit,
  VOICE_IP_KEY_PREFIX,
  VOICE_IP_LIMIT_SECONDS,
} from '../plugins/voiceIpRateLimit.js';

// ---------------------------------------------------------------------------
// Mock Redis factory
// ---------------------------------------------------------------------------

function createMockRedis(currentSeconds: number | null = 0) {
  return {
    get: vi.fn().mockResolvedValue(currentSeconds === null ? null : String(currentSeconds)),
    incr: vi.fn().mockImplementation(async () => (currentSeconds ?? 0) + 1),
    incrby: vi.fn().mockImplementation(async (key: string, amount: number) => (currentSeconds ?? 0) + amount),
    expire: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

function createFailingRedis() {
  return {
    get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    incrby: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    expire: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  };
}

// ---------------------------------------------------------------------------
// Helper to create a synthetic Fastify-like request object
// ---------------------------------------------------------------------------

function makeRequest(xff: string | string[] | undefined, socketIp = '10.0.0.1') {
  return {
    headers: {
      ...(xff !== undefined ? { 'x-forwarded-for': xff } : {}),
    },
    ip: socketIp,
  };
}

// ---------------------------------------------------------------------------
// Tests: getClientIp
// ---------------------------------------------------------------------------

describe('getClientIp', () => {
  it('returns first IP from single-value X-Forwarded-For header', () => {
    const req = makeRequest('203.0.113.1');
    expect(getClientIp(req as Parameters<typeof getClientIp>[0])).toBe('203.0.113.1');
  });

  it('returns first IP from comma-separated X-Forwarded-For header', () => {
    const req = makeRequest('203.0.113.1, 10.1.1.1, 172.16.0.1');
    expect(getClientIp(req as Parameters<typeof getClientIp>[0])).toBe('203.0.113.1');
  });

  it('returns first IP from array X-Forwarded-For header', () => {
    const req = makeRequest(['203.0.113.2', '10.0.0.2']);
    expect(getClientIp(req as Parameters<typeof getClientIp>[0])).toBe('203.0.113.2');
  });

  it('falls back to request.ip when X-Forwarded-For is absent', () => {
    const req = makeRequest(undefined, '192.168.1.99');
    expect(getClientIp(req as Parameters<typeof getClientIp>[0])).toBe('192.168.1.99');
  });

  it('trims whitespace from extracted IP', () => {
    const req = makeRequest('  203.0.113.5  ');
    expect(getClientIp(req as Parameters<typeof getClientIp>[0])).toBe('203.0.113.5');
  });
});

// ---------------------------------------------------------------------------
// Tests: VOICE_IP_KEY_PREFIX and VOICE_IP_LIMIT_SECONDS constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('VOICE_IP_KEY_PREFIX is ip:voice-min:', () => {
    expect(VOICE_IP_KEY_PREFIX).toBe('ip:voice-min:');
  });

  it('VOICE_IP_LIMIT_SECONDS is 1800 (30 minutes)', () => {
    expect(VOICE_IP_LIMIT_SECONDS).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// Tests: isOverVoiceIpLimit
// ---------------------------------------------------------------------------

describe('isOverVoiceIpLimit', () => {
  it('returns false for 0 seconds accumulated', () => {
    expect(isOverVoiceIpLimit(0)).toBe(false);
  });

  it('returns false for exactly 1800 seconds (= 30 min, not over)', () => {
    expect(isOverVoiceIpLimit(1800)).toBe(false);
  });

  it('returns true for 1801 seconds (> 30 min)', () => {
    expect(isOverVoiceIpLimit(1801)).toBe(true);
  });

  it('returns false for 1799 seconds (just under limit)', () => {
    expect(isOverVoiceIpLimit(1799)).toBe(false);
  });

  it('returns true for 3600 seconds (2 hours — well over limit)', () => {
    expect(isOverVoiceIpLimit(3600)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: incrementVoiceSeconds
// ---------------------------------------------------------------------------

describe('incrementVoiceSeconds', () => {
  const ip = '203.0.113.10';
  const dateKey = '2026-04-21';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls incrby with correct Redis key format', async () => {
    const redis = createMockRedis(0);
    await incrementVoiceSeconds(redis as Parameters<typeof incrementVoiceSeconds>[0], ip, 15, dateKey);
    const expectedKey = `${VOICE_IP_KEY_PREFIX}${dateKey}:${ip}`;
    expect(redis.incrby).toHaveBeenCalledWith(expectedKey, 15);
  });

  it('sets TTL=86400 on first increment (when new counter created)', async () => {
    // incrby returns 15 (first call → currentSeconds was 0)
    const redis = createMockRedis(0);
    await incrementVoiceSeconds(redis as Parameters<typeof incrementVoiceSeconds>[0], ip, 15, dateKey);
    const expectedKey = `${VOICE_IP_KEY_PREFIX}${dateKey}:${ip}`;
    expect(redis.expire).toHaveBeenCalledWith(expectedKey, 86400);
  });

  it('does NOT set TTL when counter already existed (incrby > durationSec)', async () => {
    // Simulate existing counter: incrby returns 60 (had 45, added 15)
    const redis = {
      incrby: vi.fn().mockResolvedValue(60),
      expire: vi.fn().mockResolvedValue(1),
    };
    await incrementVoiceSeconds(redis as Parameters<typeof incrementVoiceSeconds>[0], ip, 15, dateKey);
    // expire should NOT be called — key already has a TTL from earlier
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('fails silently (no throw) when Redis throws on incrby', async () => {
    const redis = createFailingRedis();
    await expect(
      incrementVoiceSeconds(redis as Parameters<typeof incrementVoiceSeconds>[0], ip, 15, dateKey),
    ).resolves.not.toThrow();
  });

  it('uses today UTC date when dateKey is omitted', async () => {
    const redis = createMockRedis(0);
    await incrementVoiceSeconds(redis as Parameters<typeof incrementVoiceSeconds>[0], ip, 10);
    const today = new Date().toISOString().slice(0, 10);
    const expectedKey = `${VOICE_IP_KEY_PREFIX}${today}:${ip}`;
    expect(redis.incrby).toHaveBeenCalledWith(expectedKey, 10);
  });
});
