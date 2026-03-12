// CLI entry point for the scraper process.
//
// Usage:
//   npm run dev -w @foodxplorer/scraper
//   SCRAPER_CHAIN=mcdonalds-es npm run dev -w @foodxplorer/scraper
//
// When SCRAPER_CHAIN is not set, lists all available chain slugs and exits 0.
// When SCRAPER_CHAIN is set but not found in the registry, exits 1.
// When the scraper run finishes, exits 0 on success/partial, 1 on failed.

import { config } from './config.js';
import { registry } from './registry.js';

async function main(): Promise<void> {
  const chainSlug = config.SCRAPER_CHAIN;

  if (chainSlug === undefined) {
    const available = Object.keys(registry);
    if (available.length === 0) {
      console.log('[scraper:runner] No chain scrapers registered yet.');
    } else {
      console.log(
        `[scraper:runner] Available chains: ${available.join(', ')}`,
      );
      console.log(
        '[scraper:runner] Set SCRAPER_CHAIN=<slug> to run a specific scraper.',
      );
    }
    process.exit(0);
  }

  const chainConfig = registry[chainSlug];
  if (chainConfig === undefined) {
    console.error(
      `[scraper:runner] Unknown chain: "${chainSlug}". ` +
        `Available: ${Object.keys(registry).join(', ') || '(none registered)'}`,
    );
    process.exit(1);
  }

  // F008+ will store the scraper constructor in the registry.
  // For now, the registry only holds config — this structure anticipates F008.
  console.error(
    `[scraper:runner] Chain "${chainSlug}" found in registry but no scraper class is wired yet. ` +
      'This will be resolved in F008.',
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[scraper:runner] Unhandled error: ${message}`);
  process.exit(1);
});
