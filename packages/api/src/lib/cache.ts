// Generic cache helper — JSON-serialised key/value caching over ioredis.
//
// All methods fail open: errors are caught, logged via the injected Pino
// logger, and translated to null/void. Callers never need to guard against
// cache errors.
//
// Key format: "fxp:<entity>:<id>"
// Default TTL: 300 seconds (5 minutes)

import type { FastifyBaseLogger } from 'fastify';
import { redis } from './redis.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheOptions {
  ttl?: number; // seconds. Default: 300
}

const DEFAULT_TTL = 300;

// ---------------------------------------------------------------------------
// buildKey
// ---------------------------------------------------------------------------

/**
 * Build a namespaced key: "fxp:<entity>:<id>"
 * e.g. buildKey("food", "uuid-123") → "fxp:food:uuid-123"
 */
export function buildKey(entity: string, id: string): string {
  return `fxp:${entity}:${id}`;
}

// ---------------------------------------------------------------------------
// cacheGet
// ---------------------------------------------------------------------------

/**
 * Retrieve and deserialise a cached value.
 * Returns null on miss or any Redis error.
 */
export async function cacheGet<T>(
  key: string,
  logger: FastifyBaseLogger,
): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`cacheGet error for key "${key}": ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// cacheSet
// ---------------------------------------------------------------------------

/**
 * Serialise and store a value with a TTL.
 * No-op when value is null or undefined.
 * No-op on Redis error (logs warn).
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  logger: FastifyBaseLogger,
  options?: CacheOptions,
): Promise<void> {
  if (value === null || value === undefined) return;

  const ttl = options?.ttl ?? DEFAULT_TTL;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`cacheSet error for key "${key}": ${message}`);
  }
}

// ---------------------------------------------------------------------------
// cacheDel
// ---------------------------------------------------------------------------

/**
 * Delete a single key. No-op on error (logs warn).
 */
export async function cacheDel(
  key: string,
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    await redis.del(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`cacheDel error for key "${key}": ${message}`);
  }
}

// ---------------------------------------------------------------------------
// cacheInvalidatePattern
// ---------------------------------------------------------------------------

/**
 * Delete all keys matching a glob pattern using cursor-based SCAN + DEL.
 * Uses SCAN with COUNT 100 to avoid blocking the Redis server.
 * No-op on error (logs warn).
 */
export async function cacheInvalidatePattern(
  pattern: string,
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }
    } while (cursor !== '0');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`cacheInvalidatePattern error for pattern "${pattern}": ${message}`);
  }
}
