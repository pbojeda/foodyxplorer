// checkNutrientCompleteness — check function #1
//
// Counts dishes missing DishNutrient rows, ghost rows (all-zero macros),
// and zero-calorie nutrient rows. Groups results by chain.

import type { PrismaClient } from '@prisma/client';
import type { QualityNutrientCompletenessResult } from './types.js';

// ---------------------------------------------------------------------------
// Scope helper
// ---------------------------------------------------------------------------

function buildDishWhere(chainSlug?: string): Record<string, unknown> {
  if (chainSlug === undefined) return {};
  return { restaurant: { chainSlug } };
}

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkNutrientCompleteness(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityNutrientCompletenessResult> {
  const dishWhere = buildDishWhere(scope.chainSlug);

  const [totalDishes, dishesWithoutNutrients, ghostRowCount, zeroCaloriesCount] =
    await Promise.all([
      prisma.dish.count({ where: dishWhere }),
      prisma.dish.count({
        where: {
          ...dishWhere,
          nutrients: { none: {} },
        },
      }),
      prisma.dishNutrient.count({
        where: {
          ...(scope.chainSlug !== undefined
            ? { dish: { restaurant: { chainSlug: scope.chainSlug } } }
            : {}),
          calories: { equals: 0 },
          proteins: { equals: 0 },
          carbohydrates: { equals: 0 },
          fats: { equals: 0 },
        },
      }),
      prisma.dishNutrient.count({
        where: {
          ...(scope.chainSlug !== undefined
            ? { dish: { restaurant: { chainSlug: scope.chainSlug } } }
            : {}),
          calories: { equals: 0 },
        },
      }),
    ]);

  const dishesWithoutNutrientsPercent =
    totalDishes > 0
      ? parseFloat(((dishesWithoutNutrients / totalDishes) * 100).toFixed(2))
      : 0;

  // byChain: fetch restaurants with dish counts
  const restaurants = await prisma.restaurant.findMany({
    where: scope.chainSlug !== undefined ? { chainSlug: scope.chainSlug } : {},
    select: {
      chainSlug: true,
      _count: { select: { dishes: true } },
      dishes: {
        select: {
          id: true,
          nutrients: { select: { id: true } },
        },
      },
    },
  });

  // Aggregate by chainSlug (multiple restaurants can share the same chainSlug)
  const chainMap = new Map<
    string,
    { dishesWithoutNutrients: number; totalDishes: number }
  >();

  for (const restaurant of restaurants) {
    const existing = chainMap.get(restaurant.chainSlug) ?? {
      dishesWithoutNutrients: 0,
      totalDishes: 0,
    };

    const withoutNutrients = restaurant.dishes.filter(
      (d) => d.nutrients.length === 0,
    ).length;

    chainMap.set(restaurant.chainSlug, {
      dishesWithoutNutrients: existing.dishesWithoutNutrients + withoutNutrients,
      totalDishes: existing.totalDishes + restaurant.dishes.length,
    });
  }

  // Ghost rows and zero calories per chain need separate queries
  const byChainEntries = await Promise.all(
    Array.from(chainMap.entries()).map(async ([chainSlug, counts]) => {
      const [chainGhostCount, chainZeroCalories] = await Promise.all([
        prisma.dishNutrient.count({
          where: {
            dish: { restaurant: { chainSlug } },
            calories: { equals: 0 },
            proteins: { equals: 0 },
            carbohydrates: { equals: 0 },
            fats: { equals: 0 },
          },
        }),
        prisma.dishNutrient.count({
          where: {
            dish: { restaurant: { chainSlug } },
            calories: { equals: 0 },
          },
        }),
      ]);

      return {
        chainSlug,
        dishesWithoutNutrients: counts.dishesWithoutNutrients,
        ghostRowCount: chainGhostCount,
        zeroCaloriesCount: chainZeroCalories,
      };
    }),
  );

  return {
    dishesWithNutrients: totalDishes - dishesWithoutNutrients,
    dishesWithoutNutrients,
    dishesWithoutNutrientsPercent,
    ghostRowCount,
    zeroCaloriesCount,
    byChain: byChainEntries,
  };
}
