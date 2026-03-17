// checkImplausibleValues — check function #2
//
// Detects nutrient rows with implausible or suspicious values:
// - calories > 5000 (above monitoring threshold)
// - ghost rows (all four core macros are exactly 0)
// - suspiciously round calories (>= 100 AND divisible by 100)
//
// Uses targeted count() queries per metric instead of loading all rows
// into memory. The suspiciously-round check uses $queryRaw since Prisma
// has no modulo filter.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { QualityImplausibleValuesResult, QualityImplausibleValuesChain } from './types.js';

const CALORIES_THRESHOLD = 5000 as const;

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkImplausibleValues(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityImplausibleValuesResult> {
  const nutrientWhere =
    scope.chainSlug !== undefined
      ? { dish: { restaurant: { chainSlug: scope.chainSlug } } }
      : {};

  // Global counts — 3 targeted count queries in parallel
  const [caloriesAboveThreshold, ghostRows, suspiciouslyRoundCalories] =
    await Promise.all([
      prisma.dishNutrient.count({
        where: { ...nutrientWhere, calories: { gt: CALORIES_THRESHOLD } },
      }),
      prisma.dishNutrient.count({
        where: {
          ...nutrientWhere,
          calories: { equals: 0 },
          proteins: { equals: 0 },
          carbohydrates: { equals: 0 },
          fats: { equals: 0 },
        },
      }),
      // Prisma has no modulo filter — use raw SQL for round-calories count
      (async () => {
        const chainFilter =
          scope.chainSlug !== undefined
            ? Prisma.sql`AND dn.dish_id IN (
                SELECT d.id FROM dishes d
                JOIN restaurants r ON d.restaurant_id = r.id
                WHERE r.chain_slug = ${scope.chainSlug}
              )`
            : Prisma.empty;

        const result = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM dish_nutrients dn
            WHERE dn.calories >= 100
              AND MOD(dn.calories, 100) = 0
              ${chainFilter}
          `,
        );
        return Number(result[0]?.count ?? 0);
      })(),
    ]);

  // byChain: use raw SQL to get all three metrics grouped by chain_slug
  const chainFilter =
    scope.chainSlug !== undefined
      ? Prisma.sql`WHERE r.chain_slug = ${scope.chainSlug}`
      : Prisma.empty;

  const byChainRows = await prisma.$queryRaw<
    Array<{
      chain_slug: string;
      calories_above: bigint;
      ghost_rows: bigint;
      round_calories: bigint;
    }>
  >(
    Prisma.sql`
      SELECT
        r.chain_slug,
        COUNT(*) FILTER (WHERE dn.calories > ${CALORIES_THRESHOLD})::bigint AS calories_above,
        COUNT(*) FILTER (WHERE dn.calories = 0 AND dn.proteins = 0 AND dn.carbohydrates = 0 AND dn.fats = 0)::bigint AS ghost_rows,
        COUNT(*) FILTER (WHERE dn.calories >= 100 AND MOD(dn.calories, 100) = 0)::bigint AS round_calories
      FROM dish_nutrients dn
      JOIN dishes d ON dn.dish_id = d.id
      JOIN restaurants r ON d.restaurant_id = r.id
      ${chainFilter}
      GROUP BY r.chain_slug
    `,
  );

  const byChain: QualityImplausibleValuesChain[] = byChainRows.map((row) => ({
    chainSlug: row.chain_slug,
    caloriesAboveThreshold: Number(row.calories_above),
    ghostRows: Number(row.ghost_rows),
    suspiciouslyRoundCalories: Number(row.round_calories),
  }));

  return {
    caloriesAboveThreshold,
    ghostRows,
    suspiciouslyRoundCalories,
    caloriesThreshold: CALORIES_THRESHOLD,
    byChain,
  };
}
