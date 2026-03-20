// Unit tests for scripts/seedApiKey.ts — key generation helpers
//
// Tests the exported pure functions without a real DB.
// Prisma upsert is mocked for the upsertBotKey integration test.

import { describe, it, expect, vi } from 'vitest';
import {
  generateDeterministicKey,
  generateRandomKey,
  computeKeyHash,
  computeKeyPrefix,
} from '../scripts/seedApiKey.js';

// ---------------------------------------------------------------------------
// Mock Prisma — needed at module load to prevent real DB connection
// ---------------------------------------------------------------------------

const { mockUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    apiKey: {
      upsert: mockUpsert,
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// generateDeterministicKey
// ---------------------------------------------------------------------------

describe('generateDeterministicKey', () => {
  it('returns a key matching /^fxp_[0-9a-f]{32}$/', () => {
    const key = generateDeterministicKey('my-seed');
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
  });

  it('is deterministic — same seed always produces same key', () => {
    const seed = 'consistent-seed-value';
    const key1 = generateDeterministicKey(seed);
    const key2 = generateDeterministicKey(seed);
    expect(key1).toBe(key2);
  });

  it('different seeds produce different keys', () => {
    const key1 = generateDeterministicKey('seed-alpha');
    const key2 = generateDeterministicKey('seed-beta');
    expect(key1).not.toBe(key2);
  });

  it('produces exactly 36 characters total (fxp_ + 32 hex)', () => {
    const key = generateDeterministicKey('test-seed');
    expect(key).toHaveLength(36);
  });
});

// ---------------------------------------------------------------------------
// generateRandomKey
// ---------------------------------------------------------------------------

describe('generateRandomKey', () => {
  it('returns a key matching /^fxp_[0-9a-f]{32}$/', () => {
    const key = generateRandomKey();
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
  });

  it('produces exactly 36 characters', () => {
    const key = generateRandomKey();
    expect(key).toHaveLength(36);
  });

  it('generates different keys on each call (random)', () => {
    // Very low probability of collision with 128-bit random key
    const key1 = generateRandomKey();
    const key2 = generateRandomKey();
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// computeKeyHash
// ---------------------------------------------------------------------------

describe('computeKeyHash', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = computeKeyHash('fxp_' + 'a'.repeat(32));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const rawKey = 'fxp_' + 'b'.repeat(32);
    expect(computeKeyHash(rawKey)).toBe(computeKeyHash(rawKey));
  });

  it('differs for different keys', () => {
    const h1 = computeKeyHash('fxp_' + 'a'.repeat(32));
    const h2 = computeKeyHash('fxp_' + 'b'.repeat(32));
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// computeKeyPrefix
// ---------------------------------------------------------------------------

describe('computeKeyPrefix', () => {
  it('returns the first 8 characters of the raw key', () => {
    const rawKey = 'fxp_abcd1234extra';
    expect(computeKeyPrefix(rawKey)).toBe('fxp_abcd');
  });

  it('returns exactly 8 characters', () => {
    const rawKey = 'fxp_' + 'e'.repeat(32);
    const prefix = computeKeyPrefix(rawKey);
    expect(prefix).toHaveLength(8);
  });

  it('prefix always starts with fxp_ for all generated keys', () => {
    const deterministicKey = generateDeterministicKey('any-seed');
    expect(computeKeyPrefix(deterministicKey)).toMatch(/^fxp_/);

    const randomKey = generateRandomKey();
    expect(computeKeyPrefix(randomKey)).toMatch(/^fxp_/);
  });
});

// ---------------------------------------------------------------------------
// upsertBotKey — integration via mocked Prisma
// ---------------------------------------------------------------------------

describe('upsertBotKey', () => {
  it('calls prisma.apiKey.upsert with correct args', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    const rawKey = 'fxp_' + 'f'.repeat(32);
    const expectedHash = computeKeyHash(rawKey);
    const expectedPrefix = computeKeyPrefix(rawKey);

    mockUpsert.mockResolvedValue({ id: 'test-id-001', keyPrefix: expectedPrefix });

    await upsertBotKey({ rawKey });

    expect(mockUpsert).toHaveBeenCalledOnce();
    const callArgs = mockUpsert.mock.calls[0]?.[0] as {
      where: { keyHash: string };
      create: { keyHash: string; keyPrefix: string; name: string; tier: string };
    };
    expect(callArgs.where.keyHash).toBe(expectedHash);
    expect(callArgs.create.keyHash).toBe(expectedHash);
    expect(callArgs.create.keyPrefix).toBe(expectedPrefix);
    expect(callArgs.create.name).toBe('Telegram Bot');
    expect(callArgs.create.tier).toBe('free');
  });

  it('is idempotent — calling twice with same key does not throw', async () => {
    const { upsertBotKey: upsert } = await import('../scripts/seedApiKey.js');
    const rawKey = generateDeterministicKey('idempotency-test-seed');
    const prefix = computeKeyPrefix(rawKey);

    mockUpsert.mockResolvedValue({ id: 'some-id', keyPrefix: prefix });

    await expect(upsert({ rawKey })).resolves.not.toThrow();
    await expect(upsert({ rawKey })).resolves.not.toThrow();
  });
});
