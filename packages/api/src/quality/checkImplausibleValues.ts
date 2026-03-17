// checkImplausibleValues — check function #2
//
// Detects nutrient rows with implausible or suspicious values:
// - calories > 5000 (above monitoring threshold)
// - ghost rows (all four core macros are exactly 0)
// - suspiciously round calories (>= 100 AND divisible by 100)

import type { PrismaClient } from '@prisma/client';
import type { QualityImplausibleValuesResult, QualityImplausibleValuesChain } from './types.js';

const CALORIES_THRESHOLD = 5000 as const;

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkImplausibleValues(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityImplausibleValuesResult> {
  const where =
    scope.chainSlug !== undefined
      ? { dish: { restaurant: { chainSlug: scope.chainSlug } } }
      : {};

  const rows = await prisma.dishNutrient.findMany({
    where,
    include: {
      dish: {
        include: { restaurant: true },
      },
    },
  });

  // Track global counters and per-chain data
  let caloriesAboveThreshold = 0;
  let ghostRows = 0;
  let suspiciouslyRoundCalories = 0;

  const chainMap = new Map<
    string,
    { caloriesAboveThreshold: number; ghostRows: number; suspiciouslyRoundCalories: number }
  >();

  for (const row of rows) {
    const cal = row.calories.toNumber();
    const prot = row.proteins.toNumber();
    const carb = row.carbohydrates.toNumber();
    const fat = row.fats.toNumber();

    const chainSlug = row.dish.restaurant.chainSlug;

    const chainEntry = chainMap.get(chainSlug) ?? {
      caloriesAboveThreshold: 0,
      ghostRows: 0,
      suspiciouslyRoundCalories: 0,
    };

    // calories > 5000
    if (cal > CALORIES_THRESHOLD) {
      caloriesAboveThreshold++;
      chainEntry.caloriesAboveThreshold++;
    }

    // ghost row: all four macros === 0
    if (cal === 0 && prot === 0 && carb === 0 && fat === 0) {
      ghostRows++;
      chainEntry.ghostRows++;
    }

    // suspiciously round: >= 100 AND divisible by 100
    if (cal >= 100 && cal % 100 === 0) {
      suspiciouslyRoundCalories++;
      chainEntry.suspiciouslyRoundCalories++;
    }

    chainMap.set(chainSlug, chainEntry);
  }

  const byChain: QualityImplausibleValuesChain[] = Array.from(
    chainMap.entries(),
  ).map(([chainSlug, counts]) => ({ chainSlug, ...counts }));

  return {
    caloriesAboveThreshold,
    ghostRows,
    suspiciouslyRoundCalories,
    caloriesThreshold: CALORIES_THRESHOLD,
    byChain,
  };
}
