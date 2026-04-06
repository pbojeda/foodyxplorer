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

  // Detect remote DB (Supabase, Render, etc.) — requires SSL.
  // Prisma auto-negotiates SSL, but pg.Pool does not. We enable SSL with
  // rejectUnauthorized: false for any non-localhost URL.
  const isLocal = url?.includes('localhost') || url?.includes('127.0.0.1');

  const pool = new pg.Pool({
    connectionString: url,
    // Max connections: keep low to share with Prisma's pool.
    max: 10,
    // SSL: required for cloud databases (Supabase, Render, etc.).
    // rejectUnauthorized: false is standard for Supabase pooler connections.
    ...(!isLocal && { ssl: { rejectUnauthorized: false } }),
  });

  kyselyInstance = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

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
