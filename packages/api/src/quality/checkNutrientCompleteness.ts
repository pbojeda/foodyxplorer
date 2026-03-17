// checkNutrientCompleteness — check function #1
//
// Counts dishes missing DishNutrient rows, ghost rows (all-zero macros),
// and zero-calorie nutrient rows. Groups results by chain.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
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

  // byChain: single raw SQL query for all per-chain metrics (no N+1)
  const chainFilter =
    scope.chainSlug !== undefined
      ? Prisma.sql`WHERE r.chain_slug = ${scope.chainSlug}`
      : Prisma.empty;

  const byChainRows = await prisma.$queryRaw<
    Array<{
      chain_slug: string;
      total_dishes: bigint;
      without_nutrients: bigint;
      ghost_count: bigint;
      zero_calories: bigint;
    }>
  >(
    Prisma.sql`
      SELECT
        r.chain_slug,
        COUNT(DISTINCT d.id)::bigint AS total_dishes,
        COUNT(DISTINCT d.id) FILTER (WHERE dn.id IS NULL)::bigint AS without_nutrients,
        COUNT(DISTINCT dn.id) FILTER (WHERE dn.calories = 0 AND dn.proteins = 0 AND dn.carbohydrates = 0 AND dn.fats = 0)::bigint AS ghost_count,
        COUNT(DISTINCT dn.id) FILTER (WHERE dn.calories = 0)::bigint AS zero_calories
      FROM restaurants r
      JOIN dishes d ON d.restaurant_id = r.id
      LEFT JOIN dish_nutrients dn ON dn.dish_id = d.id
      ${chainFilter}
      GROUP BY r.chain_slug
    `,
  );

  const byChain = byChainRows.map((row) => ({
    chainSlug: row.chain_slug,
    dishesWithoutNutrients: Number(row.without_nutrients),
    ghostRowCount: Number(row.ghost_count),
    zeroCaloriesCount: Number(row.zero_calories),
  }));

  return {
    dishesWithNutrients: totalDishes - dishesWithoutNutrients,
    dishesWithoutNutrients,
    dishesWithoutNutrientsPercent,
    ghostRowCount,
    zeroCaloriesCount,
    byChain,
  };
}
