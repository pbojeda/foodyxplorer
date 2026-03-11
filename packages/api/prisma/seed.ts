// Seed script for foodXPlorer dev database
// Inserts baseline reference data: data sources, foods, food nutrients, standard portions, recipes
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
