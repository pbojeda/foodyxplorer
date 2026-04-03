/**
 * F071 — BEDCA Seed Phase (seedPhaseBedca)
 *
 * Seeds the BEDCA food database into the nutriXplorer food catalog.
 * Called from packages/api/prisma/seed.ts.
 *
 * Feature flag: BEDCA_IMPORT_ENABLED=true required in non-test environments.
 * This prevents accidental production use before AESAN commercial authorization.
 *
 * Data source: packages/api/prisma/seed-data/bedca/bedca-snapshot-full.json
 * Nutrient index: packages/api/prisma/seed-data/bedca/bedca-nutrient-index.json
 *
 * Idempotent: uses upsert on @@unique([externalId, sourceId]).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { PrismaClient } from '@prisma/client';
import type {
  BedcaFoodWithNutrients,
  BedcaNutrientInfo,
} from '../ingest/bedca/types.js';
import { mapBedcaNutrientsToSchema } from '../ingest/bedca/bedcaNutrientMapper.js';
import { validateBedcaSeedData } from '../ingest/bedca/bedcaValidator.js';

/** Deterministic UUID for the BEDCA DataSource row. */
export const BEDCA_SOURCE_UUID = '00000000-0000-0000-0000-000000000003';

/** BEDCA data source priority tier: 1 = national reference (ADR-015). */
const BEDCA_PRIORITY_TIER = 1;

/** Batch size for food upserts (same as USDA seed pattern). */
const BATCH_SIZE = 50;

/** 1536-dimension zero vector for placeholder embeddings. */
const ZERO_VECTOR = `[${Array(1536).fill(0).join(',')}]`;

/** Core BEDCA nutrient IDs (must have at least one non-null to be importable). */
const CORE_NUTRIENT_IDS = new Set([208, 203, 205, 204]);

/**
 * Resolves path to snapshot data files.
 * Uses process.cwd()-based path (compatible with both ESM and CJS compilation).
 * The seed data is in packages/api/prisma/seed-data/bedca/.
 */
function getSnapshotPath(filename: string): string {
  // When run via tsx from project root or packages/api, resolve relative to cwd
  // Fallback: try common paths
  const candidates = [
    resolve(process.cwd(), 'prisma/seed-data/bedca', filename),
    resolve(process.cwd(), 'packages/api/prisma/seed-data/bedca', filename),
    resolve(process.cwd(), '../prisma/seed-data/bedca', filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Last resort: relative to this file's compiled location
  return resolve(process.cwd(), 'prisma/seed-data/bedca', filename);
}

/**
 * Seeds BEDCA food data into the database.
 *
 * Feature flag behavior:
 * - NODE_ENV=test → always proceeds (test isolation)
 * - NODE_ENV=development|production + BEDCA_IMPORT_ENABLED=true → proceeds
 * - NODE_ENV=development|production + flag absent → skips with warning
 */
export async function seedPhaseBedca(client: PrismaClient): Promise<void> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const flagEnabled = process.env['BEDCA_IMPORT_ENABLED'] === 'true';
  const isTest = nodeEnv === 'test';

  if (!isTest && !flagEnabled) {
    console.log(
      '[seedPhaseBedca] BEDCA import SKIPPED — set BEDCA_IMPORT_ENABLED=true when AESAN authorization is received',
    );
    return;
  }

  console.log('[seedPhaseBedca] Starting BEDCA seed import...');

  // ---------------------------------------------------------------------------
  // 1. Upsert DataSource
  // ---------------------------------------------------------------------------
  const dataSource = await client.dataSource.upsert({
    where: { id: BEDCA_SOURCE_UUID },
    update: { priorityTier: BEDCA_PRIORITY_TIER },
    create: {
      id: BEDCA_SOURCE_UUID,
      name: 'BEDCA — Base de Datos Española de Composición de Alimentos',
      type: 'official',
      url: 'https://www.bedca.net/bdpub/',
      lastUpdated: new Date('2026-04-03'),
      priorityTier: BEDCA_PRIORITY_TIER,
    },
  });
  console.log(`[seedPhaseBedca] DataSource: ${dataSource.id}`);

  // ---------------------------------------------------------------------------
  // 2. Load and validate snapshot data
  // ---------------------------------------------------------------------------
  const snapshot: BedcaFoodWithNutrients[] = JSON.parse(
    readFileSync(getSnapshotPath('bedca-snapshot-full.json'), 'utf-8'),
  ) as BedcaFoodWithNutrients[];

  const nutrientIndex: BedcaNutrientInfo[] = JSON.parse(
    readFileSync(getSnapshotPath('bedca-nutrient-index.json'), 'utf-8'),
  ) as BedcaNutrientInfo[];

  const validation = validateBedcaSeedData(snapshot);
  if (!validation.valid) {
    const blocking = validation.errors.filter((e) => !e.startsWith('[WARN]'));
    throw new Error(
      `[seedPhaseBedca] BEDCA snapshot validation failed:\n${blocking.join('\n')}`,
    );
  }

  for (const w of validation.errors.filter((e) => e.startsWith('[WARN]'))) {
    console.warn(`[seedPhaseBedca] ${w}`);
  }

  // Filter to entries with at least one non-null core nutrient
  const importable = snapshot.filter((entry) => {
    const coreNutrients = entry.nutrients.filter((n) => CORE_NUTRIENT_IDS.has(n.nutrientId));
    return coreNutrients.some((n) => n.value !== null);
  });

  console.log(
    `[seedPhaseBedca] Snapshot: ${snapshot.length} entries, ${importable.length} importable`,
  );

  // ---------------------------------------------------------------------------
  // 3. Batch upsert foods + collect returned IDs for nutrient seeding
  // ---------------------------------------------------------------------------
  let foodsInserted = 0;
  const foodIdMap = new Map<number, string>(); // bedcaId → DB uuid

  for (let i = 0; i < importable.length; i += BATCH_SIZE) {
    const batch = importable.slice(i, i + BATCH_SIZE);

    for (const entry of batch) {
      const nameEs = entry.nameEs?.trim() || entry.nameEn?.trim() || '';
      const nameEn = entry.nameEn?.trim() || entry.nameEs?.trim() || '';

      if (!nameEs && !nameEn) continue;

      const externalId = `BEDCA-${entry.foodId}`;

      const food = await client.food.upsert({
        where: {
          externalId_sourceId: {
            externalId,
            sourceId: BEDCA_SOURCE_UUID,
          },
        },
        update: {
          nameEs,
          foodGroup: entry.foodGroupEn || entry.foodGroupEs || null,
        },
        create: {
          name: nameEn,
          nameEs,
          aliases: [],
          foodGroup: entry.foodGroupEn || entry.foodGroupEs || null,
          sourceId: BEDCA_SOURCE_UUID,
          externalId,
          confidenceLevel: 'high',
          foodType: 'generic',
          nameSourceLocale: 'es',
        },
      });

      foodIdMap.set(entry.foodId, food.id);
      foodsInserted++;
    }
  }

  console.log(`[seedPhaseBedca] Foods: ${foodsInserted} upserted`);

  // ---------------------------------------------------------------------------
  // 4. Batch upsert food nutrients
  // ---------------------------------------------------------------------------
  let nutrientsInserted = 0;

  for (let i = 0; i < importable.length; i += BATCH_SIZE) {
    const batch = importable.slice(i, i + BATCH_SIZE);

    for (const entry of batch) {
      const foodId = foodIdMap.get(entry.foodId);
      if (!foodId) continue;

      const mapped = mapBedcaNutrientsToSchema(entry.nutrients, nutrientIndex);

      await client.foodNutrient.upsert({
        where: {
          foodId_sourceId: {
            foodId,
            sourceId: BEDCA_SOURCE_UUID,
          },
        },
        update: {
          calories: mapped.calories,
          proteins: mapped.proteins,
          carbohydrates: mapped.carbohydrates,
          sugars: mapped.sugars,
          fats: mapped.fats,
          saturatedFats: mapped.saturatedFats,
          fiber: mapped.fiber,
          salt: mapped.salt,
          sodium: mapped.sodium,
          transFats: mapped.transFats,
          cholesterol: mapped.cholesterol,
          potassium: mapped.potassium,
          monounsaturatedFats: mapped.monounsaturatedFats,
          polyunsaturatedFats: mapped.polyunsaturatedFats,
          extra: mapped.extra,
        },
        create: {
          foodId,
          calories: mapped.calories,
          proteins: mapped.proteins,
          carbohydrates: mapped.carbohydrates,
          sugars: mapped.sugars,
          fats: mapped.fats,
          saturatedFats: mapped.saturatedFats,
          fiber: mapped.fiber,
          salt: mapped.salt,
          sodium: mapped.sodium,
          transFats: mapped.transFats,
          cholesterol: mapped.cholesterol,
          potassium: mapped.potassium,
          monounsaturatedFats: mapped.monounsaturatedFats,
          polyunsaturatedFats: mapped.polyunsaturatedFats,
          extra: mapped.extra,
          referenceBasis: 'per_100g',
          sourceId: BEDCA_SOURCE_UUID,
          confidenceLevel: 'high',
        },
      });

      nutrientsInserted++;
    }
  }

  console.log(`[seedPhaseBedca] FoodNutrients: ${nutrientsInserted} upserted`);

  // ---------------------------------------------------------------------------
  // 5. Set zero-vector embeddings
  // ---------------------------------------------------------------------------
  await client.$executeRaw`
    UPDATE foods
    SET embedding = ${ZERO_VECTOR}::vector
    WHERE source_id = ${BEDCA_SOURCE_UUID}::uuid
      AND embedding IS NULL
  `;

  console.log('[seedPhaseBedca] Embeddings set. BEDCA seed phase complete.');
}
