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

  // Step 3: Batch fetch dishIds for ALL groups in a single query using OR
  const orConditions = sortedGroups.map((row) => ({
    name: row.name,
    restaurantId: row.restaurantId,
    sourceId: row.sourceId,
  }));

  const allDishes = await prisma.dish.findMany({
    where: { OR: orConditions },
    select: { id: true, name: true, restaurantId: true, sourceId: true },
  });

  // Index dishes by composite key for O(1) lookup
  const dishIndex = new Map<string, string[]>();
  for (const dish of allDishes) {
    const key = `${dish.name}\0${dish.restaurantId}\0${dish.sourceId}`;
    const existing = dishIndex.get(key) ?? [];
    existing.push(dish.id);
    dishIndex.set(key, existing);
  }

  const groups: QualityDuplicateGroup[] = sortedGroups.map((row) => {
    const key = `${row.name}\0${row.restaurantId}\0${row.sourceId}`;
    return {
      name: row.name,
      chainSlug: restaurantChainMap.get(row.restaurantId) ?? row.restaurantId,
      count: row._count._all,
      dishIds: dishIndex.get(key) ?? [],
    };
  });

  const totalDuplicateDishes = groups.reduce((sum, g) => sum + g.count, 0);

  return {
    duplicateGroupCount: groups.length,
    totalDuplicateDishes,
    groups,
  };
}
