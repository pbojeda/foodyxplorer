// Pure parsing functions for comparison detection.
// No side effects, no I/O. Fully unit-testable in isolation.

import { extractPortionModifier } from './portionModifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NutrientFocusKey =
  | 'calorías'
  | 'proteínas'
  | 'grasas'
  | 'carbohidratos'
  | 'fibra'
  | 'sodio'
  | 'sal';

export interface ParsedComparison {
  dishA: string;
  dishB: string;
  nutrientFocus?: NutrientFocusKey;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Strong separators (word-boundary, first occurrence) tried first,
// then weak separators (space-flanked, last occurrence).
// This prevents "con" from matching inside dish names like "helado con chocolate".
export const COMPARISON_SEPARATORS = ['versus', 'contra', 'vs', 'con', 'o', 'y'] as const;

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at
// least one hyphen. Copied verbatim from naturalLanguage.ts (F028 pattern).
const CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/;

// Nutrient token → canonical NutrientFocusKey.
const NUTRIENT_TOKEN_MAP: Record<string, NutrientFocusKey> = {
  'calorias': 'calorías',
  'calorías': 'calorías',
  'proteinas': 'proteínas',
  'proteínas': 'proteínas',
  'grasas': 'grasas',
  'hidratos': 'carbohidratos',
  'carbohidratos': 'carbohidratos',
  'fibra': 'fibra',
  'sodio': 'sodio',
  'sal': 'sal',
};

// NL prefix patterns. Each returns a remainder and optional nutrientFocus.
// Matched in order — first match wins.
interface PrefixMatch {
  remainder: string;
  nutrientFocus: NutrientFocusKey | undefined;
}

// Build a nutrient token alternation for regex.
const NUTRIENT_TOKENS = Object.keys(NUTRIENT_TOKEN_MAP).join('|');

const PREFIX_PATTERNS: Array<{ regex: RegExp; extractFocus: boolean; fixedFocus?: NutrientFocusKey }> = [
  // "qué tiene más <nutrient>,? <remainder>"
  { regex: new RegExp(`^qu[eé]\\s+tiene\\s+m[aá]s\\s+(${NUTRIENT_TOKENS}),?\\s+`, 'i'), extractFocus: true },
  // "qué tiene menos <nutrient>,? <remainder>"
  { regex: new RegExp(`^qu[eé]\\s+tiene\\s+menos\\s+(${NUTRIENT_TOKENS}),?\\s+`, 'i'), extractFocus: true },
  // "qué engorda más,? <remainder>"
  { regex: /^qu[eé]\s+engorda\s+m[aá]s,?\s+/i, extractFocus: false, fixedFocus: 'calorías' },
  // "qué es más sano,? <remainder>"
  { regex: /^qu[eé]\s+es\s+m[aá]s\s+san[oa],?\s+/i, extractFocus: false },
  // "compara[r]? <remainder>"
  { regex: /^compara[r]?\s+/i, extractFocus: false },
];

// ---------------------------------------------------------------------------
// splitByComparator
// ---------------------------------------------------------------------------

/**
 * Split a text string on the first recognised comparison separator.
 * Separators are tried in descending length order (longest first wins).
 * For 'o' and 'y', uses the LAST occurrence and requires space-flanking.
 * Returns [left, right] or null if no valid split found.
 */
export function splitByComparator(text: string): [string, string] | null {
  if (!text) return null;

  for (const sep of COMPARISON_SEPARATORS) {
    let regex: RegExp;
    let useLastOccurrence = false;

    if (sep === 'con' || sep === 'o' || sep === 'y') {
      // Space-flanked + last-occurrence to avoid matching inside dish names
      // ("helado con chocolate", "pollo o cerdo", etc.).
      regex = new RegExp(` ${sep} `, 'gi');
      useLastOccurrence = true;
    } else {
      // Word-boundary match with optional trailing dot (for "vs.").
      regex = new RegExp(`\\b${sep}\\.?(?=\\s|$)`, 'gi');
    }

    if (useLastOccurrence) {
      // Find the last match — store both index and length.
      let lastIndex = -1;
      let lastMatchLen = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        lastIndex = match.index;
        lastMatchLen = match[0].length;
      }
      if (lastIndex !== -1) {
        const left = text.slice(0, lastIndex).trim();
        const right = text.slice(lastIndex + lastMatchLen).trim();
        if (left && right) return [left, right];
      }
    } else {
      const match = regex.exec(text);
      if (match) {
        const left = text.slice(0, match.index).trim();
        const right = text.slice(match.index + match[0].length).trim();
        if (left && right) return [left, right];
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseCompararArgs
// ---------------------------------------------------------------------------

/**
 * Parse the raw args string from the /comparar command.
 * Delegates to splitByComparator. Returns { dishA, dishB } or null.
 */
export function parseCompararArgs(args: string): { dishA: string; dishB: string } | null {
  const result = splitByComparator(args);
  if (!result) return null;
  return { dishA: result[0], dishB: result[1] };
}

// ---------------------------------------------------------------------------
// parseDishExpression
// ---------------------------------------------------------------------------

/**
 * Parse a single dish expression (one side of the comparison).
 * Extracts optional chainSlug (last " en " + valid slug) and portionMultiplier.
 */
export function parseDishExpression(text: string): {
  query: string;
  chainSlug?: string;
  portionMultiplier: number;
} {
  const trimmed = text.trim();

  // Step 1 — Chain slug extraction (last " en " split, same as estimar.ts)
  const separator = ' en ';
  const lastIdx = trimmed.lastIndexOf(separator);

  let remainder = trimmed;
  let chainSlug: string | undefined;

  if (lastIdx !== -1) {
    const candidateSlug = trimmed.slice(lastIdx + separator.length).trim();
    if (CHAIN_SLUG_REGEX.test(candidateSlug)) {
      chainSlug = candidateSlug;
      remainder = trimmed.slice(0, lastIdx).trim();
    }
  }

  // Step 2 — Portion modifier extraction
  const { cleanQuery, portionMultiplier } = extractPortionModifier(remainder);

  const result: { query: string; chainSlug?: string; portionMultiplier: number } = {
    query: cleanQuery,
    portionMultiplier,
  };

  if (chainSlug !== undefined) {
    result.chainSlug = chainSlug;
  }

  return result;
}

// ---------------------------------------------------------------------------
// extractComparisonQuery
// ---------------------------------------------------------------------------

function matchPrefix(text: string): PrefixMatch | null {
  for (const pattern of PREFIX_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match) {
      const remainder = text.slice(match[0].length).trim();
      if (!remainder) return null;

      let nutrientFocus: NutrientFocusKey | undefined;

      if (pattern.extractFocus && match[1]) {
        nutrientFocus = NUTRIENT_TOKEN_MAP[match[1].toLowerCase()];
      } else if (pattern.fixedFocus) {
        nutrientFocus = pattern.fixedFocus;
      }

      return { remainder, nutrientFocus };
    }
  }
  return null;
}

/**
 * Detect NL comparison intent. Returns ParsedComparison if matched, null otherwise.
 *
 * Two-phase approach:
 * Phase 1 — Match a prefix regex to identify comparison intent + optional nutrientFocus.
 * Phase 2 — Pass remainder to splitByComparator for separator splitting.
 */
export function extractComparisonQuery(text: string): ParsedComparison | null {
  const prefixMatch = matchPrefix(text);
  if (!prefixMatch) return null;

  const split = splitByComparator(prefixMatch.remainder);
  if (!split) return null;

  return {
    dishA: split[0],
    dishB: split[1],
    nutrientFocus: prefixMatch.nutrientFocus,
  };
}
