// checkConfidenceDistribution — check function #5
//
// Counts dishes by confidenceLevel and estimationMethod, globally and per chain.
// Uses groupBy queries to avoid loading all dishes into memory.
// Merges restaurantId → chainSlug in JS to handle chains with multiple restaurants.

import type { PrismaClient } from '@prisma/client';
import type {
  QualityConfidenceDistributionResult,
  QualityConfidenceChain,
  QualityConfidenceByEstimationMethod,
} from './types.js';

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkConfidenceDistribution(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityConfidenceDistributionResult> {
  const where =
    scope.chainSlug !== undefined
      ? { restaurant: { chainSlug: scope.chainSlug } }
      : {};

  // Run all four groupBy queries in parallel
  const [globalConfidence, globalEstimation, byChainConfidence, byChainEstimation] =
    await Promise.all([
      prisma.dish.groupBy({
        by: ['confidenceLevel'],
        _count: { _all: true },
        where,
      }),
      prisma.dish.groupBy({
        by: ['estimationMethod'],
        _count: { _all: true },
        where,
      }),
      prisma.dish.groupBy({
        by: ['confidenceLevel', 'restaurantId'],
        _count: { _all: true },
        where,
      }),
      prisma.dish.groupBy({
        by: ['estimationMethod', 'restaurantId'],
        _count: { _all: true },
        where,
      }),
    ]);

  // Build global confidence counts
  const globalHigh = globalConfidence.find((r) => r.confidenceLevel === 'high')?._count._all ?? 0;
  const globalMedium = globalConfidence.find((r) => r.confidenceLevel === 'medium')?._count._all ?? 0;
  const globalLow = globalConfidence.find((r) => r.confidenceLevel === 'low')?._count._all ?? 0;

  // Build global estimation method counts
  const byEstimationMethod: QualityConfidenceByEstimationMethod = {
    official: globalEstimation.find((r) => r.estimationMethod === 'official')?._count._all ?? 0,
    scraped: globalEstimation.find((r) => r.estimationMethod === 'scraped')?._count._all ?? 0,
    ingredients: globalEstimation.find((r) => r.estimationMethod === 'ingredients')?._count._all ?? 0,
    extrapolation: globalEstimation.find((r) => r.estimationMethod === 'extrapolation')?._count._all ?? 0,
  };

  // Collect all restaurantIds referenced in byChain queries
  const restaurantIds = [
    ...new Set([
      ...byChainConfidence.map((r) => r.restaurantId),
      ...byChainEstimation.map((r) => r.restaurantId),
    ]),
  ];

  let chainByRestaurant: Map<string, string>;

  if (restaurantIds.length === 0) {
    chainByRestaurant = new Map();
  } else {
    const restaurants = await prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, chainSlug: true },
    });
    chainByRestaurant = new Map(restaurants.map((r) => [r.id, r.chainSlug]));
  }

  // Aggregate per-chain confidence levels
  const chainConfidenceMap = new Map<
    string,
    { high: number; medium: number; low: number }
  >();

  for (const row of byChainConfidence) {
    const chainSlug = chainByRestaurant.get(row.restaurantId) ?? row.restaurantId;
    const existing = chainConfidenceMap.get(chainSlug) ?? { high: 0, medium: 0, low: 0 };
    const level = row.confidenceLevel as 'high' | 'medium' | 'low';
    existing[level] = (existing[level] ?? 0) + row._count._all;
    chainConfidenceMap.set(chainSlug, existing);
  }

  // Aggregate per-chain estimation methods
  const chainEstimationMap = new Map<
    string,
    QualityConfidenceByEstimationMethod
  >();

  for (const row of byChainEstimation) {
    const chainSlug = chainByRestaurant.get(row.restaurantId) ?? row.restaurantId;
    const existing = chainEstimationMap.get(chainSlug) ?? {
      official: 0,
      scraped: 0,
      ingredients: 0,
      extrapolation: 0,
    };
    const method = row.estimationMethod as keyof QualityConfidenceByEstimationMethod;
    existing[method] = (existing[method] ?? 0) + row._count._all;
    chainEstimationMap.set(chainSlug, existing);
  }

  // Merge into byChain array
  const allChainSlugs = new Set([
    ...chainConfidenceMap.keys(),
    ...chainEstimationMap.keys(),
  ]);

  const byChain: QualityConfidenceChain[] = Array.from(allChainSlugs).map(
    (chainSlug) => {
      const conf = chainConfidenceMap.get(chainSlug) ?? { high: 0, medium: 0, low: 0 };
      const est = chainEstimationMap.get(chainSlug) ?? {
        official: 0,
        scraped: 0,
        ingredients: 0,
        extrapolation: 0,
      };
      return {
        chainSlug,
        high: conf.high,
        medium: conf.medium,
        low: conf.low,
        byEstimationMethod: est,
      };
    },
  );

  return {
    global: {
      high: globalHigh,
      medium: globalMedium,
      low: globalLow,
    },
    byEstimationMethod,
    byChain,
  };
}
