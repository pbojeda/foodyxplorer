#!/usr/bin/env node
/**
 * F080 — OFF Import CLI Script
 *
 * Imports Open Food Facts prepared food data into the database.
 * Run with: npm run off:import -w @foodxplorer/api
 *
 * Options:
 *   --dry-run         Report what would be imported without writing to DB
 *   --brand <name>    Brand to import (default: "hacendado")
 *   --limit <n>       Maximum number of products to import
 *
 * Feature flag:
 *   Requires OFF_IMPORT_ENABLED=true in non-test environments.
 *   When absent, logs a warning and exits with code 0.
 */

import { PrismaClient } from '@prisma/client';
import type { SeedOffResult } from './seedPhaseOff.js';
import { seedPhaseOff } from './seedPhaseOff.js';

export interface OffImportOptions {
  dryRun: boolean;
  brand: string;
  limit?: number;
}

export async function runOffImport(
  opts: OffImportOptions,
  prismaOverride?: PrismaClient,
): Promise<SeedOffResult> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const flagEnabled = process.env['OFF_IMPORT_ENABLED'] === 'true';
  const isTest = nodeEnv === 'test';

  if (!isTest && !flagEnabled) {
    console.warn(
      '[off-import] WARNING: OFF_IMPORT_ENABLED is not set to "true".\n' +
      'Set this flag to enable the OFF import. Exiting with code 0.',
    );
    return {
      productsFound: 0,
      productsImported: 0,
      productsSkipped: 0,
      skipReasons: [],
    };
  }

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
    const result = await seedPhaseOff(client, {
      dryRun: opts.dryRun,
      brand: opts.brand,
      limit: opts.limit,
    });

    console.log('[off-import] Import summary:');
    console.log(`  Products found:    ${result.productsFound}`);
    console.log(`  Products imported: ${result.productsImported}`);
    console.log(`  Products skipped:  ${result.productsSkipped}`);
    if (result.skipReasons.length > 0) {
      console.log('  Skip reasons (sample):');
      for (const reason of result.skipReasons.slice(0, 10)) {
        console.log(`    - ${reason}`);
      }
    }

    return result;
  } finally {
    if (!prismaOverride) {
      await client.$disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when executed directly, not when imported
// ---------------------------------------------------------------------------
const isDirectExecution =
  !process.argv[1] ||
  process.argv[1].endsWith('off-import.ts') ||
  process.argv[1].endsWith('off-import.js');

if (isDirectExecution) {
  const args = process.argv.slice(2);

  const brandIdx = args.indexOf('--brand');
  const brand = brandIdx !== -1 && args[brandIdx + 1] ? args[brandIdx + 1] : 'hacendado';

  const limitIdx = args.indexOf('--limit');
  const limit =
    limitIdx !== -1 && args[limitIdx + 1]
      ? Number(args[limitIdx + 1]) || undefined
      : undefined;

  const opts: OffImportOptions = {
    dryRun: args.includes('--dry-run'),
    brand: brand as string,
    limit,
  };

  runOffImport(opts).catch((err: unknown) => {
    console.error('[off-import] Fatal error:', err);
    process.exit(1);
  });
}
