// ioredis singleton for the Telegram bot.
//
// Mirrors the API's redis.ts pattern: reads process.env directly to avoid
// circular imports. The singleton is created with lazyConnect: true so that
// importing this file does NOT trigger a network connection — important for
// tests that do not need Redis.
//
// Exports:
//   botRedis          — the ioredis Redis instance
//   connectBotRedis() — explicit connect, called from index.ts on startup
//   disconnectBotRedis() — graceful disconnect, called from index.ts shutdown

import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const botRedis = new Redis(
  process.env['REDIS_URL'] ?? 'redis://localhost:6380',
  {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
  },
);

// ---------------------------------------------------------------------------
// connectBotRedis — attempt explicit connection
// ---------------------------------------------------------------------------

/**
 * Attempt an explicit connection to Redis.
 * Resolves quietly if Redis is unavailable — logs a warn and returns false.
 * Returns true on success, false on failure.
 */
export async function connectBotRedis(): Promise<boolean> {
  try {
    await botRedis.connect();
    console.log('[botRedis] Connected to Redis');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[botRedis] Redis unavailable — conversation state will be disabled: ${message}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// disconnectBotRedis — graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Disconnect from Redis gracefully.
 * Safe to call even if Redis never connected — ioredis ignores quit() on an
 * already-closed connection. Swallows errors silently (logs a warn).
 */
export async function disconnectBotRedis(): Promise<void> {
  try {
    await botRedis.quit();
  } catch {
    console.warn('[botRedis] Error during disconnect');
  }
}
