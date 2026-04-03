#!/usr/bin/env node
/**
 * F071 — BEDCA Import CLI Script
 *
 * Imports BEDCA food data into the database.
 * Run with: npm run bedca:import -w @foodxplorer/api
 *
 * Options:
 *   --dry-run          Report what would be imported without writing to DB
 *   --source snapshot  Use local snapshot (default — reproducible, safe)
 *   --source live      Fetch fresh data from BEDCA API (requires AESAN authorization)
 *   --batch-size <n>   Number of foods per batch (default: 50)
 *
 * Feature flag:
 *   Requires BEDCA_IMPORT_ENABLED=true in non-test environments.
 *   This prevents accidental production use before AESAN authorization.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { seedPhaseBedca } from './seedPhaseBedca.js';

export interface BedcaImportOptions {
  dryRun: boolean;
  source: 'snapshot' | 'live';
  batchSize: number;
}

export async function runBedcaImport(
  opts: BedcaImportOptions,
  prismaOverride?: PrismaClient,
): Promise<void> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const flagEnabled = process.env['BEDCA_IMPORT_ENABLED'] === 'true';
  const isTest = nodeEnv === 'test';

  // Feature flag check (same as seedPhaseBedca, but explicit in CLI for clear user feedback)
  if (!isTest && !flagEnabled) {
    console.error(
      '[bedca-import] ERROR: BEDCA_IMPORT_ENABLED is not set to "true".\n' +
      'Set this flag only after receiving AESAN commercial authorization.\n' +
      'The import is blocked to prevent unauthorized use of BEDCA data.',
    );
    process.exit(1);
  }

  if (opts.source === 'live') {
    console.error(
      '[bedca-import] Live source is not yet supported.\n' +
      'Use bedca:snapshot script to generate a fresh snapshot first, then re-run with --source snapshot.',
    );
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log('[bedca-import] DRY RUN mode — no DB writes will be performed');

    const candidates = [
      resolve(process.cwd(), 'prisma/seed-data/bedca/bedca-snapshot-full.json'),
      resolve(process.cwd(), 'packages/api/prisma/seed-data/bedca/bedca-snapshot-full.json'),
      resolve(process.cwd(), '../prisma/seed-data/bedca/bedca-snapshot-full.json'),
    ];
    const snapshotPath =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- candidates array is always non-empty
      candidates.find((p) => existsSync(p)) ?? candidates[0]!;

    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Array<{
      foodId: number;
      nameEs: string;
      nameEn: string;
      foodGroupEn: string;
      nutrients: Array<{ nutrientId: number; value: number | null }>;
    }>;

    const CORE_IDS = new Set([208, 203, 205, 204]);
    const importable = snapshot.filter((entry) => {
      const core = entry.nutrients.filter((n) => CORE_IDS.has(n.nutrientId));
      return core.some((n) => n.value !== null);
    });

    console.log(`[bedca-import] Would import ${importable.length} foods from BEDCA snapshot`);
    console.log('[bedca-import] Sample (first 5):');
    for (const entry of importable.slice(0, 5)) {
      const calories = entry.nutrients.find((n) => n.nutrientId === 208)?.value ?? 0;
      console.log(
        `  BEDCA-${entry.foodId}: ${entry.nameEn} / ${entry.nameEs} ` +
        `(${entry.foodGroupEn}) — ${calories} kcal/100g`,
      );
    }
    return;
  }

  // Live import
  const client =
    prismaOverride ??
    new PrismaClient({
      datasources: {
        db: {
          url:
            process.env['DATABASE_URL'] ??
            'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_dev',
        },
      },
    });

  try {
    await seedPhaseBedca(client);
    console.log('[bedca-import] Import complete.');
  } finally {
    if (!prismaOverride) {
      await (client as PrismaClient).$disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when executed directly, not when imported
// ---------------------------------------------------------------------------
const isDirectExecution = !process.argv[1] || process.argv[1].endsWith('bedca-import.ts') || process.argv[1].endsWith('bedca-import.js');
if (isDirectExecution) {
  const args = process.argv.slice(2);
  const opts: BedcaImportOptions = {
    dryRun: args.includes('--dry-run'),
    source: args.includes('--source') && args[args.indexOf('--source') + 1] === 'live'
      ? 'live'
      : 'snapshot',
    batchSize: args.includes('--batch-size')
      ? Number(args[args.indexOf('--batch-size') + 1]) || 50
      : 50,
  };

  runBedcaImport(opts).catch((err) => {
    console.error('[bedca-import] Fatal error:', err);
    process.exit(1);
  });
}
