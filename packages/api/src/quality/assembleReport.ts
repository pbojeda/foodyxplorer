// assembleReport — calls all six check functions in parallel and merges results.
//
// Computes chainSummary[] from byChain results of checks 1, 2, and 4 — no extra
// DB queries needed. Any single check rejection rejects the entire assembly
// (no partial results per Edge Case #10).

import type { PrismaClient } from '@prisma/client';
import type { QualityReportData, QualityChainSummary } from './types.js';
import { checkNutrientCompleteness } from './checkNutrientCompleteness.js';
import { checkImplausibleValues } from './checkImplausibleValues.js';
import { checkDataGaps } from './checkDataGaps.js';
import { checkDuplicates } from './checkDuplicates.js';
import { checkConfidenceDistribution } from './checkConfidenceDistribution.js';
import { checkDataFreshness } from './checkDataFreshness.js';

// ---------------------------------------------------------------------------
// assembleReport
// ---------------------------------------------------------------------------

export async function assembleReport(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
  stalenessThresholdDays: number,
): Promise<QualityReportData> {
  const [
    totalDishes,
    totalRestaurants,
    nutrientCompleteness,
    implausibleValues,
    dataGaps,
    duplicates,
    confidenceDistribution,
    dataFreshness,
  ] = await Promise.all([
    prisma.dish.count({
      where:
        scope.chainSlug !== undefined
          ? { restaurant: { chainSlug: scope.chainSlug } }
          : {},
    }),
    prisma.restaurant.count({
      where:
        scope.chainSlug !== undefined ? { chainSlug: scope.chainSlug } : {},
    }),
    checkNutrientCompleteness(prisma, scope),
    checkImplausibleValues(prisma, scope),
    checkDataGaps(prisma, scope),
    checkDuplicates(prisma, scope),
    checkConfidenceDistribution(prisma, scope),
    checkDataFreshness(prisma, scope, stalenessThresholdDays),
  ]);

  // Compute chainSummary from byChain results (no extra DB queries)
  // Sources: nutrientCompleteness.byChain, implausibleValues.byChain, duplicates.groups
  const chainMap = new Map<
    string,
    {
      totalDishes: number;
      dishesWithoutNutrients: number;
      ghostRowCount: number;
      caloriesAboveThreshold: number;
      totalDuplicateDishes: number;
    }
  >();

  const getOrCreate = (slug: string) => {
    if (!chainMap.has(slug)) {
      chainMap.set(slug, {
        totalDishes: 0,
        dishesWithoutNutrients: 0,
        ghostRowCount: 0,
        caloriesAboveThreshold: 0,
        totalDuplicateDishes: 0,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- slug was just inserted via set()
    return chainMap.get(slug)!;
  };

  // Nutrient completeness byChain
  for (const entry of nutrientCompleteness.byChain) {
    const record = getOrCreate(entry.chainSlug);
    record.dishesWithoutNutrients += entry.dishesWithoutNutrients;
    record.ghostRowCount += entry.ghostRowCount;
  }

  // Implausible values byChain
  for (const entry of implausibleValues.byChain) {
    const record = getOrCreate(entry.chainSlug);
    record.caloriesAboveThreshold += entry.caloriesAboveThreshold;
  }

  // Duplicates groups (contribute totalDuplicateDishes per chain)
  for (const group of duplicates.groups) {
    const record = getOrCreate(group.chainSlug);
    record.totalDuplicateDishes += group.count;
  }

  // Compute totalDishes per chain from confidenceDistribution.byChain (most complete)
  for (const entry of confidenceDistribution.byChain) {
    const record = getOrCreate(entry.chainSlug);
    // totalDishes = sum of high + medium + low for this chain
    record.totalDishes += entry.high + entry.medium + entry.low;
  }

  const chainSummary: QualityChainSummary[] = Array.from(chainMap.entries())
    .map(([chainSlug, counts]) => {
      const total = counts.totalDishes;
      const nutrientCoveragePercent =
        total > 0
          ? parseFloat(
              (((total - counts.dishesWithoutNutrients) / total) * 100).toFixed(2),
            )
          : 0;

      const issueCount =
        counts.dishesWithoutNutrients +
        counts.ghostRowCount +
        counts.caloriesAboveThreshold +
        counts.totalDuplicateDishes;

      return {
        chainSlug,
        totalDishes: total,
        nutrientCoveragePercent,
        issueCount,
      };
    })
    .sort((a, b) => b.issueCount - a.issueCount);

  return {
    generatedAt: new Date().toISOString(),
    totalDishes,
    totalRestaurants,
    stalenessThresholdDays,
    scopedToChain: scope.chainSlug ?? null,
    chainSummary,
    nutrientCompleteness,
    implausibleValues,
    dataGaps,
    duplicates,
    confidenceDistribution,
    dataFreshness,
  };
}
