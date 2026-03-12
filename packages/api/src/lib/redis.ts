// ioredis singleton for the API server.
//
// Mirrors the prisma.ts pattern: reads process.env directly to avoid circular
// imports. The singleton is created with lazyConnect: true so that importing
// this file does NOT trigger a network connection — important for tests that
// do not need Redis.
//
// Exports:
//   redis          — the ioredis Redis instance
//   connectRedis() — explicit connect, called from server.ts on startup
//   disconnectRedis() — graceful disconnect, called from server.ts shutdown

import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const redis = new Redis(
  process.env['REDIS_URL'] ?? 'redis://localhost:6380',
  {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
  },
);

// ---------------------------------------------------------------------------
// connectRedis — attempt explicit connection
// ---------------------------------------------------------------------------

/**
 * Attempt an explicit connection to Redis.
 * Resolves quietly if Redis is unavailable — logs a warn and returns false.
 * Returns true on success, false on failure.
 */
export async function connectRedis(): Promise<boolean> {
  try {
    await redis.connect();
    console.log('[redis] Connected to Redis');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[redis] Redis unavailable — cache and rate limiting will be disabled: ${message}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// disconnectRedis — graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Disconnect from Redis gracefully.
 * Safe to call even if Redis never connected — ioredis ignores quit() on an
 * already-closed connection. Swallows errors silently (logs a warn).
 */
export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    console.warn('[redis] Error during disconnect');
  }
}
