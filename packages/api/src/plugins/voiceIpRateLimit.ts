// voiceIpRateLimit.ts — Per-IP daily voice-minute cap (F091 AC22)
//
// Enforces a 30-minute/day per-IP voice cap to prevent UUID-rotation bypass
// of the per-actor rate limit. This is a soft cap for cost control, not a
// hard security boundary (see race condition note below).
//
// Redis key: ip:voice-min:<YYYY-MM-DD>:<ip>  (string — seconds counter)
// TTL: 86400s (auto-expires at day boundary UTC)
//
// IMPORTANT: Race condition exists — two concurrent requests from the same IP
// can both pass the onRequest check if they arrive simultaneously near the
// limit. This is intentional per spec: the cap is a soft cost control, not
// an exact enforcement boundary. Documenting here per F091 plan §Open Q3.
//
// Failure policy: fail-open — if Redis is unavailable, the request proceeds.
// This matches the existing actorRateLimit.ts policy for authenticated users.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Constants (exported for testability)
// ---------------------------------------------------------------------------

export const VOICE_IP_KEY_PREFIX = 'ip:voice-min:' as const;

/** Hard cap: 30 min = 1800 seconds per IP per day */
export const VOICE_IP_LIMIT_SECONDS = 1800;

// ---------------------------------------------------------------------------
// getClientIp — XFF-aware IP extraction
// ---------------------------------------------------------------------------

/**
 * Extract the real client IP from the request.
 *
 * Prefers the first IP in X-Forwarded-For (set by Render/Cloudflare reverse
 * proxy). Falls back to socket IP (request.ip) when XFF is absent.
 */
export function getClientIp(
  request: Pick<FastifyRequest, 'headers' | 'ip'>,
): string {
  const xff = request.headers['x-forwarded-for'];

  if (typeof xff === 'string' && xff.trim().length > 0) {
    // Take first IP from comma-separated list (closest to client)
    const first = xff.split(',')[0];
    if (first !== undefined) return first.trim();
  }

  if (Array.isArray(xff) && xff.length > 0) {
    const first = xff[0];
    if (first !== undefined) return first.trim();
  }

  return request.ip;
}

// ---------------------------------------------------------------------------
// isOverVoiceIpLimit — threshold check helper (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Returns true if the accumulated voice seconds for this IP exceeds the daily
 * 30-minute limit.
 */
export function isOverVoiceIpLimit(accumulatedSeconds: number): boolean {
  return accumulatedSeconds > VOICE_IP_LIMIT_SECONDS;
}

// ---------------------------------------------------------------------------
// incrementVoiceSeconds — post-Whisper counter increment
// ---------------------------------------------------------------------------

/**
 * Atomically increment the per-IP daily voice-seconds counter in Redis.
 *
 * Called from conversation.ts AFTER a successful Whisper transcription so
 * that failed/rejected requests are not counted against the IP cap.
 *
 * Sets TTL=86400 only on the first increment (when the counter is newly
 * created = returned value equals the durationSec argument).
 *
 * Fails silently on Redis errors — logged by caller if needed.
 *
 * @param redis       Redis client
 * @param ip          Client IP (from getClientIp)
 * @param durationSec Verified audio duration in seconds
 * @param dateKey     Optional YYYY-MM-DD override (defaults to today UTC)
 */
export async function incrementVoiceSeconds(
  redis: Pick<Redis, 'incrby' | 'expire'>,
  ip: string,
  durationSec: number,
  dateKey?: string,
): Promise<void> {
  const today = dateKey ?? new Date().toISOString().slice(0, 10);
  const key = `${VOICE_IP_KEY_PREFIX}${today}:${ip}`;

  // Redis INCRBY requires an integer. parseAudioDuration returns floats
  // (e.g. 10.734s). Round UP so short clips still count as ≥ 1s.
  const incrementBy = Math.max(1, Math.ceil(durationSec));

  try {
    const newValue = await redis.incrby(key, incrementBy);
    // Only set TTL on first increment — when newValue equals the amount
    // we just added (meaning the key was created by this call).
    if (newValue === incrementBy) {
      await redis.expire(key, 86400);
    }
  } catch {
    // Fail silently — caller may log if desired
  }
}

// ---------------------------------------------------------------------------
// registerVoiceIpRateLimit — Fastify plugin
// ---------------------------------------------------------------------------

interface PluginOptions {
  redis: Redis;
}

/**
 * Registers an onRequest hook that blocks requests when the per-IP daily
 * voice-second counter exceeds 30 minutes (1800 seconds).
 *
 * Only fires on POST /conversation/audio. All other routes are unaffected.
 */
export async function registerVoiceIpRateLimit(
  app: FastifyInstance,
  { redis }: PluginOptions,
): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Only apply to the voice audio endpoint
    if (request.routeOptions.url !== '/conversation/audio') return;

    const ip = getClientIp(request);
    const today = new Date().toISOString().slice(0, 10);
    const key = `${VOICE_IP_KEY_PREFIX}${today}:${ip}`;

    let currentSeconds = 0;

    try {
      const raw = await redis.get(key);
      currentSeconds = raw !== null ? parseInt(raw, 10) : 0;
    } catch {
      // Fail-open on Redis errors — request proceeds
      return;
    }

    if (isOverVoiceIpLimit(currentSeconds)) {
      const resetAt = computeMidnightUtc(today);
      throw Object.assign(
        new Error('Per-IP daily voice limit exceeded (30 min/day)'),
        {
          code: 'IP_VOICE_LIMIT_EXCEEDED',
          details: { limitMinutes: 30, resetAt },
        },
      );
    }
  });
}

/** Compute next-day midnight UTC ISO string from a YYYY-MM-DD date key */
function computeMidnightUtc(dateKey: string): string {
  const parts = dateKey.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m, d + 1)).toISOString();
}
