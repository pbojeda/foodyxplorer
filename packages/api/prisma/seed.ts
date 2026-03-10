// Seed script for foodXPlorer dev database
// Inserts baseline reference data: data sources, foods, food nutrients, standard portions
// Run with: npm run db:seed -w @foodxplorer/api

import { PrismaClient } from '@prisma/client';

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

  // ---------------------------------------------------------------------------
  // Foods
  // ---------------------------------------------------------------------------
  const foodChicken = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000001',
      name: 'Chicken breast',
      nameEs: 'Pechuga de pollo',
      aliases: ['chicken', 'poultry', 'hen breast'],
      foodGroup: 'Meat',
      sourceId: dataSource.id,
      externalId: 'USDA-171077',
      confidenceLevel: 'high',
    },
  });

  const foodRice = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000002',
      name: 'White rice, cooked',
      nameEs: 'Arroz blanco cocido',
      aliases: ['rice', 'boiled rice'],
      foodGroup: 'Cereals',
      sourceId: dataSource.id,
      externalId: 'USDA-168878',
      confidenceLevel: 'high',
    },
  });

  const foodOliveOil = await prisma.food.upsert({
    where: { id: '00000000-0000-0000-0001-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0001-000000000003',
      name: 'Olive oil',
      nameEs: 'Aceite de oliva',
      aliases: ['EVOO', 'extra virgin olive oil'],
      foodGroup: 'Fats and oils',
      sourceId: dataSource.id,
      externalId: 'USDA-171413',
      confidenceLevel: 'high',
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
    update: {},
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
    update: {},
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
    update: {},
    create: {
      id: '00000000-0000-0000-0003-000000000001',
      foodId: foodChicken.id,
      foodGroup: null,
      context: 'main_course',
      portionGrams: 150,
      sourceId: dataSource.id,
      notes: 'Typical main course serving of chicken breast',
      confidenceLevel: 'high',
    },
  });

  await prisma.standardPortion.upsert({
    where: { id: '00000000-0000-0000-0003-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0003-000000000002',
      foodId: foodRice.id,
      foodGroup: null,
      context: 'side_dish',
      portionGrams: 80,
      sourceId: dataSource.id,
      notes: 'Standard side dish serving of rice',
      confidenceLevel: 'medium',
    },
  });

  await prisma.standardPortion.upsert({
    where: { id: '00000000-0000-0000-0003-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0003-000000000003',
      foodId: null,
      foodGroup: 'Cereals',
      context: 'side_dish',
      portionGrams: 75,
      sourceId: dataSource.id,
      notes: 'Default side dish portion for cereal food group',
      confidenceLevel: 'low',
    },
  });

  console.log('StandardPortions created');
  console.log('Seeding complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
