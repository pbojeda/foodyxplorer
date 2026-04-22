// seedApiKey.ts — Seed/upsert API keys (F026 + F-TIER)
//
// Standalone script: not part of the server build, not imported at runtime.
// Run via: npx tsx src/scripts/seedApiKey.ts [--tier free|pro|admin]
//
// Key generation:
//   - If SEED_KEY_PLAIN is set: use that value directly as the raw key.
//   - Else if BOT_API_KEY_SEED is set: HMAC-SHA256(seed, 'fxp-bot-key'), take first
//     32 hex chars, prepend 'fxp_' → 36-char deterministic key.
//   - Else: crypto.randomBytes(16).toString('hex') → prepend 'fxp_'.
//
// Tier:
//   - Default: 'free' (backward-compatible with F026 bot key seeding)
//   - --tier admin: creates an admin key with no daily rate limits
//   - --tier pro: creates a pro key
//
// Upsert by keyHash for idempotency (same key → same hash → no-op upsert).
// The raw key is always printed to stdout — never stored unencrypted.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// Key generation helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic bot API key from a seed string.
 * Uses HMAC-SHA256(seed, 'fxp-bot-key'), takes first 32 hex chars.
 */
export function generateDeterministicKey(seed: string): string {
  const hmac = createHmac('sha256', seed).update('fxp-bot-key').digest('hex');
  return 'fxp_' + hmac.slice(0, 32);
}

/**
 * Generate a random bot API key using crypto.randomBytes.
 */
export function generateRandomKey(): string {
  return 'fxp_' + randomBytes(16).toString('hex');
}

/**
 * Compute SHA-256 hash of the raw key (for DB storage).
 * Returns 64-char hex string.
 */
export function computeKeyHash(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Extract the key prefix: first 8 chars of the full raw key
 * (e.g. 'fxp_' + first 4 hex chars = 8 chars total).
 */
export function computeKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Upsert logic — exported for unit testing
// ---------------------------------------------------------------------------

export interface UpsertKeyArgs {
  rawKey: string;
  tier?: 'free' | 'pro' | 'admin';
  name?: string;
}

export interface UpsertKeyResult {
  id: string;
  keyPrefix: string;
}

/**
 * Upsert an API key by hash.
 * Idempotent: calling twice with the same rawKey is safe.
 */
export async function upsertKey({ rawKey, tier = 'free', name }: UpsertKeyArgs): Promise<UpsertKeyResult> {
  const keyHash = computeKeyHash(rawKey);
  const keyPrefix = computeKeyPrefix(rawKey);
  const keyName = name ?? (tier === 'admin' ? 'Admin Key' : tier === 'pro' ? 'Pro Key' : 'Telegram Bot');

  const result = await prisma.apiKey.upsert({
    where: { keyHash },
    update: {
      keyPrefix,
      name: keyName,
      tier,
      isActive: true,
    },
    create: {
      keyHash,
      keyPrefix,
      name: keyName,
      tier,
      isActive: true,
    },
    select: { id: true, keyPrefix: true },
  });

  return { id: result.id, keyPrefix: result.keyPrefix };
}

// Backward-compatible wrapper — existing F026 tests import this
export interface UpsertBotKeyArgs {
  rawKey: string;
}

export type UpsertBotKeyResult = UpsertKeyResult;

export async function upsertBotKey({ rawKey }: UpsertBotKeyArgs): Promise<UpsertBotKeyResult> {
  return upsertKey({ rawKey, tier: 'free', name: 'Telegram Bot' });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseTierArg(): 'free' | 'pro' | 'admin' {
  const tierIndex = process.argv.indexOf('--tier');
  if (tierIndex === -1) return 'free';
  const value = process.argv[tierIndex + 1];
  if (value === 'free' || value === 'pro' || value === 'admin') return value;
  console.error(`Invalid tier: "${value}". Must be free, pro, or admin.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const tier = parseTierArg();
  const plainKey = process.env['SEED_KEY_PLAIN'];
  const botSeed = process.env['BOT_API_KEY_SEED'];

  // SEED_KEY_PLAIN takes precedence (F-TIER spec)
  const rawKey = plainKey ?? (botSeed ? generateDeterministicKey(botSeed) : generateRandomKey());

  await upsertKey({ rawKey, tier });

  // Print raw key to stdout — only time it is visible
  if (botSeed && !plainKey) {
    // Backward-compatible output for bot deployment
    console.log(`BOT_API_KEY=${rawKey}`);
  } else {
    console.log(`SEED_KEY_PLAIN=${rawKey}`);
  }
  console.log(`Tier: ${tier}`);
}

// Run when executed directly via tsx/node (not when imported by tests)
if (require.main === module) {
  main()
    .catch((err: unknown) => {
      console.error('[seedApiKey] Error:', err);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
