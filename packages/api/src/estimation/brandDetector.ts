// Brand Detection — F068 Provenance Graph
//
// Extracts `hasExplicitBrand` flag from user queries to route branded queries
// (e.g., "tortilla hacendado") to Tier 0 data sources (ADR-015).
//
// detectExplicitBrand() is a pure function — known chain slugs are passed in.
// loadChainSlugs() is a DB utility called once at plugin init.

import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Curated supermarket / brand keywords (lowercase, normalized)
// ---------------------------------------------------------------------------

const SUPERMARKET_BRANDS: readonly string[] = [
  'hacendado',
  'mercadona',
  'carrefour',
  'dia',
  'lidl',
  'aldi',
  'eroski',
  'alcampo',
  'el corte inglés',
  'el corte ingles',
  'hipercor',
  'bonarea',
  'consum',
  'ahorramas',
  'bon preu',
  'bonpreu',
];

// ---------------------------------------------------------------------------
// Brand detection
// ---------------------------------------------------------------------------

export interface BrandDetectionResult {
  hasExplicitBrand: boolean;
  detectedBrand?: string;
}

/**
 * Detect whether a user query contains an explicit brand reference.
 *
 * Checks against:
 * 1. Known chain slugs (from DB, e.g., "mcdonalds-es" → "mcdonald's", "mcdonalds")
 * 2. Curated supermarket brand list
 *
 * Uses word-boundary matching to avoid false positives (e.g., "diablo" ≠ "dia").
 */
export function detectExplicitBrand(
  query: string,
  knownChainSlugs: readonly string[],
): BrandDetectionResult {
  const normalized = query.trim().toLowerCase();

  // Check supermarket brands first (more common for provenance routing)
  for (const brand of SUPERMARKET_BRANDS) {
    if (matchesAsWord(normalized, brand)) {
      return { hasExplicitBrand: true, detectedBrand: brand };
    }
  }

  // Check chain slugs — convert slug to brand-like form
  // e.g., "mcdonalds-es" → ["mcdonalds-es", "mcdonalds"]
  for (const slug of knownChainSlugs) {
    const variants = chainSlugToVariants(slug);
    for (const variant of variants) {
      if (matchesAsWord(normalized, variant)) {
        return { hasExplicitBrand: true, detectedBrand: slug };
      }
    }
  }

  return { hasExplicitBrand: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if `brand` appears as a whole word in `text`.
 * Uses word boundaries to avoid "dia" matching "diablo".
 */
function matchesAsWord(text: string, brand: string): boolean {
  // Escape regex special characters in brand
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s|\\b)${escaped}(?:\\s|$|\\b)`, 'i');
  return regex.test(text);
}

/**
 * Convert a chain slug to searchable variants.
 * "mcdonalds-es" → ["mcdonalds-es", "mcdonalds", "mcdonald's"]
 * "burger-king-es" → ["burger-king-es", "burger king", "burger-king"]
 */
function chainSlugToVariants(slug: string): string[] {
  const variants = [slug];

  // Remove country suffix (-es, -pt, etc.)
  const withoutCountry = slug.replace(/-[a-z]{2}$/, '');
  if (withoutCountry !== slug) {
    variants.push(withoutCountry);
  }

  // Replace hyphens with spaces
  const withSpaces = withoutCountry.replace(/-/g, ' ');
  if (withSpaces !== withoutCountry) {
    variants.push(withSpaces);
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Chain slug loader (cached at app level)
// ---------------------------------------------------------------------------

/**
 * Load distinct chain slugs from the database.
 * Called once at startup; result cached in-memory.
 */
export async function loadChainSlugs(db: Kysely<DB>): Promise<string[]> {
  const rows = await db
    .selectFrom('restaurants')
    .select('chain_slug')
    .distinct()
    .where('chain_slug', 'is not', null)
    .execute();

  return rows.map((r) => r.chain_slug).filter((s): s is string => s !== null);
}
