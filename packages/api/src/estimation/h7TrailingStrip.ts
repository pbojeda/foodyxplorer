// H7-P5 — Trailing conversational modifier strip helpers (Cat A, B, C).
// Pure functions — no I/O, no DB. Called by engineRouter.ts H7-P5 retry seam.
// See F-H7 spec for category definitions and safety guards.

// ---------------------------------------------------------------------------
// Cat A — conversational suffix strip
// ---------------------------------------------------------------------------

const CAT_A_PATTERNS: readonly RegExp[] = [
  /,?\s+por\s+favor\s*$/i,
  /\s+para\s+(?:merendar|picar|dos|compartir|el\s+centro)\s*$/i,
  /\s+clásic[ao]s?\s*$/i,
  /\s+bien\s+(?:caliente|frío|fría)\s*$/i,
  /\s+casero\s+de\s+postre\s*$/i,
  /\s+de\s+postre\s*$/i,
];

/**
 * Strip Cat A conversational suffixes from the end of `text`.
 * Applies all patterns in order; stops on first match and returns stripped result.
 * Returns original text if no pattern matches.
 *
 * Empty-strip guard: if a pattern strips the entire text to empty/whitespace,
 * return original text instead — prevents wasted L1 retry on empty query.
 */
export function applyH7CatAStrip(text: string): string {
  for (const pattern of CAT_A_PATTERNS) {
    const stripped = text.replace(pattern, '').trimEnd();
    if (stripped !== text) {
      return stripped.length > 0 ? stripped : text;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Cat B — cooking/serving method suffix strip
// ---------------------------------------------------------------------------

const CAT_B_PATTERNS: readonly RegExp[] = [
  /\s+a\s+baja\s+temperatura\s*$/i,
  /\s+a\s+la\s+plancha\s*[?]?\s*$/i,
  /\s+con\s+extra\s+de\s+\S+\s*$/i,
];

/**
 * Strip Cat B cooking/serving method suffixes from the end of `text`.
 * Applies patterns in order; stops on first match.
 * Returns original text if no pattern matches.
 *
 * NOTE: The protection for catalog dishes like "sepia a la plancha" comes from the
 * retry-seam architecture in engineRouter.ts: L1 Pass 1 resolves those queries before
 * the seam is reached. This function itself strips trailing " a la plancha" regardless.
 */
export function applyH7CatBStrip(text: string): string {
  for (const pattern of CAT_B_PATTERNS) {
    const stripped = text.replace(pattern, '').trimEnd();
    if (stripped !== text) {
      return stripped;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Cat C — trailing "con [tail]" strip with ≥2 pre-con tokens guard
// ---------------------------------------------------------------------------

/**
 * Strip trailing `con [tail]` segment from `text` only when the pre-`con`
 * fragment contains ≥2 whitespace-delimited tokens.
 *
 * Uses lastIndexOf to find the RIGHTMOST " con " boundary, so that compound
 * names like "tostada con jamón con tomate" only lose the last segment.
 *
 * Safety guard: ≥2 pre-con tokens prevents single-word-dish strips
 * (e.g. "arroz con leche" where "arroz" is only 1 token).
 *
 * In production: Cat C only runs after L1 Pass 1 already returned null,
 * which proves the full text is not a catalog landmine.
 */
export function applyH7CatCStrip(text: string): string {
  const conSep = ' con ';
  const lastConIdx = text.lastIndexOf(conSep);

  // No " con " found — nothing to strip
  if (lastConIdx === -1) {
    return text;
  }

  const preFragment = text.slice(0, lastConIdx);

  // Guard: pre-fragment must have ≥2 whitespace-delimited non-empty tokens
  const preTokens = preFragment.split(/\s+/).filter(t => t.length > 0);
  if (preTokens.length < 2) {
    return text;
  }

  return preFragment;
}

// ---------------------------------------------------------------------------
// Combined strip — Cat A → B → C priority order
// ---------------------------------------------------------------------------

/**
 * Apply Cat A, then Cat B, then Cat C trailing modifier strips.
 * Returns after the first category that produces a change.
 * If no category matches, returns the original text unchanged.
 *
 * Priority order ensures Cat A (por favor, clásico, etc.) fires before Cat C,
 * preventing "talo con chistorra, por favor" from having "con chistorra" also
 * stripped after Cat A removes ", por favor".
 */
export function applyH7TrailingStrip(text: string): string {
  const catA = applyH7CatAStrip(text);
  if (catA !== text) return catA;

  const catB = applyH7CatBStrip(text);
  if (catB !== text) return catB;

  return applyH7CatCStrip(text);
}
