#!/usr/bin/env node
/**
 * F071 — BEDCA Snapshot Generator
 *
 * Fetches all BEDCA food data from the live API and writes a static snapshot.
 * Run MANUALLY after AESAN commercial authorization is received.
 * The generated snapshot is committed to the repo for reproducible builds.
 *
 * Run with: npm run bedca:snapshot -w @foodxplorer/api
 *
 * Output files (relative to packages/api/):
 *   prisma/seed-data/bedca/bedca-snapshot-full.json
 *   prisma/seed-data/bedca/bedca-nutrient-index.json
 *
 * Note: This script makes real HTTP requests to the BEDCA API.
 * Typical runtime: 2-5 minutes depending on API latency.
 */

import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  fetchBedcaFoodsXml,
  fetchBedcaNutrientIndexXml,
} from '../ingest/bedca/bedcaClient.js';
import {
  parseBedcaFoods,
  parseBedcaNutrientIndex,
} from '../ingest/bedca/bedcaParser.js';
import { validateBedcaSeedData } from '../ingest/bedca/bedcaValidator.js';

async function runBedcaSnapshot(): Promise<void> {
  console.log('[bedca-snapshot] Fetching nutrient index from BEDCA API...');
  const nutrientIndexXml = await fetchBedcaNutrientIndexXml();
  const nutrientIndex = parseBedcaNutrientIndex(nutrientIndexXml);
  console.log(`[bedca-snapshot] Nutrient index: ${nutrientIndex.length} nutrients`);

  console.log('[bedca-snapshot] Fetching all foods with nutrients from BEDCA API...');
  console.log('[bedca-snapshot] (This may take 2-5 minutes depending on API latency)');
  const foodsXml = await fetchBedcaFoodsXml();
  const foods = parseBedcaFoods(foodsXml);
  console.log(`[bedca-snapshot] Parsed ${foods.length} foods from BEDCA`);

  // Validate before writing
  const validation = validateBedcaSeedData(foods);
  const warnings = validation.errors.filter((e) => e.startsWith('[WARN]'));
  const blocking = validation.errors.filter((e) => !e.startsWith('[WARN]'));

  for (const w of warnings) {
    console.warn(`[bedca-snapshot] ${w}`);
  }

  if (!validation.valid) {
    console.error(`[bedca-snapshot] Validation failed:\n${blocking.join('\n')}`);
    process.exit(1);
  }

  // Write snapshot files
  // Resolve output directory compatible with CJS build (no import.meta.url)
  const seedDataCandidates = [
    resolve(process.cwd(), 'prisma/seed-data/bedca'),
    resolve(process.cwd(), 'packages/api/prisma/seed-data/bedca'),
    resolve(process.cwd(), '../prisma/seed-data/bedca'),
  ];
  const seedDataDir =
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- seedDataCandidates array is always non-empty
    seedDataCandidates.find((p) => existsSync(resolve(p, 'bedca-snapshot-full.json'))) ?? seedDataCandidates[0]!;

  const snapshotPath = resolve(seedDataDir, 'bedca-snapshot-full.json');
  writeFileSync(snapshotPath, JSON.stringify(foods, null, 2), 'utf-8');
  console.log(`[bedca-snapshot] Snapshot written: ${snapshotPath} (${foods.length} foods)`);

  const indexPath = resolve(seedDataDir, 'bedca-nutrient-index.json');
  writeFileSync(indexPath, JSON.stringify(nutrientIndex, null, 2), 'utf-8');
  console.log(`[bedca-snapshot] Nutrient index written: ${indexPath} (${nutrientIndex.length} nutrients)`);

  console.log('[bedca-snapshot] Snapshot generation complete. Commit both files to the repo.');
}

const isDirectExecution = !process.argv[1] || process.argv[1].endsWith('bedca-snapshot.ts') || process.argv[1].endsWith('bedca-snapshot.js');
if (isDirectExecution) {
  runBedcaSnapshot().catch((err) => {
    console.error('[bedca-snapshot] Fatal error:', err);
    process.exit(1);
  });
}
