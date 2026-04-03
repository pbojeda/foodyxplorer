// Chain resolution for ConversationCore (F070).
//
// resolveChain() is a pure in-memory function that mirrors the bot's
// packages/bot/src/lib/chainResolver.ts but operates on a ChainRow[] array
// loaded at plugin init — no per-request DB queries.
//
// loadChainData() queries the DB once at plugin init and returns ChainRow[].

import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { ChainRow, ResolvedChain } from './types.js';

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a string for comparison:
 * lowercase → trim → NFD decompose → strip combining diacritics → remove apostrophes
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/'/g, '');
}

// ---------------------------------------------------------------------------
// resolveChain (pure, in-memory)
// ---------------------------------------------------------------------------

/**
 * Resolve a query string to a unique chain from an in-memory ChainRow[].
 *
 * 4-tier matching (first tier with results wins):
 *  1. Exact slug
 *  2. Exact name (nameEs ?? name)
 *  3. Prefix: slug OR name starts with query
 *  4. Substring (bidirectional): name contains query OR query contains name.
 *     Checks name, nameEs, and slug independently.
 *
 * Returns:
 * - ResolvedChain  — exactly 1 match in the winning tier
 * - 'ambiguous'    — multiple matches in the winning tier
 * - null           — no match, or query too short (< 3 chars after normalization)
 */
export function resolveChain(
  query: string,
  chains: ChainRow[],
): ResolvedChain | null | 'ambiguous' {
  const normalizedQuery = normalize(query);

  if (normalizedQuery.length < 3) return null;

  // Helper: pick display name
  const chainName = (c: ChainRow): string => c.nameEs ?? c.name;

  // Tier 1 — exact slug
  const tier1 = chains.filter((c) => normalizedQuery === normalize(c.chainSlug));
  if (tier1.length > 0) return toResult(tier1, chainName);

  // Tier 2 — exact name (nameEs ?? name)
  const tier2 = chains.filter((c) => normalizedQuery === normalize(chainName(c)));
  if (tier2.length > 0) return toResult(tier2, chainName);

  // Tier 3 — prefix: slug OR name starts with query
  const tier3 = chains.filter(
    (c) =>
      normalize(c.chainSlug).startsWith(normalizedQuery) ||
      normalize(chainName(c)).startsWith(normalizedQuery),
  );
  if (tier3.length > 0) return toResult(tier3, chainName);

  // Tier 4 — substring (bidirectional), check name, nameEs, and slug independently
  const tier4 = chains.filter((c) => {
    const normSlug = normalize(c.chainSlug);
    const normName = normalize(c.name);
    const normNameEs = c.nameEs !== null ? normalize(c.nameEs) : null;

    // Check name
    const nameMatch =
      normName.includes(normalizedQuery) || normalizedQuery.includes(normName);

    // Check nameEs independently
    const nameEsMatch =
      normNameEs !== null &&
      (normNameEs.includes(normalizedQuery) || normalizedQuery.includes(normNameEs));

    // Check slug too (bidirectional)
    const slugMatch =
      normSlug.includes(normalizedQuery) || normalizedQuery.includes(normSlug);

    return nameMatch || nameEsMatch || slugMatch;
  });
  if (tier4.length > 0) return toResult(tier4, chainName);

  return null;
}

function toResult(
  matches: ChainRow[],
  getChainName: (c: ChainRow) => string,
): ResolvedChain | 'ambiguous' {
  if (matches.length > 1) return 'ambiguous';
  const chain = matches[0] as ChainRow;
  return {
    chainSlug: chain.chainSlug,
    chainName: getChainName(chain),
  };
}

// ---------------------------------------------------------------------------
// loadChainData (DB query, called once at plugin init)
// ---------------------------------------------------------------------------

/**
 * Load all distinct chain rows from the restaurants table.
 * Returns ChainRow[] — used by resolveChain() at conversation request time.
 */
export async function loadChainData(db: Kysely<DB>): Promise<ChainRow[]> {
  const rows = await db
    .selectFrom('restaurants')
    .select(['chain_slug', 'name', 'name_es'])
    .where('chain_slug', 'is not', null)
    .distinct()
    .execute();

  return rows
    .filter((r) => r['chain_slug'] !== null)
    .map((r) => ({
      chainSlug: r['chain_slug'] as string,
      name: r['name'],
      nameEs: r['name_es'],
    }));
}
