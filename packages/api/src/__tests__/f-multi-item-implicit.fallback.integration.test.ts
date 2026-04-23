// F-MULTI-ITEM-IMPLICIT — AC14 error-fallback integration test (separate file).
//
// This file is a dedicated test for the try/catch fallback in conversationCore.ts Step 3.6.
// It MUST be a separate file because vi.mock('../conversation/implicitMultiItemDetector.js')
// must appear BEFORE the import of processMessage (ESM binding resolved at module load time).
// Mixing this with f-multi-item-implicit.integration.test.ts (which does NOT mock the detector)
// would be unreliable. Pattern mirrors f076.menuAggregation.unit.test.ts:44 and
// f-nlp-chain.conversationCore.integration.test.ts:34-48.
//
// ADR-021: Integration tests MUST call processMessage(), not helpers directly.

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock implicitMultiItemDetector — MUST appear BEFORE processMessage import
// Vitest hoists vi.mock calls to before all imports.
// ---------------------------------------------------------------------------

vi.mock('../conversation/implicitMultiItemDetector.js', () => ({
  detectImplicitMultiItem: vi.fn().mockImplementation(() =>
    Promise.reject(new Error('simulated detector failure')),
  ),
}));

// ---------------------------------------------------------------------------
// Same 3 module mocks as the main integration file
// ---------------------------------------------------------------------------

const { mockCascadeFallback } = vi.hoisted(() => ({
  mockCascadeFallback: vi.fn(),
}));

vi.mock('../conversation/contextManager.js', () => ({
  getContext: vi.fn().mockResolvedValue(null),
  setContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/cache.js', () => ({
  buildKey: (_entity: string, id: string) => `fxp:estimate:${id}`,
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockCascadeFallback,
}));

// ---------------------------------------------------------------------------
// Imports — AFTER all vi.mock declarations
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../generated/kysely-types.js';
import type { ConversationRequest } from '../conversation/types.js';
import { processMessage } from '../conversation/conversationCore.js';

// ---------------------------------------------------------------------------
// DB clients (real DB needed so processMessage() can run through Step 4)
// ---------------------------------------------------------------------------

const DATABASE_URL_TEST =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test';

const pool = new Pool({ connectionString: DATABASE_URL_TEST });
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_TEST } } });

// mockCascade: returns null result for all queries in this fallback test
mockCascadeFallback.mockResolvedValue({
  levelHit: null,
  data: {
    query: 'paella y vino',
    chainSlug: null,
    level1Hit: false,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: null,
    result: null,
    cachedAt: null,
  },
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildRequest(text: string): ConversationRequest {
  return {
    text,
    actorId: 'fb000000-00fb-4000-a000-000000000098',
    db,
    redis: {} as ConversationRequest['redis'],
    prisma,
    chainSlugs: [],
    chains: [],
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F-MULTI-ITEM-IMPLICIT — AC14 error-fallback (vi.mock-before-import)', () => {

  it('AC14 — detector throws → catch logs F-MULTI-ITEM-IMPLICIT:fallback-fired, falls through to estimation', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const result = await processMessage(buildRequest('paella y vino'));

    // Should NOT throw — try/catch in Step 3.6 swallows the error and continues to Step 4
    // Intent must be estimation (not menu_estimation) because the detector threw and was bypassed
    expect(result.intent).toBe('estimation');

    // logger.error MUST have been called with the stable tag F-MULTI-ITEM-IMPLICIT:fallback-fired
    const errorCalls = logger.error.mock.calls as unknown[][];
    // Note: the logger passed to processMessage is the one in buildRequest above.
    // We need to rebuild the request with our custom logger to capture the call.
    // The request-level logger is checked via a fresh invocation.
    const result2 = await processMessage({ ...buildRequest('paella y vino'), logger });
    expect(result2.intent).toBe('estimation');

    const hasFallbackTag = errorCalls.some((args) =>
      JSON.stringify(args).includes('F-MULTI-ITEM-IMPLICIT:fallback-fired'),
    );
    expect(hasFallbackTag).toBe(true);
  });

  it('AC14b — throw path does not propagate as 500 — intent is estimation not menu_estimation', async () => {
    // Verify the entire processMessage() call completes without throwing
    await expect(processMessage(buildRequest('paella y vino'))).resolves.not.toThrow();

    const result = await processMessage(buildRequest('paella y vino'));
    expect(result.intent).not.toBe('menu_estimation');
    expect(result.intent).toBe('estimation');
  });

});

// Cleanup
// Note: afterAll pool.end is important to avoid open handle warnings
import { afterAll } from 'vitest';
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});
