// Embedding writer — writes 1536-dim vectors into the pgvector columns.
//
// Uses $executeRawUnsafe (not Prisma.sql) because the ::vector cast and the
// vector literal [n1,...,n1536] must be constructed dynamically.
// This is consistent with the F003 precedent in migration.f003.integration.test.ts.

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the PostgreSQL vector literal string: [0.01,0.02,...,0.99]
 */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

// ---------------------------------------------------------------------------
// writeFoodEmbedding
// ---------------------------------------------------------------------------

/**
 * Write an embedding vector for a Food row and update embedding_updated_at.
 *
 * @param prisma - PrismaClient instance
 * @param id    - UUID of the food row
 * @param vector - 1536-dimension embedding vector
 */
export async function writeFoodEmbedding(
  prisma: PrismaClient,
  id: string,
  vector: number[],
): Promise<void> {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`writeFoodEmbedding: invalid UUID "${id}"`);
  }
  const vectorLiteral = toVectorLiteral(vector);
  await prisma.$executeRawUnsafe(
    `UPDATE foods
     SET embedding = '${vectorLiteral}'::vector,
         embedding_updated_at = NOW()
     WHERE id = '${id}'::uuid`,
  );
}

// ---------------------------------------------------------------------------
// writeDishEmbedding
// ---------------------------------------------------------------------------

/**
 * Write an embedding vector for a Dish row and update embedding_updated_at.
 *
 * @param prisma - PrismaClient instance
 * @param id    - UUID of the dish row
 * @param vector - 1536-dimension embedding vector
 */
export async function writeDishEmbedding(
  prisma: PrismaClient,
  id: string,
  vector: number[],
): Promise<void> {
  if (!UUID_REGEX.test(id)) {
    throw new Error(`writeDishEmbedding: invalid UUID "${id}"`);
  }
  const vectorLiteral = toVectorLiteral(vector);
  await prisma.$executeRawUnsafe(
    `UPDATE dishes
     SET embedding = '${vectorLiteral}'::vector,
         embedding_updated_at = NOW()
     WHERE id = '${id}'::uuid`,
  );
}
