// checkDataGaps — check function #3
//
// Coverage metrics for optional fields on Dish rows, and restaurants with no dishes.
// These are not errors but inform the estimation engine about missing portion context.
//
// NOTE: restaurantsWithoutDishes is a global metric only.
// When chainSlug is provided, it returns 0 (chains that appear in scope by definition
// have at least one restaurant row).

import type { PrismaClient } from '@prisma/client';
import type { QualityDataGapsResult } from './types.js';

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkDataGaps(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityDataGapsResult> {
  const dishWhere =
    scope.chainSlug !== undefined
      ? { restaurant: { chainSlug: scope.chainSlug } }
      : {};

  const [dishesWithoutPortionGrams, dishesWithoutPriceEur] = await Promise.all([
    prisma.dish.count({
      where: {
        ...dishWhere,
        portionGrams: null,
      },
    }),
    prisma.dish.count({
      where: {
        ...dishWhere,
        priceEur: null,
      },
    }),
  ]);

  // restaurantsWithoutDishes is only meaningful at global scope.
  // When a chainSlug is provided, return 0.
  let restaurantsWithoutDishes = 0;
  if (scope.chainSlug === undefined) {
    restaurantsWithoutDishes = await prisma.restaurant.count({
      where: { dishes: { none: {} } },
    });
  }

  return {
    dishesWithoutPortionGrams,
    dishesWithoutPriceEur,
    restaurantsWithoutDishes,
  };
}
