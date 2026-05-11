// F030-lite QA edge-case tests for lib/sentry.ts
//
// Covers scenarios the developer's 10 tests did not explicitly exercise:
//   - beforeSend with missing request / extra / user subtrees
//   - captureException with non-Error inputs (string, number, null, undefined)
//   - empty-string actorId in hashActor
//   - initSentry called twice (idempotence — Sentry.init must not be called twice)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
}));

import * as Sentry from '@sentry/node';
import {
  initSentry,
  captureException,
  hashActor,
  __resetForTests,
} from '../../lib/sentry.js';

const mockedInit = Sentry.init as ReturnType<typeof vi.fn>;
const mockedCapture = Sentry.captureException as ReturnType<typeof vi.fn>;

function getBeforeSend(): (event: unknown) => unknown {
  initSentry('https://x@sentry.io/1', 'production');
  const cfg = mockedInit.mock.calls[0]?.[0] as { beforeSend: (e: unknown) => unknown };
  return cfg.beforeSend;
}

describe('lib/sentry — edge cases', () => {
  beforeEach(() => {
    mockedInit.mockClear();
    mockedCapture.mockClear();
    __resetForTests();
  });

  // -------------------------------------------------------------------------
  // beforeSend: partial / missing event subtrees
  // -------------------------------------------------------------------------

  it('beforeSend: event with NO request subtree does not crash', () => {
    const bs = getBeforeSend();
    const event = { user: { ip_address: '1.2.3.4' }, extra: {} };
    expect(() => bs(event)).not.toThrow();
    const result = bs(event) as typeof event;
    expect(result).toBeDefined();
    // user.ip_address should still be scrubbed
    expect((result as Record<string, unknown> & { user: { ip_address: string } }).user.ip_address).toBe('[Filtered]');
  });

  it('beforeSend: event with NO extra subtree does not crash', () => {
    const bs = getBeforeSend();
    const event = { request: { headers: { authorization: 'Bearer s' } } };
    expect(() => bs(event)).not.toThrow();
    const result = bs(event) as { request: { headers: Record<string, unknown> } };
    expect(result.request.headers['authorization']).toBeUndefined();
  });

  it('beforeSend: event with NO user subtree does not crash', () => {
    const bs = getBeforeSend();
    const event = { request: { data: 'body content' } };
    expect(() => bs(event)).not.toThrow();
    const result = bs(event) as { request: { data: unknown } };
    expect(result.request.data).toBe('[Filtered]');
  });

  it('beforeSend: completely empty event object does not crash', () => {
    const bs = getBeforeSend();
    expect(() => bs({})).not.toThrow();
    const result = bs({});
    expect(result).toBeDefined();
  });

  it('beforeSend: event.request.headers is null — does not crash', () => {
    const bs = getBeforeSend();
    const event = { request: { headers: null } };
    expect(() => bs(event)).not.toThrow();
  });

  it('beforeSend: extra key denylist matches "password" case-insensitively', () => {
    const bs = getBeforeSend();
    const event = {
      extra: {
        Password: 'plaintext',
        PASSWORD: 'uppercase',
        password: 'lowercase',
        safeValue: 'ok',
      },
    };
    const result = bs(event) as { extra: Record<string, unknown> };
    expect(result.extra['Password']).toBe('[Filtered]');
    expect(result.extra['PASSWORD']).toBe('[Filtered]');
    expect(result.extra['password']).toBe('[Filtered]');
    expect(result.extra['safeValue']).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // captureException: non-Error input types
  // -------------------------------------------------------------------------

  it('captureException forwards a plain string to Sentry (no crash)', () => {
    initSentry('https://x@sentry.io/1', 'production');
    expect(() => captureException('something went wrong')).not.toThrow();
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(mockedCapture.mock.calls[0]?.[0]).toBe('something went wrong');
  });

  it('captureException forwards a number to Sentry (no crash)', () => {
    initSentry('https://x@sentry.io/1', 'production');
    expect(() => captureException(42)).not.toThrow();
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  it('captureException forwards null to Sentry (no crash)', () => {
    initSentry('https://x@sentry.io/1', 'production');
    expect(() => captureException(null)).not.toThrow();
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  it('captureException forwards undefined to Sentry (no crash)', () => {
    initSentry('https://x@sentry.io/1', 'production');
    expect(() => captureException(undefined)).not.toThrow();
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // hashActor: edge inputs
  // -------------------------------------------------------------------------

  it('hashActor: empty string falls back to anonymous (same hash as undefined)', () => {
    // The implementation uses `actorId || 'anonymous'` (falsy check, NOT
    // nullish coalescing). Both `undefined` AND `''` collapse to the
    // 'anonymous' fallback so we don't fingerprint empty-string actors.
    // This was a QA-flagged gap addressed before merge (qa-engineer note
    // 2026-05-11 → sentry.ts hashActor uses `||` not `??`).
    const emptyHash = hashActor('');
    const anonymousHash = hashActor(undefined);
    expect(emptyHash).toHaveLength(8);
    expect(emptyHash).toMatch(/^[0-9a-f]{8}$/);
    expect(emptyHash).toBe(anonymousHash);
  });

  it('hashActor: very long actorId (>1KB) does not crash', () => {
    const longId = 'a'.repeat(2000);
    expect(() => hashActor(longId)).not.toThrow();
    expect(hashActor(longId)).toHaveLength(8);
  });

  // -------------------------------------------------------------------------
  // initSentry: idempotence
  // -------------------------------------------------------------------------

  it('initSentry called twice only initializes once (Sentry.init called exactly 1 time)', () => {
    initSentry('https://x@sentry.io/1', 'production');
    initSentry('https://x@sentry.io/1', 'production');
    expect(mockedInit).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // initSentry: empty-string DSN (falsy string) must be treated as absent
  // -------------------------------------------------------------------------

  it('initSentry with empty string DSN is a no-op (treated as falsy)', () => {
    initSentry('', 'production');
    expect(mockedInit).not.toHaveBeenCalled();
  });
});
