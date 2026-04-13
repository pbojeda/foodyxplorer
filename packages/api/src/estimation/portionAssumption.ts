/**
 * F-UX-B — 3-tier portion assumption resolution.
 *
 * When a user query contains a Spanish portion term (detected by F085), this
 * module resolves the per-dish portion assumption via a 3-tier fallback chain:
 *
 * Tier 1 — exact DB lookup for (dishId, term)
 * Tier 2 — media_racion arithmetic from ración row (ONLY for media_racion)
 * Tier 3 — F085 global generic range (gramsMin, gramsMax) from portionSizing
 *
 * The Tier 2 non-rule (spec §3.2): Tier 2 does NOT apply to tapa/pintxo queries
 * even when a ración row exists. Rejected ratios (tapa=ración×0.25 etc.) are
 * exactly the false precision this model was designed to eliminate.
 *
 * See ADR-020 and docs/tickets/F-UX-B-spanish-portion-terms.md for full spec.
 */

import type { PrismaClient } from '@prisma/client';
import type { PortionAssumption, PortionSizing } from '@foodxplorer/shared';
import { computeDisplayPieces } from './portionUtils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PartialPrisma = Pick<PrismaClient, 'standardPortion'>;

export type ResolvePortionAssumptionResult = {
  portionAssumption?: PortionAssumption;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a portion term string from F085 detection to the canonical DB key.
 * F085 terms use Spanish display strings; DB stores canonical keys.
 */
function normalizeToCanonicalTerm(term: string): 'pintxo' | 'tapa' | 'media_racion' | 'racion' | null {
  const lower = term.toLowerCase().trim();
  if (lower === 'media ración' || lower === 'media racion') return 'media_racion';
  if (lower === 'ración' || lower === 'racion') return 'racion';
  if (lower === 'pintxo' || lower === 'pincho') return 'pintxo';
  if (lower === 'tapa') return 'tapa';
  return null; // unhandled term (e.g., 'bocadillo', 'plato') — Tier 3 only
}

/**
 * Extract the user's literal term wording from the original query.
 * Falls back to the F085 canonical term string if not found.
 */
function extractTermDisplay(originalQuery: string, portionSizing: PortionSizing): string {
  const lower = originalQuery.toLowerCase();

  // Check for user-typed variants in order of specificity
  if (lower.includes('media ración') || lower.includes('media racion')) return 'media ración';
  if (lower.includes('ración') || lower.includes('racion')) return 'ración';
  if (lower.includes('pintxo')) return 'pintxo';
  if (lower.includes('pincho')) return 'pincho';
  if (lower.includes('tapa')) return 'tapa';

  // Fallback to F085 term string
  return portionSizing.term;
}

// ---------------------------------------------------------------------------
// determineFallbackReason (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Determine the Tier 3 fallback reason by checking if a ración row exists.
 *
 * - 'no_row': no ración row exists for this dish at all
 * - 'tier2_rejected_tapa': ración row exists but Tier 2 doesn't apply to tapa
 * - 'tier2_rejected_pintxo': ración row exists but Tier 2 doesn't apply to pintxo
 */
export async function determineFallbackReason(
  prisma: PartialPrisma,
  dishId: string,
  canonicalTerm: string,
): Promise<'no_row' | 'tier2_rejected_tapa' | 'tier2_rejected_pintxo'> {
  const racionRow = await prisma.standardPortion.findUnique({
    where: { dishId_term: { dishId, term: 'racion' } },
  });

  if (racionRow === null) return 'no_row';
  if (canonicalTerm === 'tapa') return 'tier2_rejected_tapa';
  if (canonicalTerm === 'pintxo') return 'tier2_rejected_pintxo';

  // Should not reach here for terms other than tapa/pintxo in Tier 3 context
  return 'no_row';
}

// ---------------------------------------------------------------------------
// resolvePortionAssumption
// ---------------------------------------------------------------------------

/**
 * Resolve the portion assumption for a dish + portion term combination.
 *
 * Returns `{}` when:
 * - dishId is null (food-level entity — no per-dish data)
 * - detectedTerm is null (no portion term detected in query)
 *
 * Returns `{ portionAssumption }` in all other cases (even if it falls
 * through to Tier 3 generic).
 *
 * @param prisma   Prisma client (or partial mock for testing)
 * @param dishId   UUID of the matched dish, or null for food-level matches
 * @param detectedTerm  F085 PortionSizing result from detectPortionTerm(query)
 * @param originalQuery The raw user query (used for termDisplay extraction)
 * @param multiplier    F042 portionMultiplier (applied to grams + pieces)
 * @param logger    Optional pino-compatible logger for Tier 3 structured log
 */
export async function resolvePortionAssumption(
  prisma: PartialPrisma,
  dishId: string | null,
  detectedTerm: PortionSizing | null,
  originalQuery: string,
  multiplier: number,
  logger?: { info: (data: object, msg: string) => void },
): Promise<ResolvePortionAssumptionResult> {
  // Guard: no portion term detected or entity is food-level (not dish-level)
  if (detectedTerm === null || dishId === null) return {};

  const termDisplay = extractTermDisplay(originalQuery, detectedTerm);
  const canonicalTerm = normalizeToCanonicalTerm(detectedTerm.term);

  // Unhandled terms (bocadillo, plato, etc.) — not in the canonical set,
  // Tier 3 generic only (no DB lookup makes sense for these)
  if (canonicalTerm === null) {
    return buildGenericResult(detectedTerm, termDisplay, 'no_row');
  }

  // -----------------------------------------------------------------------
  // Tier 1 — Exact DB lookup for (dishId, canonicalTerm)
  // -----------------------------------------------------------------------
  const tier1Row = await prisma.standardPortion.findUnique({
    where: { dishId_term: { dishId, term: canonicalTerm } },
  });

  if (tier1Row !== null) {
    const scaledPiecesRaw = tier1Row.pieces !== null ? tier1Row.pieces * multiplier : null;
    const displayPieces = computeDisplayPieces(scaledPiecesRaw);

    const portionAssumption: PortionAssumption = {
      term: canonicalTerm,
      termDisplay,
      source: 'per_dish',
      grams: Math.round(tier1Row.grams * multiplier),
      pieces: displayPieces,
      pieceName: displayPieces !== null ? tier1Row.pieceName : null,
      gramsRange: null,
      confidence: tier1Row.confidence as 'high' | 'medium' | 'low',
      fallbackReason: null,
    };
    return { portionAssumption };
  }

  // -----------------------------------------------------------------------
  // Tier 2 — media_racion arithmetic from ración row (ONLY for media_racion)
  // -----------------------------------------------------------------------
  if (canonicalTerm === 'media_racion') {
    const racionRow = await prisma.standardPortion.findUnique({
      where: { dishId_term: { dishId, term: 'racion' } },
    });

    if (racionRow !== null) {
      const basePiecesHalf = racionRow.pieces !== null ? racionRow.pieces * 0.5 : null;
      const displayPieces = computeDisplayPieces(
        basePiecesHalf !== null ? basePiecesHalf * multiplier : null,
      );

      const portionAssumption: PortionAssumption = {
        term: 'media_racion',
        termDisplay,
        source: 'per_dish',
        grams: Math.round(racionRow.grams * 0.5 * multiplier),
        pieces: displayPieces,
        pieceName: displayPieces !== null ? racionRow.pieceName : null,
        gramsRange: null,
        confidence: racionRow.confidence as 'high' | 'medium' | 'low',
        fallbackReason: null,
      };
      return { portionAssumption };
    }
  }

  // -----------------------------------------------------------------------
  // Tier 3 — F085 generic fallback
  // Tier 2 non-rule: tapa/pintxo NEVER derive from ración (explicit rejection)
  // -----------------------------------------------------------------------
  const fallbackReason = await determineFallbackReason(prisma, dishId, canonicalTerm);

  logger?.info(
    { dishId, term: canonicalTerm, fallbackReason, feature: 'F-UX-B' },
    'F-UX-B: Tier 3 generic fallback',
  );

  return buildGenericResult(detectedTerm, termDisplay, fallbackReason);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildGenericResult(
  detectedTerm: PortionSizing,
  termDisplay: string,
  fallbackReason: 'no_row' | 'tier2_rejected_tapa' | 'tier2_rejected_pintxo',
): ResolvePortionAssumptionResult {
  const { gramsMin, gramsMax } = detectedTerm;
  const midpoint = Math.round((gramsMin + gramsMax) / 2);

  const canonicalTerm = normalizeToCanonicalTerm(detectedTerm.term);
  // For unhandled terms (bocadillo etc.), default to the term string as-is
  const term = canonicalTerm ?? ('tapa' as const); // should not happen in practice

  const portionAssumption: PortionAssumption = {
    term: canonicalTerm ?? term,
    termDisplay,
    source: 'generic',
    grams: midpoint,
    pieces: null,
    pieceName: null,
    gramsRange: [gramsMin, gramsMax],
    confidence: null,
    fallbackReason,
  };
  return { portionAssumption };
}
