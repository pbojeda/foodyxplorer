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

  // --- F-DRINK: compound drink portion terms (longest-first before bare copa/vaso) ---
  {
    patterns: ['copa de vino', 'copita de vino'],
    term: 'copa vino',
    gramsMin: 120,
    gramsMax: 150,
    description: 'Copa de vino estándar (120-150 ml)',
  },
  {
    patterns: ['copa de cava'],
    term: 'copa cava',
    gramsMin: 100,
    gramsMax: 150,
    description: 'Copa de cava (100-150 ml)',
  },
  {
    patterns: ['vaso de agua'],
    term: 'vaso agua',
    gramsMin: 200,
    gramsMax: 250,
    description: 'Vaso de agua (200-250 ml)',
  },

  // --- F-DRINK: single drink portion terms ---
  {
    patterns: ['copa'],
    term: 'copa',
    gramsMin: 120,
    gramsMax: 150,
    description: 'Copa estándar (vino/cava, 120-150 ml)',
  },
  {
    patterns: ['tercio'],
    term: 'tercio',
    gramsMin: 330,
    gramsMax: 330,
    description: 'Tercio de cerveza (330 ml)',
  },
  {
    patterns: ['botellín'],
    term: 'botellín',
    gramsMin: 250,
    gramsMax: 250,
    description: 'Botellín de cerveza (250 ml)',
  },
  {
    patterns: ['botella'],
    term: 'botella',
    gramsMin: 330,
    gramsMax: 750,
    description: 'Botella estándar (330 ml cerveza / 750 ml vino)',
  },
  {
    patterns: ['vaso'],
    term: 'vaso',
    gramsMin: 150,
    gramsMax: 200,
    description: 'Vaso estándar (150-200 ml)',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a pattern appears as a whole word (not substring of a larger word).
 * Boundary = start/end of string or whitespace.
 */
function matchesAsWord(text: string, pattern: string): boolean {
  const idx = text.indexOf(pattern);
  if (idx === -1) return false;
  const before = idx === 0 || /\s/.test(text[idx - 1] ?? '');
  const after = idx + pattern.length >= text.length || /\s/.test(text[idx + pattern.length] ?? '');
  return before && after;
}

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
    const matched = rule.patterns.some((p) => matchesAsWord(lowerQuery, p));
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
