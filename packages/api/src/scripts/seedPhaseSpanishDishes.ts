/**
 * F073 — Spanish Canonical Dishes seed phase.
 * Seeds ~250 Spanish dishes under virtual restaurant 'cocina-espanola'.
 *
 * Called from packages/api/prisma/seed.ts.
 *
 * Two DataSources for provenance:
 * - BEDCA (Tier 1, existing) for BEDCA-sourced dishes
 * - cocina-espanola-recipes (Tier 3, new) for recipe-estimated dishes
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { PrismaClient } from '@prisma/client';
import { validateSpanishDishes } from './validateSpanishDishes.js';
import type { SpanishDishesFile } from './spanishDishesTypes.js';
import { BEDCA_SOURCE_UUID } from './seedPhaseBedca.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Deterministic UUIDs for F073 — e073 namespace */
export const COCINA_ESPANOLA_RESTAURANT_UUID = '00000000-0000-e073-0006-000000000001';
export const COCINA_ESPANOLA_RECIPES_SOURCE_UUID = '00000000-0000-e073-0000-000000000001';
export { BEDCA_SOURCE_UUID };

const BATCH_SIZE = 50;
const ZERO_VECTOR = `[${Array(1536).fill(0).join(',')}]`;

// ---------------------------------------------------------------------------
// Helpers (local — same logic as seed.ts but not exported there)
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`${label} failed (attempt 1):`, err, 'Retrying...');
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function getDataPath(filename: string): string {
  const candidates = [
    resolve(process.cwd(), 'prisma/seed-data', filename),
    resolve(process.cwd(), 'packages/api/prisma/seed-data', filename),
    resolve(process.cwd(), '../prisma/seed-data', filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return resolve(process.cwd(), 'prisma/seed-data', filename);
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

export async function seedPhaseSpanishDishes(client: PrismaClient): Promise<void> {
  // 1. Upsert DataSources
  await client.dataSource.upsert({
    where: { id: COCINA_ESPANOLA_RECIPES_SOURCE_UUID },
    update: {},
    create: {
      id: COCINA_ESPANOLA_RECIPES_SOURCE_UUID,
      name: 'Cocina Española — Recipe Estimates',
      type: 'estimated',
      url: null,
      priorityTier: 3,
      lastUpdated: new Date(),
    },
  });
  console.log('  DataSource upserted: cocina-espanola-recipes (Tier 3)');

  // BEDCA DataSource — full create payload so FK exists even when seedPhaseBedca is skipped
  await client.dataSource.upsert({
    where: { id: BEDCA_SOURCE_UUID },
    update: {},
    create: {
      id: BEDCA_SOURCE_UUID,
      name: 'BEDCA — Base de Datos Española de Composición de Alimentos',
      type: 'official',
      url: 'https://www.bedca.net/bdpub/',
      priorityTier: 1,
      lastUpdated: new Date('2024-01-01'),
    },
  });
  console.log('  DataSource ensured: BEDCA (Tier 1)');

  // 2. Upsert Restaurant
  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'cocina-espanola', countryCode: 'ES' } },
    update: {},
    create: {
      id: COCINA_ESPANOLA_RESTAURANT_UUID,
      name: 'Cocina Española',
      nameEs: 'Cocina Española',
      chainSlug: 'cocina-espanola',
      countryCode: 'ES',
      website: null,
      isActive: true,
    },
  });
  console.log('  Restaurant upserted: cocina-espanola');

  // 3. Load and validate data
  const dataPath = getDataPath('spanish-dishes.json');
  const raw = JSON.parse(readFileSync(dataPath, 'utf8')) as SpanishDishesFile;
  const validation = validateSpanishDishes(raw.dishes);

  for (const err of validation.errors) {
    if (err.startsWith('[WARN]')) {
      console.warn(`  ${err}`);
    } else {
      console.error(`  ${err}`);
    }
  }
  if (!validation.valid) {
    throw new Error('Spanish dishes seed data validation failed. See errors above.');
  }

  const dishes = raw.dishes;
  console.log(`  Validated ${dishes.length} Spanish dishes`);

  // 4. Batch-upsert Dishes
  const dishBatches = chunk(dishes, BATCH_SIZE);
  let dishCount = 0;
  for (const batch of dishBatches) {
    await withRetry(async () => {
      for (const entry of batch) {
        const sourceId = entry.source === 'bedca'
          ? BEDCA_SOURCE_UUID
          : COCINA_ESPANOLA_RECIPES_SOURCE_UUID;

        await client.dish.upsert({
          where: { id: entry.dishId },
          update: {
            name: entry.name,
            nameEs: entry.nameEs,
            aliases: entry.aliases,
            portionGrams: entry.portionGrams,
            confidenceLevel: entry.confidenceLevel,
            estimationMethod: entry.estimationMethod,
          },
          create: {
            id: entry.dishId,
            restaurantId: COCINA_ESPANOLA_RESTAURANT_UUID,
            sourceId,
            name: entry.name,
            nameEs: entry.nameEs,
            nameSourceLocale: 'es',
            externalId: entry.externalId,
            aliases: entry.aliases,
            portionGrams: entry.portionGrams,
            confidenceLevel: entry.confidenceLevel,
            estimationMethod: entry.estimationMethod,
            availability: 'available',
          },
        });
      }
    }, `Dish batch ${dishCount / BATCH_SIZE + 1}`);
    dishCount += batch.length;
  }
  console.log(`  Upserted ${dishCount} dishes`);

  // 5. Batch-upsert DishNutrients
  let nutrientCount = 0;
  for (const batch of dishBatches) {
    await withRetry(async () => {
      for (const entry of batch) {
        const sourceId = entry.source === 'bedca'
          ? BEDCA_SOURCE_UUID
          : COCINA_ESPANOLA_RECIPES_SOURCE_UUID;

        await client.dishNutrient.upsert({
          where: { id: entry.nutrientId },
          update: {
            calories: entry.nutrients.calories,
            proteins: entry.nutrients.proteins,
            carbohydrates: entry.nutrients.carbohydrates,
            sugars: entry.nutrients.sugars,
            fats: entry.nutrients.fats,
            saturatedFats: entry.nutrients.saturatedFats,
            fiber: entry.nutrients.fiber,
            salt: entry.nutrients.salt,
            sodium: entry.nutrients.sodium,
          },
          create: {
            id: entry.nutrientId,
            dishId: entry.dishId,
            sourceId,
            calories: entry.nutrients.calories,
            proteins: entry.nutrients.proteins,
            carbohydrates: entry.nutrients.carbohydrates,
            sugars: entry.nutrients.sugars,
            fats: entry.nutrients.fats,
            saturatedFats: entry.nutrients.saturatedFats,
            fiber: entry.nutrients.fiber,
            salt: entry.nutrients.salt,
            sodium: entry.nutrients.sodium,
            referenceBasis: 'per_serving',
            estimationMethod: entry.estimationMethod,
            confidenceLevel: entry.confidenceLevel,
          },
        });
      }
    }, `DishNutrient batch ${nutrientCount / BATCH_SIZE + 1}`);
    nutrientCount += batch.length;
  }
  console.log(`  Upserted ${nutrientCount} dish nutrients`);

  // 6. Backfill zero-vector embeddings
  const result = await client.$executeRaw`
    UPDATE dishes
    SET embedding = ${ZERO_VECTOR}::vector
    WHERE restaurant_id = ${COCINA_ESPANOLA_RESTAURANT_UUID}::uuid
      AND embedding IS NULL
  `;
  console.log(`  Zero-vector embeddings backfilled: ${result} dishes`);
}
