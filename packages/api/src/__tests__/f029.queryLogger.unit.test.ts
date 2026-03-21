// Unit tests for writeQueryLog helper (F029)
//
// Tests: happy path create call, error swallowing, field passthrough

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeQueryLog, type QueryLogEntry } from '../lib/queryLogger.js';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

const mockPrisma = {
  queryLog: {
    create: mockCreate,
  },
} as unknown as PrismaClient;

const mockLog = {
  warn: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE_ENTRY: QueryLogEntry = {
  queryText:     'big mac',
  chainSlug:     'mcdonalds-es',
  restaurantId:  'fd000000-0029-4000-a000-000000000001',
  levelHit:      'l1',
  cacheHit:      false,
  responseTimeMs: 42,
  apiKeyId:      'fd000000-0029-4000-a000-000000000002',
  source:        'api',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeQueryLog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreate.mockResolvedValue({ id: 'some-id' });
  });

  it('calls prisma.queryLog.create with correct fields', async () => {
    await writeQueryLog(mockPrisma, BASE_ENTRY, mockLog);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        queryText:     'big mac',
        chainSlug:     'mcdonalds-es',
        restaurantId:  'fd000000-0029-4000-a000-000000000001',
        levelHit:      'l1',
        cacheHit:      false,
        responseTimeMs: 42,
        apiKeyId:      'fd000000-0029-4000-a000-000000000002',
        source:        'api',
      },
    });
  });

  it('passes null values as-is for nullable fields', async () => {
    const entry: QueryLogEntry = {
      queryText:      'unknown dish',
      chainSlug:      null,
      restaurantId:   null,
      levelHit:       null,
      cacheHit:       false,
      responseTimeMs: 10,
      apiKeyId:       null,
      source:         'api',
    };

    await writeQueryLog(mockPrisma, entry, mockLog);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        queryText:      'unknown dish',
        chainSlug:      null,
        restaurantId:   null,
        levelHit:       null,
        cacheHit:       false,
        responseTimeMs: 10,
        apiKeyId:       null,
        source:         'api',
      },
    });
  });

  it('levelHit string (l1|l2|l3|l4|null) is passed as-is — no mapping inside logger', async () => {
    for (const level of ['l1', 'l2', 'l3', 'l4', null] as const) {
      vi.resetAllMocks();
      mockCreate.mockResolvedValue({ id: 'id' });

      await writeQueryLog(mockPrisma, { ...BASE_ENTRY, levelHit: level }, mockLog);

      const callArg = mockCreate.mock.calls[0]?.[0] as { data: { levelHit: unknown } };
      expect(callArg.data.levelHit).toBe(level);
    }
  });

  it('source string (api|bot) is passed as-is — no mapping inside logger', async () => {
    for (const source of ['api', 'bot'] as const) {
      vi.resetAllMocks();
      mockCreate.mockResolvedValue({ id: 'id' });

      await writeQueryLog(mockPrisma, { ...BASE_ENTRY, source }, mockLog);

      const callArg = mockCreate.mock.calls[0]?.[0] as { data: { source: unknown } };
      expect(callArg.data.source).toBe(source);
    }
  });

  it('swallows errors — does not throw when prisma.queryLog.create throws', async () => {
    mockCreate.mockRejectedValue(new Error('DB connection lost'));

    // Must not throw
    await expect(writeQueryLog(mockPrisma, BASE_ENTRY, mockLog)).resolves.toBeUndefined();
  });

  it('calls log.warn with err and message when create throws', async () => {
    const dbErr = new Error('DB connection lost');
    mockCreate.mockRejectedValue(dbErr);

    await writeQueryLog(mockPrisma, BASE_ENTRY, mockLog);

    expect(mockLog.warn).toHaveBeenCalledOnce();
    expect(mockLog.warn).toHaveBeenCalledWith(
      { err: dbErr },
      'query log write failed',
    );
  });

  it('does not call log.warn on success', async () => {
    await writeQueryLog(mockPrisma, BASE_ENTRY, mockLog);

    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('returns undefined on both success and failure', async () => {
    const successResult = await writeQueryLog(mockPrisma, BASE_ENTRY, mockLog);
    expect(successResult).toBeUndefined();

    mockCreate.mockRejectedValue(new Error('fail'));
    const failResult = await writeQueryLog(mockPrisma, BASE_ENTRY, mockLog);
    expect(failResult).toBeUndefined();
  });
});
