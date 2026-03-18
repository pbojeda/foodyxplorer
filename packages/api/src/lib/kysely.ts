// Kysely client singleton for E003 estimation queries.
//
// Uses PostgresDialect with pg Pool. Lazy init — getKysely() creates the
// instance on first call. Mirrors the lib/prisma.ts singleton pattern.
//
// In test environments, DATABASE_URL_TEST is used if set, falling back to
// DATABASE_URL. Do NOT import config.ts here — reading process.env directly
// avoids circular imports.

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

  const pool = new pg.Pool({ connectionString: url });

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
