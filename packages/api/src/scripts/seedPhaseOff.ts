/**
 * F080 — OFF Seed Phase (seedPhaseOff)
 *
 * Seeds Open Food Facts prepared food data into the nutriXplorer food catalog.
 * Called from packages/api/prisma/seed.ts.
 *
 * Feature flag: OFF_IMPORT_ENABLED=true required in non-test environments.
 *
 * Data source: fetched via offClient (live) or injected via opts.products (tests/dry-run).
 * Idempotent: uses upsert on @@unique([externalId, sourceId]).
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { OffProduct } from '../ingest/off/types.js';
import { OFF_SOURCE_UUID } from '../ingest/off/types.js';
import { validateOffProduct } from '../ingest/off/offValidator.js';
import { mapOffProductToFood } from '../ingest/off/offMapper.js';

/** Batch size for food upserts (same as BEDCA). */
const BATCH_SIZE = 50;

/** Log progress every N products. */
const PROGRESS_EVERY = 100;

/** 1536-dimension zero vector for placeholder embeddings. */
const ZERO_VECTOR = `[${Array(1536).fill(0).join(',')}]`;

/** OFF data source priority tier: 0 = official branded (ADR-015). */
const OFF_PRIORITY_TIER = 0;

/** Result returned by seedPhaseOff. */
export interface SeedOffResult {
  productsFound: number;
  productsImported: number;
  productsSkipped: number;
  skipReasons: string[];
}

export interface SeedPhaseOffOptions {
  /** When true: validate + parse but write nothing to DB. */
  dryRun?: boolean;
  /** Pre-loaded products (for tests / dry-run). When absent, fetch from OFF API. */
  products?: OffProduct[];
  /** Maximum number of products to process. */
  limit?: number;
  /** Brand to fetch (default: "hacendado"). Used when products is absent. */
  brand?: string;
}

/**
 * Seeds OFF food data into the database.
 *
 * Feature flag behavior:
 * - NODE_ENV=test → always proceeds (test isolation)
 * - NODE_ENV=development|production + OFF_IMPORT_ENABLED=true → proceeds
 * - NODE_ENV=development|production + flag absent → skips with warning
 */
export async function seedPhaseOff(
  client: PrismaClient,
  opts: SeedPhaseOffOptions = {},
): Promise<SeedOffResult> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const flagEnabled = process.env['OFF_IMPORT_ENABLED'] === 'true';
  const isTest = nodeEnv === 'test';

  const result: SeedOffResult = {
    productsFound: 0,
    productsImported: 0,
    productsSkipped: 0,
    skipReasons: [],
  };

  if (!isTest && !flagEnabled) {
    console.log(
      '[seedPhaseOff] OFF import SKIPPED — set OFF_IMPORT_ENABLED=true to enable import',
    );
    return result;
  }

  const { dryRun = false, products: providedProducts, limit } = opts;

  if (dryRun) {
    console.log('[seedPhaseOff] DRY RUN mode — no DB writes will be performed');
  } else {
    console.log('[seedPhaseOff] Starting OFF seed import...');
  }

  // ---------------------------------------------------------------------------
  // 1. Load products
  // ---------------------------------------------------------------------------
  let allProducts: OffProduct[];

  if (providedProducts !== undefined) {
    allProducts = providedProducts;
  } else {
    // Live fetch — lazy import to avoid module loading in tests
    const { fetchProductsByBrand } = await import('../ingest/off/offClient.js');
    const brand = opts.brand ?? 'hacendado';
    console.log(`[seedPhaseOff] Fetching products for brand: ${brand}`);
    allProducts = await fetchProductsByBrand(brand, { limit });
  }

  result.productsFound = allProducts.length;
  console.log(`[seedPhaseOff] Products to process: ${result.productsFound}`);

  // ---------------------------------------------------------------------------
  // 2. Upsert DataSource (unless dry-run)
  // ---------------------------------------------------------------------------
  if (!dryRun) {
    const dataSource = await client.dataSource.upsert({
      where: { id: OFF_SOURCE_UUID },
      update: { priorityTier: OFF_PRIORITY_TIER },
      create: {
        id: OFF_SOURCE_UUID,
        name: 'Open Food Facts',
        type: 'official',
        url: 'https://world.openfoodfacts.org/',
        lastUpdated: new Date(),
        priorityTier: OFF_PRIORITY_TIER,
      },
    });
    console.log(`[seedPhaseOff] DataSource: ${dataSource.id}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Validate, map, and upsert products in batches
  // ---------------------------------------------------------------------------
  const toProcess = limit !== undefined ? allProducts.slice(0, limit) : allProducts;
  const foodIdMap = new Map<string, string>(); // externalId → DB uuid

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    for (const product of batch) {
      // Progress logging
      const processed = result.productsImported + result.productsSkipped;
      if (processed > 0 && processed % PROGRESS_EVERY === 0) {
        console.log(
          `[seedPhaseOff] Progress: ${processed}/${result.productsFound} products processed`,
        );
      }

      // Validate
      const validation = validateOffProduct(product);
      if (!validation.valid) {
        result.productsSkipped++;
        for (const reason of validation.reasons) {
          result.skipReasons.push(reason);
        }
        continue;
      }

      // Map
      const mapped = mapOffProductToFood(product);

      if (dryRun) {
        // Dry-run: count only — no DB writes
        // (result.productsSkipped already incremented above for invalid products)
        // Don't increment imports for dry-run
        continue;
      }

      // Upsert food
      const food = await client.food.upsert({
        where: {
          externalId_sourceId: {
            externalId: mapped.food.externalId,
            sourceId: OFF_SOURCE_UUID,
          },
        },
        update: {
          name: mapped.food.name,
          // nameEs is non-nullable in DB; valid products always have name or nameEs
          nameEs: mapped.food.nameEs ?? mapped.food.name,
          foodGroup: mapped.food.foodGroup,
          barcode: mapped.food.barcode ?? undefined,
          brandName: mapped.food.brandName ?? undefined,
        },
        create: {
          name: mapped.food.name,
          nameEs: mapped.food.nameEs ?? mapped.food.name,
          aliases: [],
          foodGroup: mapped.food.foodGroup,
          foodType: mapped.food.foodType,
          confidenceLevel: mapped.food.confidenceLevel,
          sourceId: OFF_SOURCE_UUID,
          externalId: mapped.food.externalId,
          barcode: mapped.food.barcode ?? undefined,
          brandName: mapped.food.brandName ?? undefined,
        },
      });

      foodIdMap.set(mapped.food.externalId, food.id);
      result.productsImported++;

      // Upsert food nutrients
      const n = mapped.nutrients;
      await client.foodNutrient.upsert({
        where: {
          foodId_sourceId: {
            foodId: food.id,
            sourceId: OFF_SOURCE_UUID,
          },
        },
        update: {
          calories: n.calories,
          proteins: n.proteins,
          carbohydrates: n.carbohydrates,
          sugars: n.sugars,
          fats: n.fats,
          saturatedFats: n.saturatedFats,
          fiber: n.fiber,
          salt: n.salt,
          sodium: n.sodium,
          transFats: n.transFats,
          cholesterol: n.cholesterol,
          potassium: n.potassium,
          monounsaturatedFats: n.monounsaturatedFats,
          polyunsaturatedFats: n.polyunsaturatedFats,
          alcohol: n.alcohol,
          extra: n.extra as Prisma.InputJsonValue,
        },
        create: {
          foodId: food.id,
          calories: n.calories,
          proteins: n.proteins,
          carbohydrates: n.carbohydrates,
          sugars: n.sugars,
          fats: n.fats,
          saturatedFats: n.saturatedFats,
          fiber: n.fiber,
          salt: n.salt,
          sodium: n.sodium,
          transFats: n.transFats,
          cholesterol: n.cholesterol,
          potassium: n.potassium,
          monounsaturatedFats: n.monounsaturatedFats,
          polyunsaturatedFats: n.polyunsaturatedFats,
          alcohol: n.alcohol,
          extra: n.extra as Prisma.InputJsonValue,
          referenceBasis: 'per_100g',
          sourceId: OFF_SOURCE_UUID,
          confidenceLevel: 'high',
        },
      });
    }
  }

  console.log(`[seedPhaseOff] Foods: ${result.productsImported} upserted, ${result.productsSkipped} skipped`);

  // ---------------------------------------------------------------------------
  // 4. Set zero-vector embeddings (non-dry-run only)
  // ---------------------------------------------------------------------------
  if (!dryRun) {
    await client.$executeRaw`
      UPDATE foods
      SET embedding = ${ZERO_VECTOR}::vector
      WHERE source_id = ${OFF_SOURCE_UUID}::uuid
        AND embedding IS NULL
    `;
    console.log('[seedPhaseOff] Embeddings set. OFF seed phase complete.');
  }

  return result;
}
