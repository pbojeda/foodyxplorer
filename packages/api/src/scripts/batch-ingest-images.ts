// batch-ingest-images.ts — CLI batch runner for image chain ingestion.
//
// Iterates over enabled chains in CHAIN_IMAGE_REGISTRY, calling
// POST /ingest/image-url for each imageUrl in each chain's imageUrls array
// via HTTP (no direct pipeline import).
//
// One ChainImageIngestResult entry per image URL (not per chain), allowing
// partial success within a chain. Continue-on-failure semantics.
//
// Usage:
//   npm run ingest:batch-images -w @foodxplorer/api [-- --chain dominos-es --dry-run]
//   npm run ingest:batch-images -w @foodxplorer/api [-- --api-url https://staging.foodxplorer.com]
//
// Phase 1: sequential execution only. The --concurrency flag is parsed and
// accepted but values > 1 log a warning and fall back to sequential.

import { CHAIN_IMAGE_REGISTRY } from '../config/chains/chain-image-registry.js';
import type { ChainImageConfig } from '../config/chains/chain-image-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunImageBatchOptions {
  /** Filter to a single chain by slug. If omitted, all enabled chains are run. */
  chainSlug?: string;
  /** When true, dryRun: true is passed to every API request. No DB writes. */
  dryRun: boolean;
  /** Base URL of the running API server. */
  apiBaseUrl: string;
  /** Number of images to process concurrently. Phase 1 supports 1 only. */
  concurrency: number;
}

export type ChainImageIngestResultSuccess = {
  chain:          ChainImageConfig;
  imageUrl:       string;
  status:         'success';
  dishesFound:    number;
  dishesUpserted: number;
  dishesSkipped:  number;
  dryRun:         boolean;
};

export type ChainImageIngestResultError = {
  chain:        ChainImageConfig;
  imageUrl:     string;
  status:       'error';
  errorCode:    string;
  errorMessage: string;
};

export type ChainImageIngestResult = ChainImageIngestResultSuccess | ChainImageIngestResultError;

// ---------------------------------------------------------------------------
// Core: runImageBatch
// ---------------------------------------------------------------------------

/**
 * Runs the batch ingestion for the given image chain registry.
 *
 * One result per image URL (not per chain). Failed URLs are recorded and
 * processing continues with remaining URLs.
 *
 * @param registry  - Array of ChainImageConfig entries (default: CHAIN_IMAGE_REGISTRY)
 * @param options   - Batch run options
 * @param fetchImpl - Optional fetch implementation for testing (defaults to global fetch)
 * @returns Array of per-imageUrl results
 * @throws Error if chainSlug is provided but not found in registry
 */
export async function runImageBatch(
  registry: ChainImageConfig[],
  options: RunImageBatchOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ChainImageIngestResult[]> {
  const { chainSlug, dryRun, apiBaseUrl, concurrency } = options;

  if (concurrency > 1) {
    console.warn('[warn] concurrency > 1 not yet supported in Phase 1 — running sequentially');
  }

  // -------------------------------------------------------------------------
  // Chain selection
  // -------------------------------------------------------------------------

  let chains: ChainImageConfig[];

  if (chainSlug !== undefined) {
    const entry = registry.find((c) => c.chainSlug === chainSlug);
    if (entry === undefined) {
      throw new Error(`Chain not found in registry: ${chainSlug}`);
    }
    if (!entry.enabled) {
      console.warn(`[warn] Chain '${chainSlug}' is disabled — skipping`);
      return [];
    }
    chains = [entry];
  } else {
    chains = registry.filter((c) => c.enabled);
  }

  if (chains.length === 0) {
    console.log('No enabled chains found.');
    return [];
  }

  const totalUrls = chains.reduce((sum, c) => sum + c.imageUrls.length, 0);
  console.log(
    `Starting image batch ingest for ${chains.length} chain(s), ${totalUrls} image URL(s) [dry-run: ${dryRun ? 'yes' : 'no'}]`,
  );

  // -------------------------------------------------------------------------
  // Sequential processing — iterate chains, then imageUrls within each chain
  // -------------------------------------------------------------------------

  const results: ChainImageIngestResult[] = [];

  for (const chain of chains) {
    for (const imageUrl of chain.imageUrls) {
      console.log(`  [${chain.chainSlug}] Ingesting ${imageUrl}...`);

      const result = await ingestImageUrl(chain, imageUrl, { apiBaseUrl, dryRun }, fetchImpl);
      results.push(result);

      if (result.status === 'success') {
        console.log(
          `  [${chain.chainSlug}] OK — found: ${result.dishesFound}, upserted: ${result.dishesUpserted}, skipped: ${result.dishesSkipped}`,
        );
      } else {
        console.log(
          `  [${chain.chainSlug}] FAILED (${imageUrl}) — ${result.errorCode}: ${result.errorMessage}`,
        );
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Per-image HTTP call
// ---------------------------------------------------------------------------

async function ingestImageUrl(
  chain: ChainImageConfig,
  imageUrl: string,
  opts: { apiBaseUrl: string; dryRun: boolean },
  fetchImpl: typeof fetch,
): Promise<ChainImageIngestResult> {
  const base = opts.apiBaseUrl.replace(/\/+$/, '');
  const url  = `${base}/ingest/image-url`;

  try {
    const response = await fetchImpl(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env['ADMIN_API_KEY'] ? { 'X-API-Key': process.env['ADMIN_API_KEY'] } : {}),
      },
      body:    JSON.stringify({
        url:          imageUrl,
        restaurantId: chain.restaurantId,
        sourceId:     chain.sourceId,
        dryRun:       opts.dryRun,
        chainSlug:    chain.chainSlug,
      }),
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        chain,
        imageUrl,
        status:       'error',
        errorCode:    'UNEXPECTED_RESPONSE',
        errorMessage: 'Failed to parse JSON response from API',
      };
    }

    const parsed = body as Record<string, unknown> | null;

    if (response.ok) {
      const data = (parsed?.['data'] ?? null) as Record<string, unknown> | null;
      if (data === null || typeof data !== 'object') {
        return {
          chain,
          imageUrl,
          status:       'error',
          errorCode:    'UNEXPECTED_RESPONSE',
          errorMessage: 'API response missing data field',
        };
      }
      return {
        chain,
        imageUrl,
        status:         'success',
        dishesFound:    typeof data['dishesFound'] === 'number' ? data['dishesFound'] : 0,
        dishesUpserted: typeof data['dishesUpserted'] === 'number' ? data['dishesUpserted'] : 0,
        dishesSkipped:  typeof data['dishesSkipped'] === 'number' ? data['dishesSkipped'] : 0,
        dryRun:         typeof data['dryRun'] === 'boolean' ? data['dryRun'] : opts.dryRun,
      };
    } else {
      const error = (parsed?.['error'] ?? null) as Record<string, unknown> | null;
      return {
        chain,
        imageUrl,
        status:       'error',
        errorCode:    typeof error?.['code'] === 'string' ? error['code'] : `HTTP_${response.status}`,
        errorMessage: typeof error?.['message'] === 'string' ? error['message'] : 'Unknown API error',
      };
    }
  } catch (err) {
    return {
      chain,
      imageUrl,
      status:       'error',
      errorCode:    'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// CLI helpers (unexported — used only by main())
// ---------------------------------------------------------------------------

interface ParsedCliArgs {
  chainSlug?:  string;
  dryRun:      boolean;
  apiBaseUrl:  string;
  concurrency: number;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2); // drop node + script path

  let chainSlug:   string | undefined;
  let dryRun     = false;
  let apiBaseUrl  = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
  let concurrency = 1;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--chain' && args[i + 1] !== undefined) {
      chainSlug = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--api-url' && args[i + 1] !== undefined) {
      apiBaseUrl = args[i + 1];
      i++;
    } else if (arg === '--concurrency' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        concurrency = parsed;
      } else {
        console.warn(`[warn] Invalid concurrency value '${args[i + 1]}' — using default (1)`);
      }
      i++;
    } else if (arg !== undefined && arg.startsWith('--')) {
      console.warn(`[warn] Unknown flag ignored: ${arg}`);
    }
  }

  return { chainSlug, dryRun, apiBaseUrl, concurrency };
}

function printSummary(results: ChainImageIngestResult[], dryRun: boolean): void {
  const separator   = '========================================';
  const dryRunLabel = dryRun ? '  [DRY RUN — no DB writes]' : '';

  console.log(separator);
  console.log(`Image Batch Ingest Summary  [dry-run: ${dryRun ? 'yes' : 'no'}]${dryRunLabel}`);
  console.log(new Date().toISOString());
  console.log(separator);

  for (const r of results) {
    const urlLabel = r.imageUrl.length > 50 ? `...${r.imageUrl.slice(-47)}` : r.imageUrl;
    if (r.status === 'success') {
      const dryTag = dryRun ? ' (dry-run)' : '';
      console.log(
        `  ${r.chain.chainSlug.padEnd(16)} ${urlLabel.padEnd(50)} SUCCESS   ${r.dishesFound} found, ${r.dishesUpserted} upserted, ${r.dishesSkipped} skipped${dryTag}`,
      );
    } else {
      console.log(
        `  ${r.chain.chainSlug.padEnd(16)} ${urlLabel.padEnd(50)} FAILED    ${r.errorCode}: ${r.errorMessage}`,
      );
    }
  }

  console.log(separator);
  const successCount = results.filter((r) => r.status === 'success').length;
  const failedCount  = results.filter((r) => r.status === 'error').length;
  console.log(`Total: ${successCount} success, ${failedCount} failed`);
  console.log(`Exit code: ${failedCount > 0 ? 1 : 0}`);
  console.log(separator);
}

// ---------------------------------------------------------------------------
// CLI entry point (only function that calls process.exit)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv);

  let results: ChainImageIngestResult[];
  try {
    results = await runImageBatch(CHAIN_IMAGE_REGISTRY, opts);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  printSummary(results, opts.dryRun);
  process.exit(results.some((r) => r.status === 'error') ? 1 : 0);
}

// Run when executed directly via tsx/node (not when imported by tests)
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
