// Unit tests for lib/sentry.ts (F030-lite)
//
// 8 runtime cases + 1 compile-time `@ts-expect-error` case = 9 total per AC6.
// F107a-FU2: adds 3 new tests (AC8b) for captureMessage wrapper + 4 new
// SentryContext fields (collisionActorIdHash, victimAccountIdHash,
// hijackerAccountIdHash, externalIdHash).
//
// The wrapper imports @sentry/node lazily inside its functions — we mock the
// SDK via vi.mock so we can assert init/captureException were called (or not).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock scope for withScope callback
const mockScope = {
  setExtras: vi.fn(),
  setTags: vi.fn(),
};

// Mock @sentry/node BEFORE importing the wrapper so the wrapper resolves
// to the mocked module.
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
  withScope: vi.fn((cb: (scope: typeof mockScope) => void) => cb(mockScope)),
}));

import * as Sentry from '@sentry/node';
import {
  initSentry,
  captureException,
  captureMessage,
  hashActor,
  __resetForTests,
  type SentryContext,
} from '../../lib/sentry.js';

const mockedInit = Sentry.init as ReturnType<typeof vi.fn>;
const mockedCapture = Sentry.captureException as ReturnType<typeof vi.fn>;
const mockedCaptureMessage = Sentry.captureMessage as ReturnType<typeof vi.fn>;
const mockedWithScope = Sentry.withScope as ReturnType<typeof vi.fn>;

describe('lib/sentry', () => {
  beforeEach(() => {
    mockedInit.mockClear();
    mockedCapture.mockClear();
    mockedCaptureMessage.mockClear();
    mockedWithScope.mockClear();
    mockScope.setExtras.mockClear();
    mockScope.setTags.mockClear();
    __resetForTests();
  });

  // ---------------------------------------------------------------------------
  // initSentry — no-op paths
  // ---------------------------------------------------------------------------

  it('1. initSentry(undefined, "production") is a no-op (no DSN)', () => {
    initSentry(undefined, 'production');
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('3. initSentry("https://x@sentry.io/1", "test") is a no-op (test env)', () => {
    initSentry('https://x@sentry.io/1', 'test');
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('4. initSentry("https://x@sentry.io/1", "development") is a no-op (dev env)', () => {
    initSentry('https://x@sentry.io/1', 'development');
    expect(mockedInit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // initSentry — happy path
  // ---------------------------------------------------------------------------

  it('2. initSentry("https://x@sentry.io/1", "production") calls Sentry.init with correct config', () => {
    initSentry('https://x@sentry.io/1', 'production');
    expect(mockedInit).toHaveBeenCalledTimes(1);
    const cfg = mockedInit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cfg.dsn).toBe('https://x@sentry.io/1');
    expect(cfg.environment).toBe('production');
    expect(cfg.tracesSampleRate).toBe(0);
    expect(cfg.profilesSampleRate).toBe(0);
    expect(cfg.sendDefaultPii).toBe(false);
    expect(typeof cfg.beforeSend).toBe('function');
  });

  // ---------------------------------------------------------------------------
  // captureException — no-op + forward paths
  // ---------------------------------------------------------------------------

  it('5. captureException(err) is a no-op when not initialized', () => {
    captureException(new Error('test'));
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('6. captureException(err, ctx) forwards to Sentry.captureException when initialized', () => {
    initSentry('https://x@sentry.io/1', 'production');
    const err = new Error('boom');
    const ctx: SentryContext = {
      route: '/test',
      method: 'GET',
      requestId: 'req-1',
      statusCode: 500,
      internalCode: 'INTERNAL_ERROR',
      actorIdHash: 'abc12345',
    };
    captureException(err, ctx);
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    const [forwardedErr, options] = mockedCapture.mock.calls[0] ?? [];
    expect(forwardedErr).toBe(err);
    expect((options as { extra?: SentryContext }).extra).toEqual(ctx);
  });

  // ---------------------------------------------------------------------------
  // beforeSend — PII scrubber
  // ---------------------------------------------------------------------------

  it('7. beforeSend strips Authorization / Cookie / x-api-key headers', () => {
    initSentry('https://x@sentry.io/1', 'production');
    const cfg = mockedInit.mock.calls[0]?.[0] as { beforeSend: (e: unknown) => unknown };
    const event = {
      request: {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'session=abc',
          'x-api-key': 'k-12345',
          'user-agent': 'test',
        },
      },
    };
    const scrubbed = cfg.beforeSend(event) as typeof event;
    expect(scrubbed.request.headers.authorization).toBeUndefined();
    expect(scrubbed.request.headers.cookie).toBeUndefined();
    expect(scrubbed.request.headers['x-api-key']).toBeUndefined();
    expect(scrubbed.request.headers['user-agent']).toBe('test');
  });

  it('8. beforeSend strips request body + query_string + ip address + denylist extras', () => {
    initSentry('https://x@sentry.io/1', 'production');
    const cfg = mockedInit.mock.calls[0]?.[0] as { beforeSend: (e: unknown) => unknown };
    const event = {
      request: {
        data: { message: 'plate of paella with secret recipe' },
        query_string: 'token=abc&q=paella',
      },
      user: { ip_address: '1.2.3.4', id: 'user-1' },
      extra: {
        route: '/test',
        api_key: 'k-12345',
        Password: 'plain-text',
        safeField: 42,
      },
    };
    const scrubbed = cfg.beforeSend(event) as typeof event;
    expect(scrubbed.request.data).toBe('[Filtered]');
    expect(scrubbed.request.query_string).toBe('[Filtered]');
    expect(scrubbed.user.ip_address).toBe('[Filtered]');
    expect(scrubbed.user.id).toBe('user-1'); // not scrubbed
    expect(scrubbed.extra.api_key).toBe('[Filtered]');
    expect(scrubbed.extra.Password).toBe('[Filtered]');
    expect(scrubbed.extra.route).toBe('/test'); // allowlisted
    expect(scrubbed.extra.safeField).toBe(42);
  });

  // ---------------------------------------------------------------------------
  // SentryContext — compile-time allowlist
  // ---------------------------------------------------------------------------

  it('9. SentryContext rejects non-allowlisted fields at compile time', () => {
    // Runtime: empty body; the assertion is at compile time.
    const okCtx: SentryContext = { route: '/x', method: 'GET' };
    expect(okCtx.route).toBe('/x');

    // F107a-FU2: new hash fields are now allowlisted.
    const collisionCtx: SentryContext = {
      collisionActorIdHash: 'abcd1234',
      victimAccountIdHash: 'dead5678',
      hijackerAccountIdHash: 'cafe9abc',
      externalIdHash: 'f00d0001',
    };
    expect(collisionCtx.collisionActorIdHash).toBe('abcd1234');

    // @ts-expect-error — `body` is not an allowlisted SentryContext field.
    const badCtx: SentryContext = { body: 'leak' };
    // Runtime: use the variable so eslint doesn't drop it; compile-time is what matters.
    expect(badCtx).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // captureMessage — AC8b (F107a-FU2)
  // ---------------------------------------------------------------------------

  it('10. captureMessage is a no-op when not initialized', () => {
    // Not calling initSentry — Sentry is uninitialized.
    captureMessage('test msg', 'warning');
    expect(mockedWithScope).not.toHaveBeenCalled();
    expect(mockedCaptureMessage).not.toHaveBeenCalled();
  });

  it('11. captureMessage calls withScope, setExtras, setTags, and Sentry.captureMessage when initialized', () => {
    initSentry('https://x@sentry.io/1', 'production');
    const ctx: SentryContext = {
      collisionActorIdHash: 'abcd1234',
      victimAccountIdHash: 'dead5678',
      hijackerAccountIdHash: 'cafe9abc',
      externalIdHash: 'f00d0001',
    };
    const tags = { feature: 'F107a-FU2', event_type: 'actor_link_collision' };
    captureMessage('actor_link_collision: test', 'warning', ctx, tags);
    expect(mockedWithScope).toHaveBeenCalledTimes(1);
    expect(mockScope.setExtras).toHaveBeenCalledWith(ctx);
    expect(mockScope.setTags).toHaveBeenCalledWith(tags);
    expect(mockedCaptureMessage).toHaveBeenCalledWith('actor_link_collision: test', 'warning');
  });

  it('12. captureMessage with no context/tags: withScope still called, setExtras and setTags skipped', () => {
    initSentry('https://x@sentry.io/1', 'production');
    captureMessage('bare msg', 'info');
    expect(mockedWithScope).toHaveBeenCalledTimes(1);
    expect(mockScope.setExtras).not.toHaveBeenCalled();
    expect(mockScope.setTags).not.toHaveBeenCalled();
    expect(mockedCaptureMessage).toHaveBeenCalledWith('bare msg', 'info');
  });

  // ---------------------------------------------------------------------------
  // hashActor — bonus coverage
  // ---------------------------------------------------------------------------

  it('hashActor returns 8 hex chars and is deterministic', () => {
    const a = hashActor('user-123');
    const b = hashActor('user-123');
    const c = hashActor('user-456');
    expect(a).toHaveLength(8);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // anonymous fallback
    expect(hashActor(undefined)).toHaveLength(8);
  });
});
