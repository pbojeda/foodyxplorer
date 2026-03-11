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
