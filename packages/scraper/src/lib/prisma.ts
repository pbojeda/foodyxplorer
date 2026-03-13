// PrismaClient singleton for the scraper process.
//
// Uses a lazy-init getter to avoid creating the client until it is first needed.
// In test environments, DATABASE_URL_TEST is used if set, falling back to
// DATABASE_URL. Reads process.env directly to avoid circular imports with config.ts.

import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | undefined;

/**
 * Returns the singleton PrismaClient for the scraper process.
 * The client is created on first call and reused for subsequent calls.
 */
export function getPrismaClient(): PrismaClient {
  if (prismaInstance === undefined) {
    const url =
      process.env['NODE_ENV'] === 'test'
        ? (process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'])
        : process.env['DATABASE_URL'];

    prismaInstance = new PrismaClient({
      datasources: {
        db: { url },
      },
    });
  }
  return prismaInstance;
}
