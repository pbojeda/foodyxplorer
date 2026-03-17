// checkDataFreshness — check function #6
//
// Identifies DataSource rows that are stale (lastUpdated IS NULL or older than
// stalenessThresholdDays). When chainSlug scope is active, only DataSources
// linked to dishes belonging to that chain are checked.
//
// NOTE: Unlike the other 5 checks, this function takes a third parameter:
// stalenessThresholdDays. assembleReport passes it through from the route.

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { QualityDataFreshnessResult } from './types.js';

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

export async function checkDataFreshness(
  prisma: PrismaClient,
  scope: { chainSlug?: string },
  stalenessThresholdDays: number,
): Promise<QualityDataFreshnessResult> {
  let dataSources: Array<{ id: string; name: string; lastUpdated: Date | null }>;

  if (scope.chainSlug !== undefined) {
    // Resolve source IDs linked to dishes in this chain via raw SQL
    // $queryRaw returns snake_case column names (source_id, not sourceId)
    const rows = await prisma.$queryRaw<Array<{ source_id: string }>>(
      Prisma.sql`
        SELECT DISTINCT source_id
        FROM dishes
        WHERE restaurant_id IN (
          SELECT id FROM restaurants WHERE chain_slug = ${scope.chainSlug}
        )
      `,
    );

    const sourceIds = rows.map((r) => r['source_id']);

    dataSources = await prisma.dataSource.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, name: true, lastUpdated: true },
    });
  } else {
    dataSources = await prisma.dataSource.findMany({
      select: { id: true, name: true, lastUpdated: true },
    });
  }

  const cutoff = new Date(Date.now() - stalenessThresholdDays * 86400 * 1000);

  const staleSourcesDetail: QualityDataFreshnessResult['staleSourcesDetail'] = [];

  for (const source of dataSources) {
    const isStale = source.lastUpdated === null || source.lastUpdated < cutoff;

    if (isStale) {
      const daysSinceUpdate =
        source.lastUpdated !== null
          ? Math.floor((Date.now() - source.lastUpdated.getTime()) / 86400000)
          : null;

      staleSourcesDetail.push({
        sourceId: source.id,
        name: source.name,
        lastUpdated: source.lastUpdated !== null ? source.lastUpdated.toISOString() : null,
        daysSinceUpdate,
      });
    }
  }

  return {
    totalSources: dataSources.length,
    staleSources: staleSourcesDetail.length,
    staleSourcesDetail,
  };
}
