// quality-monitor.ts — CLI entrypoint for data quality monitoring.
//
// Calls assembleReport and outputs either JSON or Markdown.
//
// Usage:
//   npm run quality:report -w @foodxplorer/api [-- --chainSlug mcdonalds-es]
//   npm run quality:report -w @foodxplorer/api [-- --staleness-days 30 --format json]
//   npm run quality:report -w @foodxplorer/api [-- --format markdown --output report.md]
//
// Exports runQualityMonitor() for testability via DI.

import * as fs from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import { assembleReport } from '../quality/assembleReport.js';
import type { QualityReportData } from '../quality/types.js';

// ---------------------------------------------------------------------------
// Options types
// ---------------------------------------------------------------------------

export interface QualityMonitorOptions {
  chainSlug?: string;
  stalenessThresholdDays: number;
  format: 'json' | 'markdown';
  output?: string;
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

function formatMarkdown(report: QualityReportData): string {
  const lines: string[] = [];

  lines.push('# Data Quality Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  if (report.scopedToChain !== null) {
    lines.push(`Scope: chain \`${report.scopedToChain}\``);
  } else {
    lines.push('Scope: global');
  }
  lines.push(`Staleness threshold: ${report.stalenessThresholdDays} days`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Dishes | ${report.totalDishes} |`);
  lines.push(`| Total Restaurants | ${report.totalRestaurants} |`);
  lines.push(`| Dishes Without Nutrients | ${report.nutrientCompleteness.dishesWithoutNutrients} |`);
  lines.push(`| Ghost Rows | ${report.nutrientCompleteness.ghostRowCount} |`);
  lines.push(`| Calories Above 5000 | ${report.implausibleValues.caloriesAboveThreshold} |`);
  lines.push(`| Duplicate Groups | ${report.duplicates.duplicateGroupCount} |`);
  lines.push(`| Stale Sources | ${report.dataFreshness.staleSources} / ${report.dataFreshness.totalSources} |`);
  lines.push('');

  // Chain summary
  if (report.chainSummary.length > 0) {
    lines.push('## Chain Summary');
    lines.push('');
    lines.push('| Chain | Dishes | Nutrient Coverage | Issues |');
    lines.push('|-------|--------|-------------------|--------|');
    for (const chain of report.chainSummary) {
      lines.push(
        `| ${chain.chainSlug} | ${chain.totalDishes} | ${chain.nutrientCoveragePercent}% | ${chain.issueCount} |`,
      );
    }
    lines.push('');
  }

  // 1. Nutrient Completeness
  lines.push('## Nutrient Completeness');
  lines.push('');
  const nc = report.nutrientCompleteness;
  lines.push(`- Dishes with nutrients: ${nc.dishesWithNutrients}`);
  lines.push(`- Dishes without nutrients: ${nc.dishesWithoutNutrients} (${nc.dishesWithoutNutrientsPercent}%)`);
  lines.push(`- Ghost rows (all-zero macros): ${nc.ghostRowCount}`);
  lines.push(`- Zero calories count: ${nc.zeroCaloriesCount}`);
  lines.push('');

  // 2. Implausible Values
  lines.push('## Implausible Values');
  lines.push('');
  const iv = report.implausibleValues;
  lines.push(`- Calories above ${iv.caloriesThreshold}: ${iv.caloriesAboveThreshold}`);
  lines.push(`- Ghost rows: ${iv.ghostRows}`);
  lines.push(`- Suspiciously round calories (>=100, divisible by 100): ${iv.suspiciouslyRoundCalories}`);
  lines.push('');

  // 3. Data Gaps
  lines.push('## Data Gaps');
  lines.push('');
  const dg = report.dataGaps;
  lines.push(`- Dishes without portion grams: ${dg.dishesWithoutPortionGrams}`);
  lines.push(`- Dishes without price (EUR): ${dg.dishesWithoutPriceEur}`);
  lines.push(`- Restaurants without dishes: ${dg.restaurantsWithoutDishes}`);
  lines.push('');

  // 4. Duplicates
  lines.push('## Duplicates');
  lines.push('');
  const dup = report.duplicates;
  lines.push(`- Duplicate groups: ${dup.duplicateGroupCount}`);
  lines.push(`- Total duplicate dishes: ${dup.totalDuplicateDishes}`);
  if (dup.groups.length > 0) {
    lines.push('');
    lines.push('| Name | Chain | Count | Dish IDs |');
    lines.push('|------|-------|-------|----------|');
    for (const group of dup.groups) {
      lines.push(`| ${group.name} | ${group.chainSlug} | ${group.count} | ${group.dishIds.join(', ')} |`);
    }
  }
  lines.push('');

  // 5. Confidence Distribution
  lines.push('## Confidence Distribution');
  lines.push('');
  const cd = report.confidenceDistribution;
  lines.push('**Global:**');
  lines.push(`- High: ${cd.global.high}`);
  lines.push(`- Medium: ${cd.global.medium}`);
  lines.push(`- Low: ${cd.global.low}`);
  lines.push('');
  lines.push('**By Estimation Method:**');
  lines.push(`- Official: ${cd.byEstimationMethod.official}`);
  lines.push(`- Scraped: ${cd.byEstimationMethod.scraped}`);
  lines.push(`- Ingredients: ${cd.byEstimationMethod.ingredients}`);
  lines.push(`- Extrapolation: ${cd.byEstimationMethod.extrapolation}`);
  lines.push('');

  // 6. Data Freshness
  lines.push('## Data Freshness');
  lines.push('');
  const df = report.dataFreshness;
  lines.push(`- Total sources: ${df.totalSources}`);
  lines.push(`- Stale sources: ${df.staleSources}`);
  if (df.staleSourcesDetail.length > 0) {
    lines.push('');
    lines.push('**Stale Sources:**');
    lines.push('');
    lines.push('| Source ID | Name | Last Updated | Days Since Update |');
    lines.push('|-----------|------|--------------|-------------------|');
    for (const source of df.staleSourcesDetail) {
      lines.push(
        `| ${source.sourceId} | ${source.name} | ${source.lastUpdated ?? 'never'} | ${source.daysSinceUpdate ?? 'N/A'} |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// runQualityMonitor — DI-friendly main function
// ---------------------------------------------------------------------------

/**
 * Runs the quality monitor and writes output to stdout or a file.
 *
 * @param opts - CLI options
 * @param prismaOverride - Optional PrismaClient for testing (defaults to singleton)
 * @param writeOutput - Optional output function for testing (defaults to process.stdout.write)
 */
export async function runQualityMonitor(
  opts: QualityMonitorOptions,
  prismaOverride?: PrismaClient,
  writeOutput?: (data: string) => void,
): Promise<void> {
  const prismaClient = prismaOverride ?? defaultPrisma;
  const scope = opts.chainSlug !== undefined ? { chainSlug: opts.chainSlug } : {};

  const report = await assembleReport(prismaClient, scope, opts.stalenessThresholdDays);

  let output: string;
  if (opts.format === 'json') {
    output = JSON.stringify(report, null, 2);
  } else {
    output = formatMarkdown(report);
  }

  if (opts.output !== undefined) {
    await fs.writeFile(opts.output, output, 'utf-8');
  } else if (writeOutput !== undefined) {
    writeOutput(output);
  } else {
    process.stdout.write(output + '\n');
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when this file is executed directly
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let chainSlug: string | undefined;
  let stalenessThresholdDays = 90;
  let format: 'json' | 'markdown' = 'markdown';
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--chainSlug' && args[i + 1] !== undefined) {
      chainSlug = args[i + 1];
      i++;
    } else if (arg === '--staleness-days' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1] ?? '', 10);
      if (!isNaN(parsed) && parsed > 0) {
        stalenessThresholdDays = parsed;
      }
      i++;
    } else if (arg === '--format' && args[i + 1] !== undefined) {
      const fmt = args[i + 1];
      if (fmt === 'json' || fmt === 'markdown') {
        format = fmt;
      }
      i++;
    } else if (arg === '--output' && args[i + 1] !== undefined) {
      output = args[i + 1];
      i++;
    }
  }

  try {
    await runQualityMonitor({ chainSlug, stalenessThresholdDays, format, output });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

// Only run main() when invoked directly (not when imported in tests)
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('quality-monitor.ts') ||
    process.argv[1].endsWith('quality-monitor.js'));

if (isMain) {
  void main();
}
