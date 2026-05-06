// Follow-up classifier functions for multi-turn follow-up resolution (F-MULTITURN-001).
//
// Pure, synchronous functions — no async, no Redis, no DB. Testable in isolation.
//
// Exports:
//   ATTRIBUTE_CONFIDENCE_THRESHOLD = 0.75
//   REFINEMENT_CONFIDENCE_THRESHOLD = 0.70
//   NUTRIENT_ALIASES — flat alias-to-metadata Record (Plan-R3 fix: O(1) lookup)
//   detectAttributeFollowUp(text) → { nutrientKey, confidence } | null
//   detectRefinementFollowUp(text) → { modificationText, confidence } | null
//   applyRefinement(originalQuery, modificationText) → { mergedQuery, portionMultiplierOverride? }

import type { NutrientKey } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const ATTRIBUTE_CONFIDENCE_THRESHOLD = 0.75;
export const REFINEMENT_CONFIDENCE_THRESHOLD = 0.70;

// ---------------------------------------------------------------------------
// NUTRIENT_ALIASES — flat alias-to-metadata Record (Plan-R3 fix — Gemini IMP P3-1)
//
// Each alias is a top-level key with explicit (intentionally repeated) metadata.
// O(1) lookup: NUTRIENT_ALIASES[alias] → { nutrientKey, label, unit }.
// Multiple aliases for the same nutrient are listed as separate entries.
// ---------------------------------------------------------------------------

export type NutrientMeta = {
  nutrientKey: NutrientKey;
  label: string;
  unit: 'kcal' | 'g' | 'mg';
};

export const NUTRIENT_ALIASES: Record<string, NutrientMeta> = {
  // Calories
  'calorías':           { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  'calorias':           { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  'kcal':               { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  'cal':                { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  'energía':            { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  'energia':            { nutrientKey: 'calories',            label: 'Calorías',            unit: 'kcal' },
  // Proteins
  'proteínas':          { nutrientKey: 'proteins',            label: 'Proteínas',            unit: 'g' },
  'proteinas':          { nutrientKey: 'proteins',            label: 'Proteínas',            unit: 'g' },
  'proteína':           { nutrientKey: 'proteins',            label: 'Proteínas',            unit: 'g' },
  'proteina':           { nutrientKey: 'proteins',            label: 'Proteínas',            unit: 'g' },
  'prot':               { nutrientKey: 'proteins',            label: 'Proteínas',            unit: 'g' },
  // Carbohydrates
  'carbohidratos':      { nutrientKey: 'carbohydrates',       label: 'Carbohidratos',        unit: 'g' },
  'hidratos':           { nutrientKey: 'carbohydrates',       label: 'Carbohidratos',        unit: 'g' },
  'carbs':              { nutrientKey: 'carbohydrates',       label: 'Carbohidratos',        unit: 'g' },
  'hc':                 { nutrientKey: 'carbohydrates',       label: 'Carbohidratos',        unit: 'g' },
  // Sugars
  'azúcar':             { nutrientKey: 'sugars',              label: 'Azúcares',             unit: 'g' },
  'azucar':             { nutrientKey: 'sugars',              label: 'Azúcares',             unit: 'g' },
  'azúcares':           { nutrientKey: 'sugars',              label: 'Azúcares',             unit: 'g' },
  'azucares':           { nutrientKey: 'sugars',              label: 'Azúcares',             unit: 'g' },
  // Fats
  'grasas':             { nutrientKey: 'fats',                label: 'Grasas',               unit: 'g' },
  'grasa':              { nutrientKey: 'fats',                label: 'Grasas',               unit: 'g' },
  'fat':                { nutrientKey: 'fats',                label: 'Grasas',               unit: 'g' },
  // Saturated fats
  'grasas saturadas':   { nutrientKey: 'saturatedFats',       label: 'Grasas saturadas',     unit: 'g' },
  'saturadas':          { nutrientKey: 'saturatedFats',       label: 'Grasas saturadas',     unit: 'g' },
  'sat':                { nutrientKey: 'saturatedFats',       label: 'Grasas saturadas',     unit: 'g' },
  // Fiber
  'fibra':              { nutrientKey: 'fiber',               label: 'Fibra',                unit: 'g' },
  // Salt
  'sal':                { nutrientKey: 'salt',                label: 'Sal',                  unit: 'g' },
  // Sodium
  'sodio':              { nutrientKey: 'sodium',              label: 'Sodio',                unit: 'mg' },
  // Trans fats
  'grasas trans':       { nutrientKey: 'transFats',           label: 'Grasas trans',         unit: 'g' },
  'trans':              { nutrientKey: 'transFats',           label: 'Grasas trans',         unit: 'g' },
  // Cholesterol
  'colesterol':         { nutrientKey: 'cholesterol',         label: 'Colesterol',           unit: 'mg' },
  // Potassium
  'potasio':            { nutrientKey: 'potassium',           label: 'Potasio',              unit: 'mg' },
  // Monounsaturated fats
  'monoinsaturadas':    { nutrientKey: 'monounsaturatedFats', label: 'Grasas monoinsaturadas', unit: 'g' },
  'mono':               { nutrientKey: 'monounsaturatedFats', label: 'Grasas monoinsaturadas', unit: 'g' },
  // Polyunsaturated fats
  'poliinsaturadas':    { nutrientKey: 'polyunsaturatedFats', label: 'Grasas poliinsaturadas', unit: 'g' },
  'poli':               { nutrientKey: 'polyunsaturatedFats', label: 'Grasas poliinsaturadas', unit: 'g' },
  // Alcohol
  'alcohol':            { nutrientKey: 'alcohol',             label: 'Alcohol',              unit: 'g' },
};

// O(1) reverse lookup: canonical NutrientKey → NutrientMeta. Built once at module
// load by deduping `Object.values(NUTRIENT_ALIASES)` (multiple aliases share the
// same `{nutrientKey, label, unit}` triple, so any alias is fine).
// (code-review MAJOR-1: original `NUTRIENT_ALIASES[canonicalKey]` lookup was a
// dead-code path because keys are Spanish aliases, not canonical English keys.)
export const NUTRIENT_META_BY_KEY: Partial<Record<NutrientKey, NutrientMeta>> = (() => {
  const out: Partial<Record<NutrientKey, NutrientMeta>> = {};
  for (const meta of Object.values(NUTRIENT_ALIASES)) {
    if (!out[meta.nutrientKey]) out[meta.nutrientKey] = meta;
  }
  return out;
})();

// ---------------------------------------------------------------------------
// detectAttributeFollowUp
// ---------------------------------------------------------------------------

/**
 * Detects whether text is a nutrient attribute follow-up (e.g. "y los carbs?").
 * Returns { nutrientKey, confidence } on match, null otherwise.
 * Pure and synchronous.
 */
// Defensive cap — classifiers are pure functions exported for direct use in tests
// and could theoretically be called outside the conversation pipeline. The pipeline
// itself caps at MAX_TEXT_LENGTH=500 upstream (conversationCore.ts), but exporting
// classifiers means we re-assert the limit here to prevent ReDoS-class issues if a
// caller bypasses the pipeline. (production-code-validator MAJOR-1.)
const MAX_CLASSIFIER_INPUT_LENGTH = 500;

export function detectAttributeFollowUp(
  text: string,
): { nutrientKey: NutrientKey; confidence: number } | null {
  if (text.length > MAX_CLASSIFIER_INPUT_LENGTH) return null;
  // Normalize: NFC (so accented chars like "proteína" match alias keys regardless
  // of whether the input was NFD-encoded by a mobile keyboard or clipboard paste —
  // qa-engineer IMPORTANT finding), then lowercase, strip trailing punctuation, trim.
  const normalized = text.normalize('NFC').toLowerCase().replace(/[¿?¡!.]+$/g, '').trim();

  // Build a regex alternation from all alias keys sorted by length (longest first)
  // to avoid partial matches (e.g. "sal" before "grasas saturadas" would shadow "saturadas")
  const aliases = Object.keys(NUTRIENT_ALIASES).sort((a, b) => b.length - a.length);
  const aliasGroup = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // Pattern set (spec minimum requirements):
  // 1. "y (los|la|las|el)? <nutrient>"
  // 2. "cuánto/a (tiene|hay)? (de)? <nutrient>"
  // 3. "(dime|dame) (los|la|las|el)? <nutrient>"
  // 4. bare "<nutrient>" with optional "?" already stripped
  const patterns: RegExp[] = [
    // "y [los/la/las/el]? <nutrient>"
    new RegExp(`^(?:y\\s+)?(?:los|la|las|el)?\\s*(${aliasGroup})$`, 'u'),
    // "cuánto/a [de]? <nutrient> [tiene/hay]?"
    new RegExp(`^cu[aá]nto?a?\\s+(?:de\\s+)?(${aliasGroup})\\s*(?:tiene|hay|contiene)?\\s*\\??$`, 'u'),
    // "cuánto/a tiene [de]? <nutrient>"
    new RegExp(`^cu[aá]nto?a?\\s+(?:tiene|hay|contiene)?\\s*(?:de\\s+)?(${aliasGroup})\\s*\\??$`, 'u'),
    // "[dime/dame] [los/la/las/el]? <nutrient>"
    new RegExp(`^(?:dime|dame)\\s+(?:los|la|las|el)?\\s*(${aliasGroup})$`, 'u'),
    // bare "<nutrient>" — already stripped of trailing ?
    new RegExp(`^(?:y\\s+)?(?:los|la|las|el)?\\s*(${aliasGroup})\\s*\\??$`, 'u'),
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const alias = match[1];
      if (alias === undefined) continue;
      const meta = NUTRIENT_ALIASES[alias];
      if (meta) {
        return { nutrientKey: meta.nutrientKey, confidence: 1.0 };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// detectRefinementFollowUp
// ---------------------------------------------------------------------------

/**
 * Detects whether text is a refinement follow-up (e.g. "hazlo de pollo en vez de cerdo").
 * Returns { modificationText, confidence } on match, null otherwise.
 * Pure and synchronous.
 */
export function detectRefinementFollowUp(
  text: string,
): { modificationText: string; confidence: number } | null {
  if (text.length > MAX_CLASSIFIER_INPUT_LENGTH) return null;
  // NFC normalization for accented Spanish patterns (qa-engineer IMPORTANT finding).
  const normalized = text.normalize('NFC').toLowerCase().trim();

  const patterns: Array<{ regex: RegExp; confidence: number }> = [
    // Swap patterns: "hazlo de X", "ponlo de X", "cambialo de X", "pero de X"
    { regex: /^(?:hazlo|ponlo|cambia(?:lo)?|pero)\s+de\s+/u, confidence: 1.0 },
    // "de X en vez de Y" standalone (without hazlo prefix)
    { regex: /^de\s+\S+\s+en\s+vez\s+de\s+\S+/u, confidence: 1.0 },
    // Portion patterns
    { regex: /^(?:menos|más|mas)\s+cantidad$/u, confidence: 1.0 },
    { regex: /^una\s+raci[oó]n\s+(?:peque[ñn]a|grande|media|enorme|extra)/u, confidence: 1.0 },
    { regex: /^(?:m[aá]s|menos)\s+(?:peque[ñn]o|peque[ñn]a|grande)/u, confidence: 1.0 },
    // sin X patterns
    { regex: /^sin\s+\S+/u, confidence: 1.0 },
  ];

  for (const { regex, confidence } of patterns) {
    if (regex.test(normalized)) {
      // modificationText is the normalized text (without "hazlo/ponlo" prefix for swap patterns)
      // We expose the full original text as modificationText — applyRefinement parses it
      return { modificationText: normalized, confidence };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// applyRefinement
// ---------------------------------------------------------------------------

// Portion multiplier map — matches extractPortionModifier patterns for parity
const PORTION_MULTIPLIERS: Array<{ pattern: RegExp; multiplier: number }> = [
  { pattern: /menos\s+cantidad/u,                             multiplier: 0.5 },
  { pattern: /más\s+cantidad|mas\s+cantidad/u,                multiplier: 1.5 },
  { pattern: /una\s+raci[oó]n\s+peque[ñn]a/u,               multiplier: 0.7 },
  { pattern: /una\s+raci[oó]n\s+grande/u,                    multiplier: 1.5 },
  { pattern: /una\s+raci[oó]n\s+media/u,                     multiplier: 1.0 },
  { pattern: /una\s+raci[oó]n\s+enorme/u,                    multiplier: 2.0 },
  { pattern: /una\s+raci[oó]n\s+extra/u,                     multiplier: 2.0 },
  { pattern: /m[aá]s\s+peque[ñn]o|m[aá]s\s+peque[ñn]a/u,   multiplier: 0.7 },
  { pattern: /m[aá]s\s+grande/u,                             multiplier: 1.5 },
  { pattern: /menos\s+peque[ñn]o|menos\s+peque[ñn]a/u,      multiplier: 1.3 },
  { pattern: /menos\s+grande/u,                              multiplier: 0.7 },
];

/**
 * Merges a modification onto an original query string.
 * Returns { mergedQuery, portionMultiplierOverride? }.
 *
 * 4-branch decision tree (must be evaluated in order 1→2→3→4):
 * 1. Portion-only patterns → return { mergedQuery: originalQuery, portionMultiplierOverride }
 * 2. "de X en vez de Y" swap:
 *    a. If Y present in originalQuery → REPLACE Y with X
 *    b. Else → APPEND-AFTER-STRIP (strip "en vez de Y", append remainder)
 * 3. "sin X" → APPEND
 * 4. Default → APPEND
 *
 * Pure and synchronous.
 */
export function applyRefinement(
  originalQuery: string,
  modificationText: string,
): { mergedQuery: string; portionMultiplierOverride?: number } {
  const normalized = modificationText.toLowerCase().trim();

  // Branch 1 — Portion-only (check FIRST — portion modifiers take priority)
  for (const { pattern, multiplier } of PORTION_MULTIPLIERS) {
    if (pattern.test(normalized)) {
      return { mergedQuery: originalQuery, portionMultiplierOverride: multiplier };
    }
  }

  // Branch 2 — Swap: "de <new> en vez de <old>"
  // Support both standalone "de X en vez de Y" and "hazlo/ponlo de X en vez de Y"
  const swapMatch = normalized.match(
    /(?:^|(?:hazlo|ponlo|cambia(?:lo)?|pero)\s+)de\s+(?<newTerm>\S+)\s+en\s+vez\s+de\s+(?<oldTerm>\S+)/u,
  );
  if (swapMatch?.groups) {
    const newTerm = swapMatch.groups['newTerm'];
    const oldTerm = swapMatch.groups['oldTerm'];
    if (newTerm && oldTerm) {
      // Case-insensitive whole-word check for oldTerm in originalQuery
      const oldRegex = new RegExp(`\\b${oldTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu');
      if (oldRegex.test(originalQuery)) {
        // REPLACE branch: substitute oldTerm with newTerm in originalQuery
        const merged = originalQuery.replace(oldRegex, newTerm);
        return { mergedQuery: merged };
      } else {
        // APPEND-AFTER-STRIP branch: strip " en vez de <old>" from modificationText, append remainder
        const stripped = modificationText
          .replace(new RegExp(`\\s*en\\s+vez\\s+de\\s+${oldTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'iu'), '')
          // Also strip "hazlo/ponlo/cambialo/pero " prefix
          .replace(/^(?:hazlo|ponlo|cambia(?:lo)?|pero)\s+/iu, '')
          .trim();
        return { mergedQuery: `${originalQuery} ${stripped}`.trim() };
      }
    }
  }

  // Branch 3 — "sin X" → APPEND
  const sinMatch = normalized.match(/^sin\s+(?<ingredient>.+)/u);
  if (sinMatch?.groups) {
    const ingredient = sinMatch.groups['ingredient'];
    if (ingredient) {
      return { mergedQuery: `${originalQuery} sin ${ingredient.trim()}` };
    }
  }

  // Branch 4 — Default: plain APPEND
  return { mergedQuery: `${originalQuery} ${modificationText}`.trim() };
}
