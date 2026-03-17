// Embedding pipeline orchestrator.
//
// runEmbeddingPipeline orchestrates:
//   1. Validate API key (unless dryRun)
//   2. Fetch DB rows for the target entity type(s)
//   3. Build embedding texts
//   4. Estimate tokens
//   5. If dryRun, return immediately without writing
//   6. For each batch: call OpenAI, write vectors to DB
//   7. Return EmbeddingGenerateData with counters and timing

import { Prisma } from '@prisma/client';
import type { EmbeddingGenerateData, EmbeddingItemError } from '@foodxplorer/shared';
import { callOpenAIEmbeddings, estimateTokens, RateLimiter } from './embeddingClient.js';
import { writeFoodEmbedding, writeDishEmbedding } from './embeddingWriter.js';
import { buildFoodText, buildDishText } from './textBuilder.js';
import { mapFoodRow, mapDishRow, type FoodRowRaw, type DishRowRaw, type EmbeddingPipelineOptions } from './types.js';

// ---------------------------------------------------------------------------
// SQL query builders
// ---------------------------------------------------------------------------

function buildFoodQuery(force: boolean): Prisma.Sql {
  const whereClause = force
    ? Prisma.empty
    : Prisma.sql`WHERE f.embedding_updated_at IS NULL`;

  return Prisma.sql`
    WITH ranked_fn AS (
      SELECT fn.*, ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
    )
    SELECT f.id, f.name, f.name_es, f.food_group, f.food_type,
           rfn.calories, rfn.proteins, rfn.carbohydrates, rfn.sugars,
           rfn.fats, rfn.saturated_fats, rfn.fiber, rfn.sodium
    FROM foods f
    LEFT JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    ${whereClause}
  `;
}

function buildDishQuery(force: boolean, chainSlug?: string): Prisma.Sql {
  const forceClause = force
    ? Prisma.empty
    : Prisma.sql`WHERE d.embedding_updated_at IS NULL`;

  const chainClause =
    chainSlug !== undefined
      ? force
        ? Prisma.sql`WHERE r.chain_slug = ${chainSlug}`
        : Prisma.sql`AND r.chain_slug = ${chainSlug}`
      : Prisma.empty;

  return Prisma.sql`
    WITH ranked_dn AS (
      SELECT dn.*, ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT d.id, d.name, d.name_es, r.chain_slug, d.portion_grams,
           rdn.calories, rdn.proteins, rdn.carbohydrates, rdn.sugars,
           rdn.fats, rdn.saturated_fats, rdn.fiber, rdn.sodium,
           STRING_AGG(DISTINCT dc.slug, ',') AS category_slugs,
           STRING_AGG(DISTINCT cm.slug, ',') AS cooking_method_slugs
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    LEFT JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    LEFT JOIN dish_dish_categories ddc ON ddc.dish_id = d.id
    LEFT JOIN dish_categories dc ON dc.id = ddc.dish_category_id
    LEFT JOIN dish_cooking_methods dcm ON dcm.dish_id = d.id
    LEFT JOIN cooking_methods cm ON cm.id = dcm.cooking_method_id
    ${forceClause}
    ${chainClause}
    GROUP BY d.id, d.name, d.name_es, r.chain_slug, d.portion_grams,
             rdn.calories, rdn.proteins, rdn.carbohydrates, rdn.sugars,
             rdn.fats, rdn.saturated_fats, rdn.fiber, rdn.sodium
  `;
}

// ---------------------------------------------------------------------------
// Batch processing helpers
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// runEmbeddingPipeline
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full embedding generation pipeline.
 *
 * @param options - Pipeline configuration (target, batchSize, force, dryRun, etc.)
 * @returns EmbeddingGenerateData with counters, timing, and per-item errors
 */
export async function runEmbeddingPipeline(
  options: EmbeddingPipelineOptions,
): Promise<EmbeddingGenerateData> {
  const startTime = Date.now();
  const {
    target,
    chainSlug,
    batchSize,
    force,
    dryRun,
    prisma,
    openaiApiKey,
    embeddingModel,
    embeddingRpm,
  } = options;

  // Step 1 — validate API key (skip for dryRun)
  if (!dryRun && !openaiApiKey) {
    throw Object.assign(
      new Error('OPENAI_API_KEY is not configured'),
      { code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
    );
  }

  // Step 2 — warn on non-default model
  if (embeddingModel !== 'text-embedding-3-small') {
    console.warn(`[embeddings] WARNING: non-default embedding model "${embeddingModel}" — ensure it produces 1536-dim vectors`);
  }

  // Step 3 — warn if chainSlug + target 'all'
  if (chainSlug !== undefined && target === 'all') {
    console.warn('[embeddings] WARNING: chainSlug is set with target "all" — scoping only dishes phase');
  }

  const errors: EmbeddingItemError[] = [];
  let processedFoods = 0;
  let processedDishes = 0;
  let skippedFoods = 0;
  let skippedDishes = 0;
  let estimatedTokensTotal = 0;

  const rateLimiter = new RateLimiter(embeddingRpm);

  // ---------------------------------------------------------------------------
  // Process foods
  // ---------------------------------------------------------------------------

  if (target === 'foods' || target === 'all') {
    let foodRows: FoodRowRaw[];

    try {
      foodRows = await prisma.$queryRaw<FoodRowRaw[]>(buildFoodQuery(force));
    } catch (err) {
      throw Object.assign(
        new Error('Database query failed during embedding pipeline (foods)'),
        { code: 'DB_UNAVAILABLE', cause: err },
      );
    }

    const foods = foodRows.map(mapFoodRow);

    // Count skipped items (already embedded) when force=false
    if (!force) {
      try {
        const countResult = await prisma.$queryRaw<[{ count: bigint }]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM foods WHERE embedding_updated_at IS NOT NULL`,
        );
        skippedFoods = Number(countResult[0]?.count ?? 0);
      } catch {
        // Non-fatal: skipped count is informational only
        skippedFoods = 0;
      }
    }

    if (foods.length > 0) {
      // Build texts once for both token estimation and API calls
      const allTexts = foods.map(buildFoodText);
      estimatedTokensTotal += estimateTokens(allTexts);

      if (!dryRun) {
        const indexedBatches = chunkArray(
          foods.map((f, i) => ({ item: f, text: allTexts[i]! })),
          batchSize,
        );

        for (const batch of indexedBatches) {
          const batchTexts = batch.map((b) => b.text);

          let vectors: number[][];
          try {
            await rateLimiter.acquire();
            vectors = await callOpenAIEmbeddings(batchTexts, {
              apiKey: openaiApiKey,
              model: embeddingModel,
              rpm: embeddingRpm,
            });
          } catch (err) {
            // Batch-level failure — record each item in this batch as an error
            for (const entry of batch) {
              errors.push({
                itemType: 'food',
                itemId: entry.item.id,
                itemName: entry.item.name,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
            continue;
          }

          // Write each item
          for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            const vector = vectors[i];
            if (entry === undefined || vector === undefined) continue;

            try {
              await writeFoodEmbedding(prisma, entry.item.id, vector);
              processedFoods++;
            } catch (err) {
              errors.push({
                itemType: 'food',
                itemId: entry.item.id,
                itemName: entry.item.name,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Process dishes
  // ---------------------------------------------------------------------------

  if (target === 'dishes' || target === 'all') {
    let dishRows: DishRowRaw[];

    try {
      dishRows = await prisma.$queryRaw<DishRowRaw[]>(
        buildDishQuery(force, chainSlug),
      );
    } catch (err) {
      throw Object.assign(
        new Error('Database query failed during embedding pipeline (dishes)'),
        { code: 'DB_UNAVAILABLE', cause: err },
      );
    }

    const dishes = dishRows.map(mapDishRow);

    // Count skipped dishes (already embedded) when force=false
    if (!force) {
      try {
        const chainFilter = chainSlug !== undefined
          ? Prisma.sql`AND r.chain_slug = ${chainSlug}`
          : Prisma.empty;
        const countResult = await prisma.$queryRaw<[{ count: bigint }]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id WHERE d.embedding_updated_at IS NOT NULL ${chainFilter}`,
        );
        skippedDishes = Number(countResult[0]?.count ?? 0);
      } catch {
        // Non-fatal: skipped count is informational only
        skippedDishes = 0;
      }
    }

    if (dishes.length > 0) {
      // Build texts once for both token estimation and API calls
      const allTexts = dishes.map(buildDishText);
      estimatedTokensTotal += estimateTokens(allTexts);

      if (!dryRun) {
        const indexedBatches = chunkArray(
          dishes.map((d, i) => ({ item: d, text: allTexts[i]! })),
          batchSize,
        );

        for (const batch of indexedBatches) {
          const batchTexts = batch.map((b) => b.text);

          let vectors: number[][];
          try {
            await rateLimiter.acquire();
            vectors = await callOpenAIEmbeddings(batchTexts, {
              apiKey: openaiApiKey,
              model: embeddingModel,
              rpm: embeddingRpm,
            });
          } catch (err) {
            for (const entry of batch) {
              errors.push({
                itemType: 'dish',
                itemId: entry.item.id,
                itemName: entry.item.name,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
            continue;
          }

          for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            const vector = vectors[i];
            if (entry === undefined || vector === undefined) continue;

            try {
              await writeDishEmbedding(prisma, entry.item.id, vector);
              processedDishes++;
            } catch (err) {
              errors.push({
                itemType: 'dish',
                itemId: entry.item.id,
                itemName: entry.item.name,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build result
  // ---------------------------------------------------------------------------

  const durationMs = Math.max(0, Math.round(Date.now() - startTime));

  return {
    target,
    dryRun,
    processedFoods,
    processedDishes,
    skippedFoods,
    skippedDishes,
    errorCount: errors.length,
    errors,
    estimatedTokens: estimatedTokensTotal,
    durationMs,
    completedAt: new Date().toISOString(),
  };
}
