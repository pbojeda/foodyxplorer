/**
 * F085 — Portion Sizing Matrix
 *
 * Detects standard Spanish portion terms in the user query and returns
 * gram range context. Informational only — does not modify the nutritional
 * estimation, just provides context about what the portion term typically
 * means in grams.
 *
 * Rules are sorted longest-first to avoid partial matches (e.g., "media
 * ración" must match before "ración").
 *
 * No DB migration needed — rules are static and deterministic.
 */

import type { PortionSizing } from '@foodxplorer/shared';

export type { PortionSizing } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortionRule {
  /** Patterns matched against lowercase query (longest first) */
  patterns: string[];
  /** Canonical portion term */
  term: string;
  /** Standard gram range */
  gramsMin: number;
  gramsMax: number;
  /** Human-readable description in Spanish */
  description: string;
}

// ---------------------------------------------------------------------------
// Portion rules — sorted longest-first to avoid partial matches
// ---------------------------------------------------------------------------

const PORTION_RULES: PortionRule[] = [
  // Compound terms first (must match before their components)
  {
    patterns: ['media ración', 'media racion'],
    term: 'media ración',
    gramsMin: 100,
    gramsMax: 125,
    description: 'Media ración estándar española',
  },
  {
    patterns: ['ración para compartir', 'racion para compartir'],
    term: 'ración para compartir',
    gramsMin: 300,
    gramsMax: 400,
    description: 'Ración para compartir entre 2-3 personas',
  },
  // Single terms
  {
    patterns: ['ración', 'racion'],
    term: 'ración',
    gramsMin: 200,
    gramsMax: 250,
    description: 'Ración estándar española',
  },
  {
    patterns: ['pintxo', 'pincho'],
    term: 'pintxo',
    gramsMin: 30,
    gramsMax: 60,
    description: 'Pintxo / pincho individual',
  },
  {
    patterns: ['montadito'],
    term: 'montadito',
    gramsMin: 40,
    gramsMax: 60,
    description: 'Montadito individual (pan pequeño con topping)',
  },
  {
    patterns: ['tapa'],
    term: 'tapa',
    gramsMin: 50,
    gramsMax: 80,
    description: 'Tapa individual estándar',
  },
  {
    patterns: ['bocadillo', 'bocata'],
    term: 'bocadillo',
    gramsMin: 200,
    gramsMax: 250,
    description: 'Bocadillo estándar (pan + relleno)',
  },
  {
    patterns: ['plato'],
    term: 'plato',
    gramsMin: 250,
    gramsMax: 300,
    description: 'Plato estándar español',
  },
  {
    patterns: ['caña', 'cana'],
    term: 'caña',
    gramsMin: 200,
    gramsMax: 200,
    description: 'Caña de cerveza (200 ml)',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect a Spanish portion term in a query string.
 *
 * Returns the first matching portion rule (longest patterns checked first).
 * Returns null when no portion term is found.
 */
export function detectPortionTerm(query: string): PortionSizing | null {
  if (!query) return null;

  const lowerQuery = query.toLowerCase();

  for (const rule of PORTION_RULES) {
    const matched = rule.patterns.some((p) => lowerQuery.includes(p));
    if (!matched) continue;

    return {
      term: rule.term,
      gramsMin: rule.gramsMin,
      gramsMax: rule.gramsMax,
      description: rule.description,
    };
  }

  return null;
}

/**
 * Compute portion sizing context from a query string.
 *
 * Returns an empty object when no portion term detected, or
 * { portionSizing: {...} } ready to spread into EstimateData.
 */
export function enrichWithPortionSizing(
  query: string,
): { portionSizing?: PortionSizing } {
  const sizing = detectPortionTerm(query);
  return sizing !== null ? { portionSizing: sizing } : {};
}
