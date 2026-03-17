// checkDuplicates — check function #4
//
// Detects Dish rows sharing the same (name, restaurantId, sourceId) triple.
// Uses Prisma groupBy + a second pass to fetch dishIds for each group.
//
// NOTE: The groups array is NOT capped here. The 50-entry cap is applied in
// the API route (quality.ts) before returning to the client. The CLI script
// has no cap.

import type { PrismaClient } from '@prisma/client';
import type { QualityDuplicatesResult, QualityDuplicateGroup } from './types.js';

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkDuplicates(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
): Promise<QualityDuplicatesResult> {
  const where =
    scope.chainSlug !== undefined
      ? { restaurant: { chainSlug: scope.chainSlug } }
      : {};

  // Step 1: Find groups with count > 1 via groupBy
  let groupByRows = await prisma.dish.groupBy({
    by: ['name', 'restaurantId', 'sourceId'],
    _count: { _all: true },
    where,
    having: {
      name: { _count: { gt: 1 } },
    },
  });

  // Fallback: If Prisma `having` doesn't filter correctly, filter in JS
  groupByRows = groupByRows.filter((row) => row._count._all > 1);

  if (groupByRows.length === 0) {
    return {
      duplicateGroupCount: 0,
      totalDuplicateDishes: 0,
      groups: [],
    };
  }

  // Step 2: Fetch restaurantId → chainSlug mapping for all groups
  const restaurantIds = [...new Set(groupByRows.map((r) => r.restaurantId))];
  const restaurants = await prisma.restaurant.findMany({
    where: { id: { in: restaurantIds } },
    select: { id: true, chainSlug: true },
  });
  const restaurantChainMap = new Map<string, string>(
    restaurants.map((r) => [r.id, r.chainSlug]),
  );

  // Sort: count DESC, then name ASC
  const sortedGroups = [...groupByRows].sort((a, b) => {
    const countDiff = b._count._all - a._count._all;
    if (countDiff !== 0) return countDiff;
    return a.name.localeCompare(b.name);
  });

  // Step 3: Fetch dishIds for each group
  const groups: QualityDuplicateGroup[] = await Promise.all(
    sortedGroups.map(async (row) => {
      const dishes = await prisma.dish.findMany({
        where: { name: row.name, restaurantId: row.restaurantId, sourceId: row.sourceId },
        select: { id: true },
      });

      return {
        name: row.name,
        chainSlug: restaurantChainMap.get(row.restaurantId) ?? row.restaurantId,
        count: row._count._all,
        dishIds: dishes.map((d) => d.id),
      };
    }),
  );

  const totalDuplicateDishes = groups.reduce((sum, g) => sum + g.count, 0);

  return {
    duplicateGroupCount: groups.length,
    totalDuplicateDishes,
    groups,
  };
}
