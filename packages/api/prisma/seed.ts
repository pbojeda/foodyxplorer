// Seed script for foodXPlorer dev database
// Inserts baseline reference data: data sources, foods, food nutrients, standard portions, recipes
// Run with: npm run db:seed -w @foodxplorer/api

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateSeedData,
  buildExternalId,
} from './seed-data/validateSeedData.js';
import type { UsdaSrLegacyFoodEntry, NameEsMap } from './seed-data/types.js';
import { CHAIN_SEED_IDS } from '../src/config/chains/chain-seed-ids.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL'] ?? 'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_dev',
    },
  },
});

// 1536-dimension zero vector for seed embedding (placeholder)
const ZERO_VECTOR = `[${Array(1536).fill(0).join(',')}]`;

async function main(): Promise<void> {
  console.log('Seeding database...');

  // ---------------------------------------------------------------------------
  // DataSource
  // ---------------------------------------------------------------------------
  const dataSource = await prisma.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'USDA FoodData Central',
      type: 'official',
      url: 'https://fdc.nal.usda.gov/',
      lastUpdated: new Date('2024-01-01'),
    },
  });
  console.log(`DataSource created: ${dataSource.name}`);

  // LLM data source — referenced by Level 4 LLM Integration Layer (F024)
  const llmDataSource = await prisma.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-000000000017' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000017',
      name: 'LLM-assisted identification',
      type: 'estimated',
      url: null,
      lastUpdated: new Date('2026-01-01'),
    },
  });
  console.log(`DataSource created: ${llmDataSource.name}`);

  // ---------------------------------------------------------------------------
  // Foods
  // ---------------------------------------------------------------------------
  const foodChicken = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000001' },
    update: { foodType: 'generic' },
    create: {
      id: '00000000-0000-0000-0001-000000000001',
      name: 'Chicken breast',
      nameEs: 'Pechuga de pollo',
      aliases: ['chicken', 'poultry', 'hen breast'],
      foodGroup: 'Meat',
      sourceId: dataSource.id,
      externalId: 'USDA-171077',
      confidenceLevel: 'high',
      foodType: 'generic',
    },
  });

  const foodRice = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000002' },
    update: { foodType: 'generic' },
    create: {
      id: '00000000-0000-0000-0001-000000000002',
      name: 'White rice, cooked',
      nameEs: 'Arroz blanco cocido',
      aliases: ['rice', 'boiled rice'],
      foodGroup: 'Cereals',
      sourceId: dataSource.id,
      externalId: 'USDA-168878',
      confidenceLevel: 'high',
      foodType: 'generic',
    },
  });

  const foodOliveOil = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000003' },
    update: { foodType: 'generic' },
    create: {
      id: '00000000-0000-0000-0001-000000000003',
      name: 'Olive oil',
      nameEs: 'Aceite de oliva',
      aliases: ['EVOO', 'extra virgin olive oil'],
      foodGroup: 'Fats and oils',
      sourceId: dataSource.id,
      externalId: 'USDA-171413',
      confidenceLevel: 'high',
      foodType: 'generic',
    },
  });

  console.log('Foods created: chicken, rice, olive oil');

  // Set embeddings via raw SQL (Prisma does not support vector column writes through the client)
  await prisma.$executeRaw`
    UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodChicken.id}::uuid
  `;
  await prisma.$executeRaw`
    UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodRice.id}::uuid
  `;
  await prisma.$executeRaw`
    UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodOliveOil.id}::uuid
  `;
  console.log('Embeddings set for all foods');

  // ---------------------------------------------------------------------------
  // FoodNutrients (per 100g)
  // ---------------------------------------------------------------------------
  await prisma.foodNutrient.upsert({
    where: {
      foodId_sourceId: { foodId: foodChicken.id, sourceId: dataSource.id },
    },
    update: { cholesterol: 85 },
    create: {
      id: '00000000-0000-0000-0002-000000000001',
      foodId: foodChicken.id,
      calories: 165,
      proteins: 31,
      carbohydrates: 0,
      sugars: 0,
      fats: 3.6,
      saturatedFats: 1,
      fiber: 0,
      salt: 0.07,
      sodium: 0.074,
      cholesterol: 85,
      sourceId: dataSource.id,
      confidenceLevel: 'high',
    },
  });

  await prisma.foodNutrient.upsert({
    where: {
      foodId_sourceId: { foodId: foodRice.id, sourceId: dataSource.id },
    },
    update: {},
    create: {
      id: '00000000-0000-0000-0002-000000000002',
      foodId: foodRice.id,
      calories: 130,
      proteins: 2.7,
      carbohydrates: 28.2,
      sugars: 0.05,
      fats: 0.3,
      saturatedFats: 0.08,
      fiber: 0.4,
      salt: 0,
      sodium: 0.001,
      sourceId: dataSource.id,
      confidenceLevel: 'high',
    },
  });

  await prisma.foodNutrient.upsert({
    where: {
      foodId_sourceId: { foodId: foodOliveOil.id, sourceId: dataSource.id },
    },
    update: { monounsaturatedFats: 73, polyunsaturatedFats: 10.5 },
    create: {
      id: '00000000-0000-0000-0002-000000000003',
      foodId: foodOliveOil.id,
      calories: 884,
      proteins: 0,
      carbohydrates: 0,
      sugars: 0,
      fats: 100,
      saturatedFats: 13.8,
      fiber: 0,
      salt: 0,
      sodium: 0,
      sourceId: dataSource.id,
      confidenceLevel: 'high',
    },
  });

  console.log('FoodNutrients created for all foods');

  // ---------------------------------------------------------------------------
  // StandardPortions
  // ---------------------------------------------------------------------------
  await prisma.standardPortion.upsert({
    where: { id: '00000000-0000-0000-0003-000000000001' },
    update: {
      description: '1 chicken breast (150g)',
      isDefault: true,
    },
    create: {
      id: '00000000-0000-0000-0003-000000000001',
      foodId: foodChicken.id,
      foodGroup: null,
      context: 'main_course',
      portionGrams: 150,
      sourceId: dataSource.id,
      notes: 'Typical main course serving of chicken breast',
      confidenceLevel: 'high',
      description: '1 chicken breast (150g)',
      isDefault: true,
    },
  });

  await prisma.standardPortion.upsert({
    where: { id: '00000000-0000-0000-0003-000000000002' },
    update: {
      description: '1 side serving of rice (80g)',
      isDefault: true,
    },
    create: {
      id: '00000000-0000-0000-0003-000000000002',
      foodId: foodRice.id,
      foodGroup: null,
      context: 'side_dish',
      portionGrams: 80,
      sourceId: dataSource.id,
      notes: 'Standard side dish serving of rice',
      confidenceLevel: 'medium',
      description: '1 side serving of rice (80g)',
      isDefault: true,
    },
  });

  await prisma.standardPortion.upsert({
    where: { id: '00000000-0000-0000-0003-000000000003' },
    update: {
      description: 'Default side portion for cereals (75g)',
      isDefault: false,
    },
    create: {
      id: '00000000-0000-0000-0003-000000000003',
      foodId: null,
      foodGroup: 'Cereals',
      context: 'side_dish',
      portionGrams: 75,
      sourceId: dataSource.id,
      notes: 'Default side dish portion for cereal food group',
      confidenceLevel: 'low',
      description: 'Default side portion for cereals (75g)',
      isDefault: false,
    },
  });

  console.log('StandardPortions created');

  // ---------------------------------------------------------------------------
  // Composite food: Chicken and rice bowl
  // ---------------------------------------------------------------------------
  const foodChickenRiceBowl = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000004',
      name: 'Chicken and rice bowl',
      nameEs: 'Bol de pollo con arroz',
      aliases: ['chicken rice bowl', 'rice bowl'],
      foodGroup: 'Prepared meals',
      sourceId: dataSource.id,
      confidenceLevel: 'high',
      foodType: 'composite',
    },
  });

  await prisma.$executeRaw`
    UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodChickenRiceBowl.id}::uuid
  `;

  const recipe = await prisma.recipe.upsert({
    where: { id: '00000000-0000-0000-0004-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0004-000000000001',
      foodId: foodChickenRiceBowl.id,
      servings: 1,
      prepMinutes: 10,
      cookMinutes: 20,
      sourceId: dataSource.id,
    },
  });

  await prisma.recipeIngredient.upsert({
    where: {
      recipeId_ingredientFoodId_sortOrder: {
        recipeId: recipe.id,
        ingredientFoodId: foodChicken.id,
        sortOrder: 0,
      },
    },
    update: {},
    create: {
      id: '00000000-0000-0000-0005-000000000001',
      recipeId: recipe.id,
      ingredientFoodId: foodChicken.id,
      amount: 150,
      unit: 'g',
      gramWeight: 150,
      sortOrder: 0,
    },
  });

  await prisma.recipeIngredient.upsert({
    where: {
      recipeId_ingredientFoodId_sortOrder: {
        recipeId: recipe.id,
        ingredientFoodId: foodRice.id,
        sortOrder: 1,
      },
    },
    update: {},
    create: {
      id: '00000000-0000-0000-0005-000000000002',
      recipeId: recipe.id,
      ingredientFoodId: foodRice.id,
      amount: 80,
      unit: 'g',
      gramWeight: 80,
      sortOrder: 1,
    },
  });

  console.log('Recipe and ingredients created: Chicken and rice bowl');

  // ---------------------------------------------------------------------------
  // Big Mac food (for dish link)
  // ---------------------------------------------------------------------------
  const foodBigMac = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000005' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000005',
      name: 'Big Mac',
      nameEs: 'Big Mac',
      aliases: ['big mac', 'bigmac'],
      foodGroup: 'Fast food',
      sourceId: dataSource.id,
      confidenceLevel: 'medium',
      foodType: 'composite',
    },
  });

  await prisma.$executeRaw`
    UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${foodBigMac.id}::uuid
  `;
  console.log('Big Mac food created');

  // ---------------------------------------------------------------------------
  // Cooking methods (upsert — also inserted in migration for all environments)
  // ---------------------------------------------------------------------------
  const cookingMethods = [
    { id: '00000000-0000-4000-c000-000000000001', name: 'Grilled',  nameEs: 'A la parrilla', slug: 'grilled' },
    { id: '00000000-0000-4000-c000-000000000002', name: 'Baked',    nameEs: 'Al horno',       slug: 'baked' },
    { id: '00000000-0000-4000-c000-000000000003', name: 'Fried',    nameEs: 'Frito',          slug: 'fried' },
    { id: '00000000-0000-4000-c000-000000000004', name: 'Steamed',  nameEs: 'Al vapor',       slug: 'steamed' },
    { id: '00000000-0000-4000-c000-000000000005', name: 'Raw',      nameEs: 'Crudo',          slug: 'raw' },
    { id: '00000000-0000-4000-c000-000000000006', name: 'Boiled',   nameEs: 'Hervido',        slug: 'boiled' },
    { id: '00000000-0000-4000-c000-000000000007', name: 'Roasted',  nameEs: 'Asado',          slug: 'roasted' },
    { id: '00000000-0000-4000-c000-000000000008', name: 'Stewed',   nameEs: 'Estofado',       slug: 'stewed' },
  ];

  for (const cm of cookingMethods) {
    await prisma.cookingMethod.upsert({
      where: { slug: cm.slug },
      update: { name: cm.name, nameEs: cm.nameEs },
      create: { id: cm.id, name: cm.name, nameEs: cm.nameEs, slug: cm.slug },
    });
  }
  console.log('Cooking methods upserted');

  // ---------------------------------------------------------------------------
  // Dish categories (upsert — also inserted in migration for all environments)
  // ---------------------------------------------------------------------------
  const dishCategories = [
    { id: '00000000-0000-4000-d000-000000000001', name: 'Starters',     nameEs: 'Entrantes',          slug: 'starters',     sortOrder: 0 },
    { id: '00000000-0000-4000-d000-000000000002', name: 'Main Courses', nameEs: 'Platos principales', slug: 'main-courses', sortOrder: 1 },
    { id: '00000000-0000-4000-d000-000000000003', name: 'Side Dishes',  nameEs: 'Guarniciones',       slug: 'side-dishes',  sortOrder: 2 },
    { id: '00000000-0000-4000-d000-000000000004', name: 'Desserts',     nameEs: 'Postres',            slug: 'desserts',     sortOrder: 3 },
    { id: '00000000-0000-4000-d000-000000000005', name: 'Beverages',    nameEs: 'Bebidas',            slug: 'beverages',    sortOrder: 4 },
    { id: '00000000-0000-4000-d000-000000000006', name: 'Snacks',       nameEs: 'Tentempiés',         slug: 'snacks',       sortOrder: 5 },
    { id: '00000000-0000-4000-d000-000000000007', name: 'Salads',       nameEs: 'Ensaladas',          slug: 'salads',       sortOrder: 6 },
    { id: '00000000-0000-4000-d000-000000000008', name: 'Soups',        nameEs: 'Sopas',              slug: 'soups',        sortOrder: 7 },
  ];

  for (const dc of dishCategories) {
    await prisma.dishCategory.upsert({
      where: { slug: dc.slug },
      update: { name: dc.name, nameEs: dc.nameEs, sortOrder: dc.sortOrder },
      create: { id: dc.id, name: dc.name, nameEs: dc.nameEs, slug: dc.slug, sortOrder: dc.sortOrder },
    });
  }
  console.log('Dish categories upserted');

  // ---------------------------------------------------------------------------
  // Restaurants
  // ---------------------------------------------------------------------------
  const restaurantMcDonaldsES = await prisma.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'mcdonalds', countryCode: 'ES' } },
    update: {},
    create: {
      id: '00000000-0000-0000-0006-000000000001',
      name: "McDonald's Spain",
      nameEs: "McDonald's España",
      chainSlug: 'mcdonalds',
      countryCode: 'ES',
      website: 'https://www.mcdonalds.es',
      isActive: true,
    },
  });

  await prisma.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'mcdonalds', countryCode: 'PT' } },
    update: {},
    create: {
      id: '00000000-0000-0000-0006-000000000002',
      name: "McDonald's Portugal",
      nameEs: "McDonald's Portugal",
      chainSlug: 'mcdonalds',
      countryCode: 'PT',
      website: 'https://www.mcdonalds.pt',
      isActive: true,
    },
  });

  console.log('Restaurants upserted');

  // ---------------------------------------------------------------------------
  // Dishes
  // ---------------------------------------------------------------------------
  const dishBigMac = await prisma.dish.upsert({
    where: { id: '00000000-0000-0000-0007-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0007-000000000001',
      restaurantId: restaurantMcDonaldsES.id,
      foodId: foodBigMac.id,
      sourceId: dataSource.id,
      name: 'Big Mac',
      nameEs: 'Big Mac',
      availability: 'available',
      confidenceLevel: 'medium',
      estimationMethod: 'scraped',
      aliases: ['big mac', 'bigmac'],
      externalId: 'MCES-BIGMAC',
    },
  });

  await prisma.$executeRaw`
    UPDATE dishes SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${dishBigMac.id}::uuid
  `;

  const dishMcChicken = await prisma.dish.upsert({
    where: { id: '00000000-0000-0000-0007-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0007-000000000002',
      restaurantId: restaurantMcDonaldsES.id,
      foodId: null,
      sourceId: dataSource.id,
      name: 'McChicken',
      nameEs: 'McPollo',
      availability: 'available',
      confidenceLevel: 'low',
      estimationMethod: 'scraped',
      aliases: ['mcchicken', 'mc chicken'],
      externalId: 'MCES-MCCHICKEN',
    },
  });

  await prisma.$executeRaw`
    UPDATE dishes SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${dishMcChicken.id}::uuid
  `;

  console.log('Dishes upserted: Big Mac, McChicken');

  // ---------------------------------------------------------------------------
  // DishNutrients
  // ---------------------------------------------------------------------------
  await prisma.dishNutrient.upsert({
    where: { dishId_sourceId: { dishId: dishBigMac.id, sourceId: dataSource.id } },
    update: {},
    create: {
      id: '00000000-0000-0000-0008-000000000001',
      dishId: dishBigMac.id,
      calories: 563,
      proteins: 26,
      carbohydrates: 44,
      sugars: 9,
      fats: 30,
      saturatedFats: 11,
      fiber: 3,
      salt: 1.7,
      sodium: 0.68,
      referenceBasis: 'per_serving',
      estimationMethod: 'scraped',
      sourceId: dataSource.id,
      confidenceLevel: 'medium',
    },
  });

  await prisma.dishNutrient.upsert({
    where: { dishId_sourceId: { dishId: dishMcChicken.id, sourceId: dataSource.id } },
    update: {},
    create: {
      id: '00000000-0000-0000-0008-000000000002',
      dishId: dishMcChicken.id,
      calories: 400,
      proteins: 17,
      carbohydrates: 41,
      sugars: 6,
      fats: 17,
      saturatedFats: 3,
      fiber: 2,
      salt: 1.2,
      sodium: 0.48,
      referenceBasis: 'per_serving',
      estimationMethod: 'scraped',
      sourceId: dataSource.id,
      confidenceLevel: 'low',
    },
  });

  console.log('DishNutrients upserted');

  // ---------------------------------------------------------------------------
  // Junction rows: dish ↔ cooking_method, dish ↔ dish_category
  // ---------------------------------------------------------------------------
  const cmGrilledId = '00000000-0000-4000-c000-000000000001';
  const cmFriedId   = '00000000-0000-4000-c000-000000000003';
  const dcMainId    = '00000000-0000-4000-d000-000000000002';

  await prisma.dishCookingMethod.upsert({
    where: { dishId_cookingMethodId: { dishId: dishBigMac.id, cookingMethodId: cmGrilledId } },
    update: {},
    create: { dishId: dishBigMac.id, cookingMethodId: cmGrilledId },
  });

  await prisma.dishDishCategory.upsert({
    where: { dishId_dishCategoryId: { dishId: dishBigMac.id, dishCategoryId: dcMainId } },
    update: {},
    create: { dishId: dishBigMac.id, dishCategoryId: dcMainId },
  });

  await prisma.dishCookingMethod.upsert({
    where: { dishId_cookingMethodId: { dishId: dishMcChicken.id, cookingMethodId: cmFriedId } },
    update: {},
    create: { dishId: dishMcChicken.id, cookingMethodId: cmFriedId },
  });

  await prisma.dishDishCategory.upsert({
    where: { dishId_dishCategoryId: { dishId: dishMcChicken.id, dishCategoryId: dcMainId } },
    update: {},
    create: { dishId: dishMcChicken.id, dishCategoryId: dcMainId },
  });

  console.log('Junction rows upserted: cooking methods & categories for dishes');
  console.log('Phase 1 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 2 — USDA SR Legacy Base Foods
  // ---------------------------------------------------------------------------
  await seedPhase2(prisma);

  // ---------------------------------------------------------------------------
  // Phase 3 — PDF Chain Restaurant + DataSource rows
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 3 seed: PDF chain restaurants + data sources...');
  await seedPhase3(prisma);
  console.log('Phase 3 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 4 — Image Chain Restaurant + DataSource rows (Domino's Spain)
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 4 seed: image chain restaurants + data sources...');
  await seedPhase4(prisma);
  console.log('Phase 4 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 5 — PDF Chain Restaurant + DataSource rows (Subway Spain)
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 5 seed: Subway Spain restaurant + data source...');
  await seedPhase5(prisma);
  console.log('Phase 5 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 6 — PDF Chain Restaurant + DataSource rows (Pans & Company Spain)
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 6 seed: Pans & Company Spain restaurant + data source...');
  await seedPhase6(prisma);
  console.log('Phase 6 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 7 — PDF Chain Restaurants: Popeyes, Papa John's, Pizza Hut,
  //           Starbucks, Tim Hortons (Spain)
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 7 seed: Popeyes, Papa John\'s, Pizza Hut, Starbucks, Tim Hortons...');
  await seedPhase7(prisma);
  console.log('Phase 7 seeding complete.');

  // ---------------------------------------------------------------------------
  // Phase 8 — Telegram Upload DataSource (F032)
  // ---------------------------------------------------------------------------
  console.log('Starting Phase 8 seed: Telegram Upload DataSource...');
  await seedPhase8(prisma);
  console.log('Phase 8 seeding complete.');

  console.log('Seeding complete.');
}

// ---------------------------------------------------------------------------
// Phase 2: USDA SR Legacy foods — exported for integration testing
// ---------------------------------------------------------------------------

/** Chunk array into sub-arrays of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Retry helper: calls fn once; on failure warns and retries. Throws on second failure. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`${label} failed (attempt 1):`, err, 'Retrying...');
    return fn();
  }
}

export async function seedPhase2(client: PrismaClient): Promise<void> {
  // Step A — Load data files
  const seedDataDir = dirname(fileURLToPath(import.meta.url)) + '/seed-data';
  const foods = JSON.parse(
    readFileSync(`${seedDataDir}/usda-sr-legacy-foods.json`, 'utf8'),
  ) as UsdaSrLegacyFoodEntry[];
  const nameEsMap = JSON.parse(
    readFileSync(`${seedDataDir}/name-es-map.json`, 'utf8'),
  ) as NameEsMap;

  // Step B — Pre-write validation
  const validation = validateSeedData(foods, nameEsMap);
  if (!validation.valid) {
    for (const err of validation.errors) {
      if (err.startsWith('[WARN]')) {
        console.warn(err);
      } else {
        console.error(err);
      }
    }
    throw new Error('Seed data validation failed. See errors above.');
  }
  // Log any warnings even when valid
  for (const err of validation.errors) {
    if (err.startsWith('[WARN]')) console.warn(err);
  }

  // Step C — Upsert SR Legacy DataSource
  const srLegacySourceId = '00000000-0000-0000-0000-000000000002';
  await client.dataSource.upsert({
    where: { id: srLegacySourceId },
    update: {},
    create: {
      id: srLegacySourceId,
      name: 'USDA SR Legacy',
      type: 'official',
      url: 'https://fdc.nal.usda.gov/download-foods.html',
      lastUpdated: new Date('2021-10-28'),
    },
  });
  console.log('SR Legacy DataSource upserted.');

  // Step D — Upsert group-level StandardPortions (14 rows)
  const standardPortions = [
    { id: '00000000-0000-0000-0009-000000000001', foodGroup: 'Vegetables',    context: 'side_dish',   portionGrams: 80,  description: 'Standard vegetable side portion (80g)' },
    { id: '00000000-0000-0000-0009-000000000002', foodGroup: 'Fruits',        context: 'snack',       portionGrams: 120, description: 'Standard fruit portion (120g)' },
    { id: '00000000-0000-0000-0009-000000000003', foodGroup: 'Meat',          context: 'main_course', portionGrams: 150, description: 'Standard meat main course portion (150g)' },
    { id: '00000000-0000-0000-0009-000000000004', foodGroup: 'Poultry',       context: 'main_course', portionGrams: 150, description: 'Standard poultry main course portion (150g)' },
    { id: '00000000-0000-0000-0009-000000000005', foodGroup: 'Fish',          context: 'main_course', portionGrams: 150, description: 'Standard fish main course portion (150g)' },
    { id: '00000000-0000-0000-0009-000000000006', foodGroup: 'Dairy',         context: 'snack',       portionGrams: 125, description: 'Standard dairy portion (125g)' },
    { id: '00000000-0000-0000-0009-000000000007', foodGroup: 'Eggs',          context: 'main_course', portionGrams: 55,  description: 'Standard egg portion (55g, ~1 large egg)' },
    { id: '00000000-0000-0000-0009-000000000008', foodGroup: 'Legumes',       context: 'side_dish',   portionGrams: 80,  description: 'Standard legume side portion (80g)' },
    { id: '00000000-0000-0000-0009-000000000009', foodGroup: 'Cereals',       context: 'side_dish',   portionGrams: 75,  description: 'Standard cereal side portion (75g, dry)' },
    { id: '00000000-0000-0000-0009-000000000010', foodGroup: 'Nuts',          context: 'snack',       portionGrams: 30,  description: 'Standard nut snack portion (30g)' },
    { id: '00000000-0000-0000-0009-000000000011', foodGroup: 'Fats and oils', context: 'snack',       portionGrams: 10,  description: 'Standard fat/oil portion (10g)' },
    { id: '00000000-0000-0000-0009-000000000012', foodGroup: 'Sweets',        context: 'dessert',     portionGrams: 50,  description: 'Standard sweet dessert portion (50g)' },
    { id: '00000000-0000-0000-0009-000000000013', foodGroup: 'Snacks',        context: 'snack',       portionGrams: 30,  description: 'Standard snack portion (30g)' },
    { id: '00000000-0000-0000-0009-000000000014', foodGroup: 'Beverages',     context: 'snack',       portionGrams: 200, description: 'Standard beverage portion (200ml)' },
  ] as const;

  for (const sp of standardPortions) {
    await client.standardPortion.upsert({
      where: { id: sp.id },
      update: { description: sp.description },
      create: {
        id: sp.id,
        foodId: null,
        foodGroup: sp.foodGroup,
        context: sp.context,
        portionGrams: sp.portionGrams,
        sourceId: srLegacySourceId,
        confidenceLevel: 'high',
        description: sp.description,
        isDefault: false,
      },
    });
  }
  console.log('Phase 2: 14 group-level StandardPortions upserted.');

  // Step E — Batch processing loop (50 foods per batch)
  const batches = chunk(foods, 50);
  console.log(
    `Phase 2: Processing ${foods.length} SR Legacy foods in ${batches.length} batches...`,
  );

  let hasBatchFailure = false;

  for (let i = 0; i < batches.length; i++) {
    const batchFoods = batches[i] ?? [];
    const label = `Batch ${i + 1}/${batches.length}`;

    try {
      await withRetry(async () => {
        // Transaction 1 — Upsert Foods
        const upsertedFoods = await client.$transaction(
          batchFoods.map((food) =>
            client.food.upsert({
              where: {
                externalId_sourceId: {
                  externalId: buildExternalId(food.fdcId),
                  sourceId: srLegacySourceId,
                },
              },
              update: {
                name: food.description,
                // validated above — all fdcIds have Spanish names
                nameEs: nameEsMap[String(food.fdcId)]!,
                foodGroup: food.foodGroup,
                aliases: [],
              },
              create: {
                name: food.description,
                // validated above — all fdcIds have Spanish names
                nameEs: nameEsMap[String(food.fdcId)]!,
                aliases: [],
                foodGroup: food.foodGroup,
                sourceId: srLegacySourceId,
                externalId: buildExternalId(food.fdcId),
                confidenceLevel: 'high',
                foodType: 'generic',
              },
            }),
          ),
        );

        // Set zero-vector embeddings (cannot be included in $transaction)
        for (const food of upsertedFoods) {
          await client.$executeRaw`
            UPDATE foods SET embedding = ${ZERO_VECTOR}::vector WHERE id = ${food.id}::uuid
          `;
        }

        // Transaction 2 — Upsert FoodNutrients
        await client.$transaction(
          upsertedFoods.map((food, idx) => {
            const srcFood = batchFoods[idx]!;
            const n = srcFood.nutrients;
            return client.foodNutrient.upsert({
              where: {
                foodId_sourceId: {
                  foodId: food.id,
                  sourceId: srLegacySourceId,
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
                sodium: n.sodium,
                salt: n.salt,
                transFats: n.transFats,
                cholesterol: n.cholesterol,
                potassium: n.potassium,
                monounsaturatedFats: n.monounsaturatedFats,
                polyunsaturatedFats: n.polyunsaturatedFats,
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
                sodium: n.sodium,
                salt: n.salt,
                transFats: n.transFats,
                cholesterol: n.cholesterol,
                potassium: n.potassium,
                monounsaturatedFats: n.monounsaturatedFats,
                polyunsaturatedFats: n.polyunsaturatedFats,
                sourceId: srLegacySourceId,
                confidenceLevel: 'high',
              },
            });
          }),
        );
      }, label);

      console.log(`${label} complete`);
    } catch (err) {
      console.error(`${label} failed permanently:`, err, '. Skipping.');
      hasBatchFailure = true;
    }
  }

  console.log('Phase 2 complete.');

  if (hasBatchFailure) {
    throw new Error('One or more batches failed permanently. See errors above.');
  }
}

// ---------------------------------------------------------------------------
// Phase 3: PDF chain restaurants + dataSource rows — exported for integration testing
// ---------------------------------------------------------------------------

export async function seedPhase3(client: PrismaClient): Promise<void> {
  // Burger King Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID,
      name:        'Burger King Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf',
      lastUpdated: new Date('2026-03-13'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'burger-king-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID,
      name:        'Burger King Spain',
      nameEs:      'Burger King España',
      chainSlug:   'burger-king-es',
      countryCode: 'ES',
      website:     'https://www.burgerking.es',
      isActive:    true,
    },
  });

  // KFC Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.KFC_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.KFC_ES.SOURCE_ID,
      name:        'KFC Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://static.kfc.es/pdf/contenido-nutricional.pdf',
      lastUpdated: new Date('2026-03-13'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'kfc-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID,
      name:        'KFC Spain',
      nameEs:      'KFC España',
      chainSlug:   'kfc-es',
      countryCode: 'ES',
      website:     'https://www.kfc.es',
      isActive:    true,
    },
  });

  // Telepizza Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID,
      name:        'Telepizza Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://statices.telepizza.com/static/on/demandware.static/-/Sites-TelepizzaES-Library/default/dw21878fcd/documents/nutricion.pdf',
      lastUpdated: new Date('2026-03-13'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'telepizza-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID,
      name:        'Telepizza Spain',
      nameEs:      'Telepizza España',
      chainSlug:   'telepizza-es',
      countryCode: 'ES',
      website:     'https://www.telepizza.es',
      isActive:    true,
    },
  });

  // Five Guys Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
      name:        'Five Guys Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf',
      lastUpdated: new Date('2026-03-13'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'five-guys-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
      name:        'Five Guys Spain',
      nameEs:      'Five Guys España',
      chainSlug:   'five-guys-es',
      countryCode: 'ES',
      website:     'https://www.fiveguys.es',
      isActive:    true,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 4: Image chain restaurants + dataSource rows — exported for integration testing
// ---------------------------------------------------------------------------

export async function seedPhase4(client: PrismaClient): Promise<void> {
  // Domino's Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID,
      name:        "Domino's Spain — Official Nutritional Images",
      type:        'scraped',
      url:         'https://alergenos.dominospizza.es/img/',
      lastUpdated: new Date('2026-03-16'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'dominos-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID,
      name:        "Domino's Spain",
      nameEs:      "Domino's España",
      chainSlug:   'dominos-es',
      countryCode: 'ES',
      website:     'https://www.dominospizza.es',
      isActive:    true,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 5: Subway Spain PDF chain — exported for integration testing
// ---------------------------------------------------------------------------

export async function seedPhase5(client: PrismaClient): Promise<void> {
  // Subway Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID,
      name:        'Subway Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://subwayspain.com/images/pdfs/nutricional/MED_Nutritional_Information_C4_2025_FINAL_English.pdf',
      lastUpdated: new Date('2026-03-16'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'subway-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID,
      name:        'Subway Spain',
      nameEs:      'Subway España',
      chainSlug:   'subway-es',
      countryCode: 'ES',
      website:     'https://subwayspain.com',
      isActive:    true,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 6: Pans & Company Spain — exported for integration testing
// ---------------------------------------------------------------------------

export async function seedPhase6(client: PrismaClient): Promise<void> {
  // Pans & Company Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID,
      name:        'Pans & Company Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://www.vivabem.pt/tabelas/tabela_pans_company.pdf',
      lastUpdated: new Date('2026-03-17'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'pans-and-company-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID,
      name:        'Pans & Company Spain',
      nameEs:      'Pans & Company España',
      chainSlug:   'pans-and-company-es',
      countryCode: 'ES',
      website:     'https://www.pansandcompany.com',
      isActive:    true,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 7: Popeyes, Papa John's, Pizza Hut, Starbucks, Tim Hortons (Spain)
// ---------------------------------------------------------------------------

export async function seedPhase7(client: PrismaClient): Promise<void> {
  // Popeyes Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.POPEYES_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.POPEYES_ES.SOURCE_ID,
      name:        'Popeyes Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://popeyes-prod.s3.eu-west-1.amazonaws.com/Nutricional_alergenos_Ed_00_Octubre_2021.pdf',
      lastUpdated: new Date('2026-03-23'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'popeyes-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.POPEYES_ES.RESTAURANT_ID,
      name:        'Popeyes Spain',
      nameEs:      'Popeyes España',
      chainSlug:   'popeyes-es',
      countryCode: 'ES',
      website:     'https://www.popeyes.es',
      isActive:    true,
    },
  });

  // Papa John's Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.PAPA_JOHNS_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PAPA_JOHNS_ES.SOURCE_ID,
      name:        "Papa John's Spain — Nutritional PDF",
      type:        'scraped',
      url:         'https://cdn.new.papajohns.es/Alergenos+Espa%C3%B1a/Inf_NutricionalEspa%C3%B1a+Ed+27.pdf',
      lastUpdated: new Date('2026-03-23'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'papa-johns-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PAPA_JOHNS_ES.RESTAURANT_ID,
      name:        "Papa John's Spain",
      nameEs:      "Papa John's España",
      chainSlug:   'papa-johns-es',
      countryCode: 'ES',
      website:     'https://www.papajohns.es',
      isActive:    true,
    },
  });

  // Pizza Hut Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.PIZZA_HUT_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PIZZA_HUT_ES.SOURCE_ID,
      name:        'Pizza Hut Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://s4d-mth-prd-01-ph-es-ecom-cms-cdne.azureedge.net/ecom-cms/assets/nutricion_ph26_89a1ae2af8.pdf',
      lastUpdated: new Date('2026-03-23'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'pizza-hut-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.PIZZA_HUT_ES.RESTAURANT_ID,
      name:        'Pizza Hut Spain',
      nameEs:      'Pizza Hut España',
      chainSlug:   'pizza-hut-es',
      countryCode: 'ES',
      website:     'https://www.pizzahut.es',
      isActive:    true,
    },
  });

  // Starbucks Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.STARBUCKS_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.STARBUCKS_ES.SOURCE_ID,
      name:        'Starbucks Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://www.starbucks.es/sites/starbucks-es-pwa/files/2025-03/250306%20FOOD%20Info%20nutricional%20x%20100g%20%20Spring%20-ESP%20V1.pdf',
      lastUpdated: new Date('2026-03-23'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'starbucks-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.STARBUCKS_ES.RESTAURANT_ID,
      name:        'Starbucks Spain',
      nameEs:      'Starbucks España',
      chainSlug:   'starbucks-es',
      countryCode: 'ES',
      website:     'https://www.starbucks.es',
      isActive:    true,
    },
  });

  // Tim Hortons Spain
  await client.dataSource.upsert({
    where: { id: CHAIN_SEED_IDS.TIM_HORTONS_ES.SOURCE_ID },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.TIM_HORTONS_ES.SOURCE_ID,
      name:        'Tim Hortons Spain — Nutritional PDF',
      type:        'scraped',
      url:         'https://www.tim-hortons.es/docs/Nutricionales.TH.ES.pdf',
      lastUpdated: new Date('2026-03-23'),
    },
  });

  await client.restaurant.upsert({
    where: { chainSlug_countryCode: { chainSlug: 'tim-hortons-es', countryCode: 'ES' } },
    update: {},
    create: {
      id:          CHAIN_SEED_IDS.TIM_HORTONS_ES.RESTAURANT_ID,
      name:        'Tim Hortons Spain',
      nameEs:      'Tim Hortons España',
      chainSlug:   'tim-hortons-es',
      countryCode: 'ES',
      website:     'https://www.tim-hortons.es',
      isActive:    true,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 8: Telegram Upload DataSource — exported for integration testing
// ---------------------------------------------------------------------------

export async function seedPhase8(client: PrismaClient): Promise<void> {
  await client.dataSource.upsert({
    where: { id: '00000000-0000-0000-0000-000000000099' },
    update: {},
    create: {
      id:   '00000000-0000-0000-0000-000000000099',
      name: 'Telegram Upload',
      type: 'user',
      url:  null,
    },
  });
  console.log('Phase 8: Telegram Upload DataSource upserted.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
