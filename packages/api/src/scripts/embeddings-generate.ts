// embeddings-generate.ts — CLI entry point for the embedding generation pipeline.
//
// Usage:
//   npm run embeddings:generate -w @foodxplorer/api [-- --target all --dry-run]
//   npm run embeddings:generate -w @foodxplorer/api [-- --target dishes --chain-slug mcdonalds-es]
//   npm run embeddings:generate -w @foodxplorer/api [-- --target foods --force]
//
// Exports runEmbeddingsCLI() for testability via DI.
// The isMain guard prevents execution when imported in tests.

import type { PrismaClient } from '@prisma/client';
import type { EmbeddingTarget } from '@foodxplorer/shared';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import { runEmbeddingPipeline } from '../embeddings/pipeline.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Options type
// ---------------------------------------------------------------------------

export interface EmbeddingCLIOptions {
  target: EmbeddingTarget;
  batchSize: number;
  force: boolean;
  dryRun: boolean;
  chainSlug?: string;
}

// ---------------------------------------------------------------------------
// runEmbeddingsCLI — DI-friendly main function
// ---------------------------------------------------------------------------

/**
 * Run the embedding generation pipeline with the given CLI options.
 *
 * @param opts          - Parsed CLI options
 * @param prismaOverride - Optional PrismaClient for testing (defaults to singleton)
 */
export async function runEmbeddingsCLI(
  opts: EmbeddingCLIOptions,
  prismaOverride?: PrismaClient,
): Promise<void> {
  const prismaClient = prismaOverride ?? defaultPrisma;
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';

  const result = await runEmbeddingPipeline({
    target: opts.target,
    chainSlug: opts.chainSlug,
    batchSize: opts.batchSize,
    force: opts.force,
    dryRun: opts.dryRun,
    prisma: prismaClient,
    openaiApiKey: apiKey,
    embeddingModel: config.OPENAI_EMBEDDING_MODEL,
    embeddingRpm: config.OPENAI_EMBEDDING_RPM,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): EmbeddingCLIOptions {
  let target: EmbeddingTarget | undefined;
  let batchSize = 100;
  let force = false;
  let dryRun = false;
  let chainSlug: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if ((arg === '--target') && args[i + 1] !== undefined) {
      const val = args[i + 1];
      if (val === 'foods' || val === 'dishes' || val === 'all') {
        target = val;
      } else {
        process.stderr.write(`Error: --target must be 'foods', 'dishes', or 'all' (got '${val}')\n`);
        process.exit(1);
      }
      i++;
    } else if (arg === '--batch-size' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1] ?? '', 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 2048) {
        batchSize = parsed;
      }
      i++;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if ((arg === '--chain-slug') && args[i + 1] !== undefined) {
      chainSlug = args[i + 1];
      i++;
    }
  }

  if (target === undefined) {
    // Default to 'all' per spec
    target = 'all';
  }

  return { target, batchSize, force, dryRun, chainSlug };
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when this file is executed directly
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  try {
    await runEmbeddingsCLI(opts);
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
  (process.argv[1].endsWith('embeddings-generate.ts') ||
    process.argv[1].endsWith('embeddings-generate.js'));

if (isMain) {
  void main();
}
