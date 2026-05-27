// lib/searchHistory.ts — Search history repository helpers (F-WEB-HISTORY)
//
// Functions:
//   resolveAccountIdFromSub  — looks up accounts.id from auth_user_id (JWT sub).
//                              Returns null ONLY for 0-rows (no account row yet).
//                              THROWS on DB error (cross-model X3 — no fail-open on read paths).
//   insertSearchHistory      — inserts a new search_history row.
//   listHistory              — keyset cursor pagination (created_at DESC, id DESC).
//   deleteHistoryEntry       — deletes one row owned by accountId; returns bool.
//   clearHistory             — deletes all rows for accountId.
//   pruneHistory             — 500-row cap + 12-month age prune (fire-and-forget callers).
//
// Cursor encoding:
//   Opaque base64url of "<created_at_iso>|<uuid>". Decode + validate in decodeCursor().
//   Encode in encodeCursor(). INVALID_CURSOR error code for malformed cursors.
//
// All DB calls use prisma.$queryRaw / prisma.$executeRaw (raw SQL) for:
//   - The keyset WHERE clause (unsupported by Prisma model methods)
//   - Enum casting (::search_history_kind) — Prisma would not auto-cast
//   - Bulk DELETE (pruneHistory) — cleaner in raw SQL

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// UUID regex — reuse the same pattern as bearerActor.ts
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// RawHistoryRow — local type for raw DB rows from listHistory
// ---------------------------------------------------------------------------

export interface RawHistoryRow {
  id: string;
  kind: string;
  query_text: string;
  result_jsonb: unknown;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Cursor encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encodes a (created_at, id) pair as an opaque base64url cursor string.
 * Format: base64url("<created_at_iso>|<uuid>")
 */
export function encodeCursor(row: { created_at: Date; id: string }): string {
  const raw = `${row.created_at.toISOString()}|${row.id}`;
  return Buffer.from(raw).toString('base64url');
}

/**
 * Decodes and validates an opaque cursor string.
 * Returns { cursorTs: string, cursorId: string } on success.
 * Throws Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' }) on failure.
 */
export function decodeCursor(cursor: string): { cursorTs: string; cursorId: string } {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' });
  }

  const parts = raw.split('|');
  if (parts.length !== 2) {
    throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' });
  }

  const [ts, id] = parts as [string, string];

  // Validate ISO date
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' });
  }

  // Validate UUID
  if (!UUID_RE.test(id)) {
    throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' });
  }

  return { cursorTs: ts, cursorId: id };
}

// ---------------------------------------------------------------------------
// resolveAccountIdFromSub
// ---------------------------------------------------------------------------

/**
 * Resolves accounts.id from a JWT sub (= auth_user_id).
 *
 * Returns null ONLY when SELECT returns 0 rows (account not yet provisioned by /me).
 * THROWS on DB error — callers on the request-serving path must let this propagate
 * to the global error handler (500). Only fire-and-forget hooks wrap this in try/catch.
 * (Cross-model X3: masking a DB outage as "no account" is wrong for read/delete paths.)
 */
export async function resolveAccountIdFromSub(
  prisma: PrismaClient,
  sub: string,
  logger: FastifyBaseLogger,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM accounts WHERE auth_user_id = ${sub}::uuid LIMIT 1
  `;
  // DB error propagates (throws) — this function does NOT catch.

  if (rows.length === 0) {
    logger.debug({ sub }, 'resolveAccountIdFromSub: no accounts row for sub (not yet provisioned)');
    return null;
  }

  return rows[0]?.['id'] ?? null;
}

// ---------------------------------------------------------------------------
// insertSearchHistory
// ---------------------------------------------------------------------------

/**
 * Inserts a new search_history row. Returns void (callers are fire-and-forget).
 */
export async function insertSearchHistory(
  prisma: PrismaClient,
  params: {
    accountId: string;
    kind: 'text' | 'voice';
    queryText: string;
    resultJsonb: object;
  },
): Promise<void> {
  const { accountId, kind, queryText, resultJsonb } = params;
  const resultJson = JSON.stringify(resultJsonb);
  await prisma.$executeRaw`
    INSERT INTO search_history (account_id, kind, query_text, result_jsonb)
    VALUES (
      ${accountId}::uuid,
      ${kind}::search_history_kind,
      ${queryText},
      ${resultJson}::jsonb
    )
  `;
}

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

/**
 * Fetches search_history rows for an account, newest-first, with keyset cursor pagination.
 *
 * Fetches `limit + 1` rows to detect whether a next page exists.
 * Returns { rows, hasMore } where rows is sliced to `limit`.
 */
export async function listHistory(
  prisma: PrismaClient,
  accountId: string,
  cursor: string | null,
  limit: number,
): Promise<{ rows: RawHistoryRow[]; hasMore: boolean }> {
  const fetchLimit = limit + 1;

  let rows: RawHistoryRow[];

  if (cursor !== null) {
    const { cursorTs, cursorId } = decodeCursor(cursor);

    rows = await prisma.$queryRaw<RawHistoryRow[]>`
      SELECT id, kind, query_text, result_jsonb, created_at
      FROM search_history
      WHERE account_id = ${accountId}::uuid
        AND (created_at, id) < (${cursorTs}::timestamptz, ${cursorId}::uuid)
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `;
  } else {
    rows = await prisma.$queryRaw<RawHistoryRow[]>`
      SELECT id, kind, query_text, result_jsonb, created_at
      FROM search_history
      WHERE account_id = ${accountId}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `;
  }

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows = rows.slice(0, limit);
  }

  return { rows, hasMore };
}

// ---------------------------------------------------------------------------
// deleteHistoryEntry
// ---------------------------------------------------------------------------

/**
 * Deletes a single search_history row owned by accountId.
 * Returns true if 1 row was deleted, false if 0 (not found or not owned).
 * The route converts false → 404 (no-enumeration: "not found" covers both cases).
 */
export async function deleteHistoryEntry(
  prisma: PrismaClient,
  accountId: string,
  id: string,
): Promise<boolean> {
  const result = await prisma.$executeRaw`
    DELETE FROM search_history
    WHERE id = ${id}::uuid AND account_id = ${accountId}::uuid
  `;
  // $executeRaw returns the affected row count as bigint
  return Number(result) === 1;
}

// ---------------------------------------------------------------------------
// clearHistory
// ---------------------------------------------------------------------------

/**
 * Deletes ALL search_history rows for the given accountId.
 */
export async function clearHistory(prisma: PrismaClient, accountId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM search_history WHERE account_id = ${accountId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// pruneHistory
// ---------------------------------------------------------------------------

/**
 * Best-effort retention prune after insert (fork D4):
 *   1. 500-row cap: keep newest 500, delete the rest.
 *   2. 12-month age: delete rows older than 12 months.
 *
 * Both DELETEs are fire-and-forget (callers wrap in void .catch(log.error)).
 * Errors logged and swallowed inside this function too.
 */
export async function pruneHistory(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  // Prune 1: 500-row cap
  await prisma.$executeRaw`
    DELETE FROM search_history
    WHERE account_id = ${accountId}::uuid
      AND id NOT IN (
        SELECT id FROM search_history
        WHERE account_id = ${accountId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 500
      )
  `;

  // Prune 2: 12-month age
  await prisma.$executeRaw`
    DELETE FROM search_history
    WHERE account_id = ${accountId}::uuid
      AND created_at < NOW() - INTERVAL '12 months'
  `;
}
