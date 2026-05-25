// F030-lite: Sentry error capture wrapper.
//
// Thin facade over @sentry/node so production code never imports the SDK
// directly. Two invariants:
//   1. `initSentry` no-ops unless env === 'production' AND dsn is set
//      (NODE_ENV=test path stays inert even if a developer has SENTRY_DSN
//      configured locally).
//   2. `captureException` no-ops when Sentry was not initialized.
//
// PII scrubbing is layered:
//   - sendDefaultPii: false (SDK-level)
//   - beforeSend strips Authorization/Cookie/x-api-key headers, request body,
//     query string, ip address, and denylist-matched extra keys.
//   - SentryContext interface restricts what production code can attach.

import * as Sentry from '@sentry/node';
import { createHash } from 'node:crypto';

/**
 * Allowlisted context fields that may be forwarded to Sentry alongside
 * an exception. Any field not listed here is intentionally absent —
 * adding `body`, `headers`, raw `actorId`, or user content requires a
 * spec change.
 */
export interface SentryContext {
  route?: string;
  method?: string;
  requestId?: string;
  statusCode?: number;
  internalCode?: string;
  actorIdHash?: string;
  // F107a-FU2: collision detection hash fields (PII-scrubbed via hashActor()).
  collisionActorIdHash?: string;
  victimAccountIdHash?: string;
  hijackerAccountIdHash?: string;
  externalIdHash?: string;
}

let initialized = false;

const DENYLIST_KEY_PATTERN = /password|secret|token|api[_-]?key|cookie|authorization/i;

function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    if (event.request.headers && typeof event.request.headers === 'object') {
      const headers = event.request.headers as Record<string, unknown>;
      delete headers['authorization'];
      delete headers['Authorization'];
      delete headers['cookie'];
      delete headers['Cookie'];
      delete headers['x-api-key'];
      delete headers['X-Api-Key'];
    }
    if (event.request.data !== undefined) {
      event.request.data = '[Filtered]';
    }
    if (event.request.query_string !== undefined) {
      event.request.query_string = '[Filtered]';
    }
  }
  if (event.user && event.user.ip_address !== undefined) {
    event.user.ip_address = '[Filtered]';
  }
  if (event.extra && typeof event.extra === 'object') {
    const extra = event.extra as Record<string, unknown>;
    for (const key of Object.keys(extra)) {
      if (DENYLIST_KEY_PATTERN.test(key)) {
        extra[key] = '[Filtered]';
      }
    }
  }
  return event;
}

/**
 * Initialize Sentry. No-op unless `env === 'production'` AND `dsn` is a
 * non-empty string. Safe to call multiple times — the second call no-ops.
 */
export function initSentry(dsn: string | undefined, env: string): void {
  if (initialized) return;
  if (!dsn || env !== 'production') {
    // Log on the inert path so a misconfigured operator can tell apart
    // "Sentry didn't capture because it's disabled" from "Sentry tried to
    // capture but the SDK failed". The checklist tells operators to grep
    // for these markers.
    console.log(`[sentry] inert (env=${env}, dsn=${dsn ? 'set' : 'unset'})`);
    return;
  }
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend,
  });
  initialized = true;
  console.log(`[sentry] initialized (env=${env})`);
}

/**
 * Forward an exception to Sentry with an allowlisted context envelope.
 * No-op when Sentry was not initialized (dev/test/missing-DSN paths).
 */
export function captureException(err: unknown, context?: SentryContext): void {
  if (!initialized) return;
  // Sentry typings expect `extra: Extras = { [k: string]: any }`. The
  // SentryContext interface is structurally narrower; coerce explicitly
  // (no runtime conversion — the SDK accepts any record-shaped object).
  Sentry.captureException(err, { extra: context as Record<string, unknown> | undefined });
}

/**
 * Emit a structured message to Sentry at the specified level, with optional
 * allowlisted context and filterable tags.
 * No-op when Sentry was not initialized (dev/test/missing-DSN paths).
 *
 * Uses `Sentry.withScope` so extras and tags are scoped to this event only
 * (does not pollute the global scope).
 */
export function captureMessage(
  message: string,
  level: 'warning' | 'error' | 'info',
  context?: SentryContext,
  tags?: Record<string, string>,
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context as Record<string, unknown>);
    if (tags) scope.setTags(tags);
    Sentry.captureMessage(message, level);
  });
}

/**
 * Stable, non-reversible identifier for an actor — first 8 hex chars of
 * sha256(actorId ?? 'anonymous'). Used so Sentry can correlate events
 * across a single user's session without leaking the raw actorId
 * (which is currently a UUID that may be cross-referenced with the
 * actor table).
 */
export function hashActor(actorId: string | undefined): string {
  // `||` (not `??`) so the empty-string actorId also falls back to
  // 'anonymous' — empty-string is semantically "no actor" not a real id.
  return createHash('sha256').update(actorId || 'anonymous').digest('hex').slice(0, 8);
}

/**
 * Reset the module's initialization flag. ONLY for tests — production code
 * must never call this. Exported separately to discourage misuse.
 */
export function __resetForTests(): void {
  initialized = false;
}
