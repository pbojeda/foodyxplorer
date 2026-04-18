// F114 — Integration tests for embedding-based semantic routing
//
// Two tiers of tests:
//
//   Tier A — STRUCTURAL checks (require `ENABLE_EMBEDDING_INTEGRATION_TESTS=true`):
//     A1: Chuletón de buey (...fb) has a non-null embedding.
//     A2: Entrecot de ternera (...069) aliases no longer contain "chuletón" (F114 data cleanup).
//     A3: Arroz negro (...084) and Arroz blanco (...0e5) both have non-null embeddings.
//     A4: Arroz blanco (...0e5) aliases contain all 4 expected values (after F114 modification).
//
//   Tier B — TRUE ROUTING checks (additionally require `OPENAI_API_KEY`):
//     B1: Embedding search for "una ración de chuletón" returns Chuletón de buey (...fb) as
//         the top match, with rank(entrecot) > rank(chuletón).
//     B2: Embedding search for "arroz negro" returns Arroz negro (...084) as the top match,
//         NOT generic Arroz blanco (...0e5).
//
// Tier B fulfils AC7's "mandatory routing assertion" by embedding the query at test time
// via the same `callOpenAIEmbeddings` client used by the pipeline, then running pgvector
// cosine nearest-neighbor against `dishes.embedding`.
//
// PREREQUISITES for both tiers:
//   DATABASE_URL=<test_db_url> npm run seed -w @foodxplorer/api
//   DATABASE_URL=<test_db_url> OPENAI_API_KEY=<key> npm run embeddings:generate -w @foodxplorer/api
//
// Gating (documented in CONTRIBUTING.md "Integration tests — embedding routing"):
//   Tier A runs when:  ENABLE_EMBEDDING_INTEGRATION_TESTS=true
//   Tier B runs when:  ENABLE_EMBEDDING_INTEGRATION_TESTS=true AND OPENAI_API_KEY is set

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { callOpenAIEmbeddings } from '../embeddings/embeddingClient.js';

// ---------------------------------------------------------------------------
// Dish IDs under test
// ---------------------------------------------------------------------------

const CHULETON_ID   = '00000000-0000-e073-0007-0000000000fb'; // F114 new: Chuletón de buey
const ENTRECOT_ID   = '00000000-0000-e073-0007-000000000069'; // Entrecot de ternera (should NOT rank #1 for "chuletón")
const ARROZ_NEGRO_ID = '00000000-0000-e073-0007-000000000084'; // Existing: Arroz negro
const ARROZ_BLANCO_ID = '00000000-0000-e073-0007-0000000000e5'; // Modified: Arroz blanco (should NOT absorb "arroz negro")

// ---------------------------------------------------------------------------
// Infrastructure availability check
// ---------------------------------------------------------------------------

const INFRA_READY = process.env['ENABLE_EMBEDDING_INTEGRATION_TESTS'] === 'true';
const OPENAI_READY = INFRA_READY && typeof process.env['OPENAI_API_KEY'] === 'string' && process.env['OPENAI_API_KEY'].length > 0;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: PrismaClient;

beforeAll(() => {
  if (!INFRA_READY) return;
  prisma = new PrismaClient({
    datasources: {
      db: { url: process.env['DATABASE_URL'] },
    },
  });
});

afterAll(async () => {
  if (!INFRA_READY) return;
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helper: cosine similarity search via pgvector
// Returns top N dish IDs by similarity to the given text embedding.
// NOTE: This does NOT call OpenAI at test time — it queries an embedding
// that was pre-computed and stored in the dishes table.
// For a proper embedding routing test we would need to embed the query
// string at test time. Until embedding infrastructure is available in CI,
// we skip these tests and rely on the manual smoke test procedure in F114 §6.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F114-I1: "chuletón" embedding search → Chuletón de buey, NOT Entrecot
// ---------------------------------------------------------------------------

describe('F114-I1 Tier A (structural): Chuletón dish + Entrecot alias cleanup present in DB', () => {
  it.skipIf(!INFRA_READY)(
    'A1: Chuletón de buey (...fb) has a non-null embedding after seed+regen',
    async () => {
      const result = await prisma.$queryRaw<Array<{ id: string; has_embedding: boolean }>>`
        SELECT id, (embedding IS NOT NULL) AS has_embedding
        FROM dishes
        WHERE id = ${CHULETON_ID}::uuid
      `;
      expect(result).toHaveLength(1);
      expect(result[0]?.['has_embedding']).toBe(true);
    },
  );

  it.skipIf(!INFRA_READY)(
    'A2: Entrecot de ternera (...069) aliases no longer contain "chuletón" (F114 cleanup)',
    async () => {
      const result = await prisma.$queryRaw<Array<{ id: string; aliases: string[] }>>`
        SELECT id, aliases
        FROM dishes
        WHERE id = ${ENTRECOT_ID}::uuid
      `;
      expect(result).toHaveLength(1);
      expect(result[0]?.['aliases'] ?? []).not.toContain('chuletón');
    },
  );
});

describe('F114-I1 Tier B (routing): "chuletón" query embedding resolves to Chuletón de buey', () => {
  it.skipIf(!OPENAI_READY)(
    'B1: top pgvector match for embed("una ración de chuletón") is ...fb, rank(entrecot) > rank(chuletón)',
    async () => {
      // Embed the query string at test time via the same client the pipeline uses.
      const [queryVector] = await callOpenAIEmbeddings(['una ración de chuletón'], {
        apiKey: process.env['OPENAI_API_KEY']!,
      });
      expect(queryVector).toBeDefined();
      expect(queryVector!.length).toBeGreaterThan(0);

      const vectorLiteral = `[${queryVector!.join(',')}]`;
      // pgvector cosine distance — lowest distance = closest match
      const ranked = await prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(
        `SELECT id::text AS id, embedding <=> $1::vector AS distance
         FROM dishes
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 10`,
        vectorLiteral,
      );

      expect(ranked.length).toBeGreaterThan(0);
      const chuletonRank = ranked.findIndex((r) => r.id === CHULETON_ID);
      const entrecotRank = ranked.findIndex((r) => r.id === ENTRECOT_ID);

      // Chuletón must be present in the top-10; must rank ahead of Entrecot.
      expect(chuletonRank, 'Chuletón de buey must be in top-10 for "chuletón" query').toBeGreaterThanOrEqual(0);
      if (entrecotRank >= 0) {
        expect(
          chuletonRank,
          'Chuletón must rank ahead of Entrecot (AC7 core assertion)',
        ).toBeLessThan(entrecotRank);
      }
      // Strictest form: #1 result is Chuletón.
      expect(ranked[0]?.id, 'Top result must be Chuletón de buey').toBe(CHULETON_ID);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// F114-I2: "arroz negro" still routes to Arroz negro, NOT generic Arroz blanco
// ---------------------------------------------------------------------------

describe('F114-I2 Tier A (structural): Arroz negro + Arroz blanco present with embeddings', () => {
  it.skipIf(!INFRA_READY)(
    'A3: both Arroz negro (...084) and Arroz blanco (...0e5) have non-null embeddings',
    async () => {
      const result = await prisma.$queryRaw<Array<{ id: string; name: string; has_embedding: boolean }>>`
        SELECT id, name, (embedding IS NOT NULL) AS has_embedding
        FROM dishes
        WHERE id IN (${ARROZ_NEGRO_ID}::uuid, ${ARROZ_BLANCO_ID}::uuid)
        ORDER BY name
      `;
      expect(result).toHaveLength(2);
      for (const row of result) {
        expect(row['has_embedding'], `${row['name']} must have embedding`).toBe(true);
      }
    },
  );

  it.skipIf(!INFRA_READY)(
    'A4: Arroz blanco (...0e5) aliases contain all 4 expected values (post-F114)',
    async () => {
      const result = await prisma.$queryRaw<Array<{ id: string; aliases: string[] }>>`
        SELECT id, aliases
        FROM dishes
        WHERE id = ${ARROZ_BLANCO_ID}::uuid
      `;
      expect(result).toHaveLength(1);
      const aliases: string[] = result[0]?.['aliases'] ?? [];
      expect(aliases).toContain('guarnición de arroz');
      expect(aliases).toContain('arroz');
      expect(aliases).toContain('arroz cocido');
      expect(aliases).toContain('arroz hervido');
    },
  );
});

describe('F114-I2 Tier B (routing): "arroz negro" query embedding resolves to specific Arroz negro', () => {
  it.skipIf(!OPENAI_READY)(
    'B2: top pgvector match for embed("arroz negro") is ...084, NOT generic Arroz blanco (...0e5)',
    async () => {
      const [queryVector] = await callOpenAIEmbeddings(['arroz negro'], {
        apiKey: process.env['OPENAI_API_KEY']!,
      });
      expect(queryVector).toBeDefined();

      const vectorLiteral = `[${queryVector!.join(',')}]`;
      const ranked = await prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(
        `SELECT id::text AS id, embedding <=> $1::vector AS distance
         FROM dishes
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 10`,
        vectorLiteral,
      );

      expect(ranked[0]?.id, 'Top result must be the specific Arroz negro, not generic Arroz blanco').toBe(ARROZ_NEGRO_ID);
      expect(ranked[0]?.id).not.toBe(ARROZ_BLANCO_ID);
    },
    60_000,
  );
});
