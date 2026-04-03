// queryLogger.ts — Fire-and-forget query log writer (F029)
//
// writeQueryLog wraps prisma.queryLog.create in a try/catch.
// On error: logs at warn level, never re-throws.
// Returns undefined on both success and failure.
//
// The explicit `log` parameter keeps this helper fully unit-testable
// without a full Fastify instance. Pass request.log from the route handler.

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Minimal logger interface (subset of Fastify's request.log)
// ---------------------------------------------------------------------------

interface MinimalLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

// ---------------------------------------------------------------------------
// QueryLogEntry
// ---------------------------------------------------------------------------

export interface QueryLogEntry {
  queryText:      string;
  chainSlug:      string | null;
  restaurantId:   string | null;
  levelHit:       'l1' | 'l2' | 'l3' | 'l4' | null;
  cacheHit:       boolean;
  responseTimeMs: number;
  apiKeyId:       string | null;
  actorId:        string | null;
  source:         'api' | 'bot';
}

// ---------------------------------------------------------------------------
// writeQueryLog
// ---------------------------------------------------------------------------

export async function writeQueryLog(
  prisma: PrismaClient,
  entry: QueryLogEntry,
  log: MinimalLogger,
): Promise<void> {
  try {
    await prisma.queryLog.create({ data: entry });
  } catch (err) {
    log.warn({ err }, 'query log write failed');
  }
}
