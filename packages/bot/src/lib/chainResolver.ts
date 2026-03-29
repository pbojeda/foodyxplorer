// Chain resolution for context-set detection.
//
// Resolves a free-form query (chain name or slug) to a unique chain via
// 4-tier matching. Calls listChains() exactly once per invocation.

import type { ApiClient } from '../apiClient.js';
import type { ChainListItem } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedChain {
  chainSlug: string;
  chainName: string;
}

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
// resolveChain
// ---------------------------------------------------------------------------

/**
 * Resolve a query string to a unique chain.
 *
 * 4-tier matching (first tier with results wins):
 *  1. Exact slug
 *  2. Exact name (nameEs ?? name)
 *  3. Prefix: slug OR name starts with query
 *  4. Substring (bidirectional): name contains query OR query contains name
 *     Checks both `name` and `nameEs` independently.
 *
 * Returns:
 * - ResolvedChain  — exactly 1 match in the winning tier
 * - 'ambiguous'    — multiple matches in the winning tier
 * - null           — no match, or query too short (< 3 chars after normalization)
 *
 * Rethrows if listChains() throws.
 */
export async function resolveChain(
  query: string,
  apiClient: ApiClient,
): Promise<ResolvedChain | null | 'ambiguous'> {
  const normalizedQuery = normalize(query);

  if (normalizedQuery.length < 3) return null;

  // May throw — caller is responsible for catching if needed.
  const chains = await apiClient.listChains();

  // Helper: pick display name
  const chainName = (chain: ChainListItem): string => chain.nameEs ?? chain.name;

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

  // Tier 4 — substring (bidirectional), check both name and nameEs independently
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
  matches: ChainListItem[],
  getChainName: (c: ChainListItem) => string,
): ResolvedChain | 'ambiguous' {
  if (matches.length > 1) return 'ambiguous';
  const chain = matches[0] as ChainListItem;
  return {
    chainSlug: chain.chainSlug,
    chainName: getChainName(chain),
  };
}
