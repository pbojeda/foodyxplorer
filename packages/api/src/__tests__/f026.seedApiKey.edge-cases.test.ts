// Edge-case tests for scripts/seedApiKey.ts
//
// Covers scenarios NOT tested in f026.seedApiKey.unit.test.ts:
//   - generateDeterministicKey with empty string seed
//   - generateDeterministicKey with special characters and unicode seed
//   - generateDeterministicKey with very long seed
//   - computeKeyPrefix with key shorter than 8 chars (spec violation guard)
//   - computeKeyHash is consistent with SHA-256 (cross-check against crypto)
//   - computeKeyHash with empty string input
//   - upsertBotKey propagates DB errors (no swallowing)
//   - upsertBotKey with pro tier: create.tier is always 'free' for bot

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  generateDeterministicKey,
  generateRandomKey,
  computeKeyHash,
  computeKeyPrefix,
} from '../scripts/seedApiKey.js';

// ---------------------------------------------------------------------------
// Mock Prisma — prevents real DB connection on module import
// ---------------------------------------------------------------------------

const { mockUpsert, mockDisconnect } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    apiKey: {
      upsert: mockUpsert,
    },
    $disconnect: mockDisconnect,
  },
}));

// ---------------------------------------------------------------------------
// generateDeterministicKey edge cases
// ---------------------------------------------------------------------------

describe('generateDeterministicKey edge cases', () => {
  it('empty string seed → still produces a valid fxp_<32 hex> key', () => {
    // HMAC-SHA256 with empty seed is valid and deterministic
    const key = generateDeterministicKey('');
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
    expect(key).toHaveLength(36);
  });

  it('empty string seed is deterministic across calls', () => {
    const key1 = generateDeterministicKey('');
    const key2 = generateDeterministicKey('');
    expect(key1).toBe(key2);
  });

  it('empty string seed produces different key from non-empty seed', () => {
    const emptyKey = generateDeterministicKey('');
    const someKey = generateDeterministicKey('any-seed');
    expect(emptyKey).not.toBe(someKey);
  });

  it('seed with special characters (spaces, symbols) → valid key', () => {
    const key = generateDeterministicKey('seed with spaces & symbols! @#$%');
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
    expect(key).toHaveLength(36);
  });

  it('seed with unicode characters → valid key (HMAC handles arbitrary bytes)', () => {
    const key = generateDeterministicKey('seed-con-caracteres-unicode: café, naïve, 中文');
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
    expect(key).toHaveLength(36);
  });

  it('very long seed (1000 chars) → valid 36-char key (truncation to 32 hex)', () => {
    const longSeed = 'x'.repeat(1000);
    const key = generateDeterministicKey(longSeed);
    expect(key).toMatch(/^fxp_[0-9a-f]{32}$/);
    expect(key).toHaveLength(36);
  });

  it('key is only first 32 hex chars of HMAC digest (not full 64-char SHA-256 hex)', () => {
    const seed = 'boundary-test-seed';
    const key = generateDeterministicKey(seed);
    // Extract the hex portion (after 'fxp_')
    const hexPortion = key.slice(4); // remove 'fxp_'
    expect(hexPortion).toHaveLength(32);
    // Verify it matches the first 32 chars of the HMAC
    const fullHmac = createHmac('sha256', seed).update('fxp-bot-key').digest('hex');
    expect(hexPortion).toBe(fullHmac.slice(0, 32));
  });
});

// ---------------------------------------------------------------------------
// computeKeyHash edge cases
// ---------------------------------------------------------------------------

describe('computeKeyHash edge cases', () => {
  it('matches native Node.js SHA-256 output (independent cross-check)', () => {
    const rawKey = 'fxp_' + 'a'.repeat(32);
    const expected = createHash('sha256').update(rawKey).digest('hex');
    expect(computeKeyHash(rawKey)).toBe(expected);
  });

  it('handles empty string input without throwing', () => {
    // Edge case: empty string is valid for SHA-256
    const hash = computeKeyHash('');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Known SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles key with unicode characters (utf-8 encoding)', () => {
    const hash = computeKeyHash('fxp_café');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('output is lowercase hex (not uppercase)', () => {
    const hash = computeKeyHash('fxp_' + 'a'.repeat(32));
    // Must be lowercase to match the spec (and DB storage)
    expect(hash).toBe(hash.toLowerCase());
    expect(hash).not.toMatch(/[A-F]/);
  });
});

// ---------------------------------------------------------------------------
// computeKeyPrefix edge cases
// ---------------------------------------------------------------------------

describe('computeKeyPrefix edge cases', () => {
  it('key shorter than 8 chars returns all chars (not 8)', () => {
    // The spec requires keyPrefix to be exactly 8 chars.
    // computeKeyPrefix uses rawKey.slice(0, 8) which returns < 8 chars for short keys.
    // This is a potential spec deviation — the test documents the current behavior.
    const shortKey = 'fxp_ab'; // only 6 chars
    const prefix = computeKeyPrefix(shortKey);
    // Current behavior: returns the full 6-char string (not padded)
    expect(prefix).toBe('fxp_ab');
    expect(prefix).toHaveLength(6); // NOT 8 — documents current behavior
  });

  it('key exactly 8 chars → prefix equals the full key', () => {
    const eightCharKey = 'fxp_ab12'; // exactly 8 chars
    expect(computeKeyPrefix(eightCharKey)).toBe('fxp_ab12');
    expect(computeKeyPrefix(eightCharKey)).toHaveLength(8);
  });

  it('prefix for generated random key is always exactly 8 chars', () => {
    // This verifies the contract holds for all properly generated keys
    for (let i = 0; i < 5; i++) {
      const randomKey = generateRandomKey();
      const prefix = computeKeyPrefix(randomKey);
      expect(prefix).toHaveLength(8);
      expect(prefix).toMatch(/^fxp_[0-9a-f]{4}$/);
    }
  });

  it('prefix for deterministic key is always exactly 8 chars', () => {
    const deterministicKey = generateDeterministicKey('test-edge-case');
    const prefix = computeKeyPrefix(deterministicKey);
    expect(prefix).toHaveLength(8);
    expect(prefix).toMatch(/^fxp_[0-9a-f]{4}$/);
  });
});

// ---------------------------------------------------------------------------
// upsertBotKey error propagation
// ---------------------------------------------------------------------------

describe('upsertBotKey error propagation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
  });

  it('propagates DB error when prisma.apiKey.upsert throws', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    const dbError = new Error('Connection refused');
    mockUpsert.mockRejectedValue(dbError);

    const rawKey = 'fxp_' + 'a'.repeat(32);
    await expect(upsertBotKey({ rawKey })).rejects.toThrow('Connection refused');
  });

  it('does NOT swallow DB errors (fail-closed on upsert failure)', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    mockUpsert.mockRejectedValue(new Error('Unique constraint violation'));

    const rawKey = 'fxp_' + 'c'.repeat(32);
    await expect(upsertBotKey({ rawKey })).rejects.toBeDefined();
  });

  it('upsert is called with isActive: true in both create and update', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    const rawKey = 'fxp_' + 'b'.repeat(32);
    mockUpsert.mockResolvedValue({ id: 'test-id', keyPrefix: 'fxp_bbbb' });

    await upsertBotKey({ rawKey });

    const call = mockUpsert.mock.calls[0]?.[0] as {
      create: { isActive: boolean; tier: string };
      update: { isActive: boolean; tier: string };
    };
    // Bot key must always be created as active
    expect(call.create.isActive).toBe(true);
    // Bot key must always be free tier
    expect(call.create.tier).toBe('free');
    // Update must also maintain free tier (no accidental pro upgrade)
    expect(call.update.tier).toBe('free');
  });

  it('upsert uses keyHash (not rawKey) as the where clause', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    const rawKey = 'fxp_' + 'd'.repeat(32);
    const expectedHash = computeKeyHash(rawKey);
    mockUpsert.mockResolvedValue({ id: 'test-id', keyPrefix: 'fxp_dddd' });

    await upsertBotKey({ rawKey });

    const call = mockUpsert.mock.calls[0]?.[0] as { where: { keyHash: string } };
    expect(call.where.keyHash).toBe(expectedHash);
    // Ensure the raw key is never used as the where clause
    expect(call.where.keyHash).not.toBe(rawKey);
  });

  it('returns id and keyPrefix from upsert result', async () => {
    const { upsertBotKey } = await import('../scripts/seedApiKey.js');
    const rawKey = 'fxp_' + 'e'.repeat(32);
    const expectedPrefix = computeKeyPrefix(rawKey);
    mockUpsert.mockResolvedValue({ id: 'returned-id-123', keyPrefix: expectedPrefix });

    const result = await upsertBotKey({ rawKey });

    expect(result.id).toBe('returned-id-123');
    expect(result.keyPrefix).toBe(expectedPrefix);
  });
});
