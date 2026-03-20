// seedApiKey.ts — Seed/upsert the Telegram Bot API key (F026)
//
// Standalone script: not part of the server build, not imported at runtime.
// Run via: npx tsx src/scripts/seedApiKey.ts
//
// Key generation:
//   - If BOT_API_KEY_SEED is set: HMAC-SHA256(seed, 'fxp-bot-key'), take first
//     32 hex chars, prepend 'fxp_' → 36-char deterministic key.
//   - If not set: crypto.randomBytes(16).toString('hex') → prepend 'fxp_'.
//
// Upsert by name = 'Telegram Bot' for idempotency (stable identity).
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

export interface UpsertBotKeyArgs {
  rawKey: string;
}

export interface UpsertBotKeyResult {
  id: string;
  keyPrefix: string;
}

/**
 * Upsert the Telegram Bot API key by name.
 * Idempotent: calling twice with the same rawKey is safe.
 */
export async function upsertBotKey({ rawKey }: UpsertBotKeyArgs): Promise<UpsertBotKeyResult> {
  const keyHash = computeKeyHash(rawKey);
  const keyPrefix = computeKeyPrefix(rawKey);

  const result = await prisma.apiKey.upsert({
    where: { keyHash },
    update: {
      keyPrefix,
      name: 'Telegram Bot',
      tier: 'free',
      isActive: true,
    },
    create: {
      keyHash,
      keyPrefix,
      name: 'Telegram Bot',
      tier: 'free',
      isActive: true,
    },
    select: { id: true, keyPrefix: true },
  });

  return { id: result.id, keyPrefix: result.keyPrefix };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const seed = process.env['BOT_API_KEY_SEED'];
  const rawKey = seed ? generateDeterministicKey(seed) : generateRandomKey();

  await upsertBotKey({ rawKey });

  // Print raw key to stdout — only time it is visible
  console.log(`BOT_API_KEY=${rawKey}`);
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
