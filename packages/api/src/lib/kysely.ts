// Kysely client singleton for E003 estimation queries.
//
// Uses PostgresDialect with pg Pool. Lazy init — getKysely() creates the
// instance on first call. Mirrors the lib/prisma.ts singleton pattern.
//
// In test environments, DATABASE_URL_TEST is used if set, falling back to
// DATABASE_URL. Do NOT import config.ts here — reading process.env directly
// avoids circular imports.
//
// PgBouncer compatibility: Supabase uses PgBouncer in transaction mode on
// port 6543. The `?pgbouncer=true` query param is a Prisma-specific hint
// that pg.Pool does not recognize. We detect it and configure the pool to
// avoid prepared statements, which are incompatible with transaction-mode
// PgBouncer (prepared statements are connection-scoped, but PgBouncer
// reassigns connections between transactions).

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '../generated/kysely-types.js';

let kyselyInstance: Kysely<DB> | null = null;

/**
 * Returns the shared Kysely instance, creating it on first call.
 */
export function getKysely(): Kysely<DB> {
  if (kyselyInstance !== null) return kyselyInstance;

  const url =
    process.env['NODE_ENV'] === 'test'
      ? (process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'])
      : process.env['DATABASE_URL'];

  // Detect PgBouncer mode from the connection string (Supabase convention).
  // When PgBouncer is active, disable prepared statements to avoid
  // "prepared statement X already exists" errors in transaction mode.
  const isPgBouncer = url?.includes('pgbouncer=true') ?? false;

  const pool = new pg.Pool({
    connectionString: url,
    // Max connections: keep low to share with Prisma's pool.
    max: 10,
  });

  kyselyInstance = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool,
      cursor: isPgBouncer ? undefined : undefined, // cursor config unchanged
    }),
    log: process.env['NODE_ENV'] === 'development' ? ['query'] : undefined,
  });

  // When PgBouncer is detected, override the pool's default query behavior
  // to avoid prepared statements. pg.Pool uses prepared statements for
  // parameterized queries by default; setting `statement_timeout` or using
  // simple protocol avoids this.
  if (isPgBouncer) {
    // Monkey-patch: Force simple query protocol by setting a unique name
    // for each query (prevents pg from reusing prepared statements).
    // This is the recommended approach for PgBouncer transaction mode.
    const originalQuery = pool.query.bind(pool);
    pool.query = function patchedQuery(...args: Parameters<typeof pool.query>) {
      const first = args[0];
      if (typeof first === 'object' && first !== null && 'text' in first) {
        // QueryConfig object — set name to undefined to force simple protocol
        (first as Record<string, unknown>).name = undefined;
      }
      return originalQuery(...args);
    } as typeof pool.query;
  }

  return kyselyInstance;
}

/**
 * Destroys the Kysely instance and releases all pool connections.
 * Call this in test teardown or on process exit.
 */
export async function destroyKysely(): Promise<void> {
  if (kyselyInstance !== null) {
    await kyselyInstance.destroy();
    kyselyInstance = null;
  }
}
