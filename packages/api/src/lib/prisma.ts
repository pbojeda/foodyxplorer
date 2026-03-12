// PrismaClient singleton for route handlers.
//
// In test environments, DATABASE_URL_TEST is used if set, falling back to
// DATABASE_URL. This matches the pattern in existing integration test files.
//
// Do NOT import from config.ts here — reading process.env directly avoids
// circular imports and allows this file to be imported before config is parsed.

import { PrismaClient } from '@prisma/client';

const url =
  process.env['NODE_ENV'] === 'test'
    ? (process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'])
    : process.env['DATABASE_URL'];

export const prisma = new PrismaClient({
  datasources: {
    db: { url },
  },
});
