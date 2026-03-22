// F029 writeQueryLog edge-case unit tests — QA Engineer
//
// Covers gaps not in f029.queryLogger.unit.test.ts:
//   1. responseTimeMs=0 is valid (sub-ms requests round to 0)
//   2. log.warn called with 'err' key (not 'error') — pino structured logging
//   3. Non-Error rejection (string throw) is swallowed without crashing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeQueryLog, type QueryLogEntry } from '../lib/queryLogger.js';
import type { PrismaClient } from '@prisma/client';

const mockCreate = vi.fn();

const mockPrisma = {
  queryLog: {
    create: mockCreate,
  },
} as unknown as PrismaClient;

const mockLog = {
  warn: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mockCreate.mockResolvedValue({ id: 'some-id' });
});

describe('writeQueryLog — edge cases', () => {
  // responseTimeMs=0 — valid edge: sub-millisecond requests round to 0
  // The spec says `responseTimeMs` is `int` — 0 is a valid integer.
  it('[SPEC] responseTimeMs=0 is passed as-is (not coerced to null or undefined)', async () => {
    const entry: QueryLogEntry = {
      queryText: 'super fast query',
      chainSlug: null,
      restaurantId: null,
      levelHit: 'l1',
      cacheHit: true,
      responseTimeMs: 0,
      apiKeyId: null,
      source: 'api',
    };

    await writeQueryLog(mockPrisma, entry, mockLog);

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]?.[0] as { data: { responseTimeMs: number } };
    expect(callArg.data.responseTimeMs).toBe(0);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  // Pino structured logging requires { err } key (not { error } or { e })
  // for the serializer to attach the stack trace automatically.
  it('[SPEC] log.warn called with {err: <Error>} key — pino structured logging', async () => {
    const dbErr = new Error('Connection timeout');
    mockCreate.mockRejectedValue(dbErr);

    await writeQueryLog(mockPrisma, {
      queryText: 'test',
      chainSlug: null,
      restaurantId: null,
      levelHit: null,
      cacheHit: false,
      responseTimeMs: 5,
      apiKeyId: null,
      source: 'api',
    }, mockLog);

    expect(mockLog.warn).toHaveBeenCalledOnce();
    const [firstArg, msgArg] = mockLog.warn.mock.calls[0] as [Record<string, unknown>, string];

    // Must be 'err', not 'error' — pino's built-in serializer is keyed on 'err'
    expect(Object.keys(firstArg)).toContain('err');
    expect(Object.keys(firstArg)).not.toContain('error');
    expect(firstArg['err']).toBe(dbErr);
    expect(msgArg).toBe('query log write failed');
  });

  // Non-Error rejection (e.g. a rejected string, number, plain object)
  // The try/catch catches anything throwable. The warn should still be called
  // with whatever was thrown under the 'err' key.
  it('[EDGE] non-Error rejection (string throw) is swallowed — resolves to undefined', async () => {
    mockCreate.mockRejectedValue('raw string error');

    const result = await writeQueryLog(mockPrisma, {
      queryText: 'test',
      chainSlug: null,
      restaurantId: null,
      levelHit: null,
      cacheHit: false,
      responseTimeMs: 10,
      apiKeyId: null,
      source: 'api',
    }, mockLog);

    expect(result).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledOnce();
    const [warnArg] = mockLog.warn.mock.calls[0] as [Record<string, unknown>];
    expect(warnArg['err']).toBe('raw string error');
  });

  it('[EDGE] null rejection is swallowed — resolves to undefined', async () => {
    mockCreate.mockRejectedValue(null);

    await expect(writeQueryLog(mockPrisma, {
      queryText: 'test',
      chainSlug: null,
      restaurantId: null,
      levelHit: null,
      cacheHit: false,
      responseTimeMs: 3,
      apiKeyId: null,
      source: 'bot',
    }, mockLog)).resolves.toBeUndefined();

    expect(mockLog.warn).toHaveBeenCalledOnce();
  });

  // Verify that on success, warn is never called regardless of entry shape
  it('[SPEC] successful write never calls warn — regardless of nullable fields', async () => {
    const entries: QueryLogEntry[] = [
      // All non-null
      { queryText: 'big mac', chainSlug: 'mc', restaurantId: 'uuid', levelHit: 'l1', cacheHit: true, responseTimeMs: 50, apiKeyId: 'key-uuid', source: 'bot' },
      // All nullable fields as null
      { queryText: 'x', chainSlug: null, restaurantId: null, levelHit: null, cacheHit: false, responseTimeMs: 1, apiKeyId: null, source: 'api' },
    ];

    for (const entry of entries) {
      vi.resetAllMocks();
      mockCreate.mockResolvedValue({ id: 'id' });
      await writeQueryLog(mockPrisma, entry, mockLog);
      expect(mockLog.warn).not.toHaveBeenCalled();
    }
  });
});
