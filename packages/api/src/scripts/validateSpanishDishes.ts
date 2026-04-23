/**
 * F073 — Spanish Canonical Dishes seed data validation.
 * Pure function, no DB dependencies.
 */

import type { SpanishDishEntry } from './spanishDishesTypes.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_SOURCES = new Set(['bedca', 'recipe']);
const NUTRIENT_FIELDS = [
  'calories', 'proteins', 'carbohydrates', 'sugars',
  'fats', 'saturatedFats', 'fiber', 'salt', 'sodium',
] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// F-H4-B — Homograph Allow List (Option B)
// ---------------------------------------------------------------------------

export interface HomographAllowListEntry {
  alias: string;      // lowercase normalized form; accents PRESERVED (see calçots/calcots precedent)
  dishIds: string[];  // the dish UUIDs that legitimately share this term
  reason: string;     // human-readable justification classifying the collision
}

/**
 * Declared collisions that are intentionally allowed.
 * Each entry requires a distinct reason documenting the semantic classification.
 * UUIDs resolved from packages/api/prisma/seed-data/spanish-dishes.json (F-H4-B).
 */
export const HOMOGRAPH_ALLOW_LIST: readonly HomographAllowListEntry[] = [
  {
    alias: 'manzanilla',
    dishIds: [
      '00000000-0000-e073-0007-000000000013', // CE-019 Infusión de manzanilla
      '00000000-0000-e073-0007-0000000000d5', // CE-213 Copa de fino
    ],
    reason:
      'True homograph: chamomile-tea infusion (CE-019) vs Sanlúcar fino sherry (CE-213). Both valid bare-term usage in Spanish.',
  },
  {
    alias: 'menestra de verduras',
    dishIds: [
      '00000000-0000-e073-0007-00000000004c', // CE-076 Menestra de verduras
      '00000000-0000-e073-0007-0000000000ec', // CE-236 Menestra guarnición
    ],
    reason:
      'Near-duplicate pending merge review: CE-076 main dish vs CE-236 side. Data-content review (follow-up) decides whether to merge.',
  },
  {
    alias: 'pisto manchego',
    dishIds: [
      '00000000-0000-e073-0007-00000000004b', // CE-075 Pisto manchego
      '00000000-0000-e073-0007-0000000000ef', // CE-239 Pisto guarnición
    ],
    reason:
      'Near-duplicate pending merge review: CE-075 main dish vs CE-239 side. Data-content review (follow-up) decides whether to merge.',
  },
  {
    alias: 'arroz con verduras',
    dishIds: [
      '00000000-0000-e073-0007-000000000092', // CE-146 Paella de verduras
      '00000000-0000-e073-0007-0000000000f7', // CE-247 Arroz con verduras y huevo
    ],
    reason:
      'Distinct dishes, generic alias pending data review: CE-146 paella-style without egg vs CE-247 rice-with-egg. Follow-up may remove the bare alias from one side.',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateSpanishDishes(dishes: SpanishDishEntry[]): ValidationResult {
  return validateSpanishDishesWithAllowList(dishes, HOMOGRAPH_ALLOW_LIST);
}

export function validateSpanishDishesWithAllowList(
  dishes: SpanishDishEntry[],
  allowList: readonly HomographAllowListEntry[],
): ValidationResult {
  const errors: string[] = [];
  let hasBlockingError = false;

  // Guard against null/undefined input
  if (!Array.isArray(dishes)) {
    return { valid: false, errors: ['Input must be an array of SpanishDishEntry'] };
  }

  // Minimum count
  if (dishes.length < 250) {
    errors.push(`Dataset must contain at least 250 entries, got ${dishes.length}`);
    hasBlockingError = true;
  }

  // Uniqueness checks
  const seenExternalIds = new Set<string>();
  const seenDishIds = new Set<string>();
  const seenNutrientIds = new Set<string>();

  // Built during first pass — used by second-pass collision check to resolve
  // externalId → dishId for allow-list set-equality comparison.
  const externalIdToDishId = new Map<string, string>();

  for (let i = 0; i < dishes.length; i++) {
    const entry = dishes[i];
    if (!entry) throw new Error(`dishes[${i}] unexpectedly undefined — array length invariant violated`);
    const prefix = `[${i}] ${entry.externalId ?? '(missing)'}`;

    // Duplicate externalId
    if (seenExternalIds.has(entry.externalId)) {
      errors.push(`${prefix}: Duplicate externalId "${entry.externalId}"`);
      hasBlockingError = true;
    }
    seenExternalIds.add(entry.externalId);

    // Populate externalId → dishId map for second-pass allow-list matching
    if (entry.externalId && entry.dishId) {
      externalIdToDishId.set(entry.externalId, entry.dishId);
    }

    // dishId presence and format
    if (!entry.dishId || !UUID_REGEX.test(entry.dishId)) {
      errors.push(`${prefix}: Missing or invalid dishId "${entry.dishId}"`);
      hasBlockingError = true;
    }
    if (seenDishIds.has(entry.dishId)) {
      errors.push(`${prefix}: Duplicate dishId "${entry.dishId}"`);
      hasBlockingError = true;
    }
    seenDishIds.add(entry.dishId);

    // nutrientId presence and format
    if (!entry.nutrientId || !UUID_REGEX.test(entry.nutrientId)) {
      errors.push(`${prefix}: Missing or invalid nutrientId "${entry.nutrientId}"`);
      hasBlockingError = true;
    }
    if (seenNutrientIds.has(entry.nutrientId)) {
      errors.push(`${prefix}: Duplicate nutrientId "${entry.nutrientId}"`);
      hasBlockingError = true;
    }
    seenNutrientIds.add(entry.nutrientId);

    // Required string fields
    if (!entry.name || entry.name.trim().length === 0) {
      errors.push(`${prefix}: Missing or empty name`);
      hasBlockingError = true;
    }
    if (!entry.nameEs || entry.nameEs.trim().length === 0) {
      errors.push(`${prefix}: Missing or empty nameEs`);
      hasBlockingError = true;
    }

    // name must equal nameEs (Spanish cuisine — all names are Spanish)
    if (entry.name && entry.nameEs && entry.name !== entry.nameEs) {
      errors.push(`${prefix}: name "${entry.name}" must equal nameEs "${entry.nameEs}" for Spanish dishes`);
      hasBlockingError = true;
    }

    // Aliases must be an array
    if (!Array.isArray(entry.aliases)) {
      errors.push(`${prefix}: aliases must be an array, got ${typeof entry.aliases}`);
      hasBlockingError = true;
    }

    // Source validation
    if (!VALID_SOURCES.has(entry.source)) {
      errors.push(`${prefix}: Invalid source "${entry.source}", must be "bedca" or "recipe"`);
      hasBlockingError = true;
    }

    // Source / confidence / estimation consistency (blocking)
    if (entry.source === 'bedca' && (entry.confidenceLevel !== 'high' || entry.estimationMethod !== 'official')) {
      errors.push(`${prefix}: BEDCA source must have confidenceLevel='high' and estimationMethod='official'`);
      hasBlockingError = true;
    }
    if (entry.source === 'recipe' && (entry.confidenceLevel !== 'medium' || entry.estimationMethod !== 'ingredients')) {
      errors.push(`${prefix}: Recipe source must have confidenceLevel='medium' and estimationMethod='ingredients'`);
      hasBlockingError = true;
    }

    // Portion grams range
    if (entry.portionGrams < 10 || entry.portionGrams > 800) {
      errors.push(`${prefix}: portionGrams ${entry.portionGrams} out of range [10, 800]`);
      hasBlockingError = true;
    }

    // Nutrient validation
    for (const field of NUTRIENT_FIELDS) {
      const value = entry.nutrients[field];
      if (typeof value !== 'number' || value < 0) {
        errors.push(`${prefix}: negative or missing nutrient "${field}" = ${value}`);
        hasBlockingError = true;
      }
    }

    // Calorie limits
    if (entry.nutrients.calories > 3000) {
      errors.push(`${prefix}: calories ${entry.nutrients.calories} exceeds 3000 per serving`);
      hasBlockingError = true;
    } else if (entry.nutrients.calories > 2000) {
      errors.push(`[WARN] ${prefix}: high calories ${entry.nutrients.calories} per serving (>2000)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Second pass: cross-space key uniqueness
  // ---------------------------------------------------------------------------
  //
  // Accent-preservation note: normalization uses toLowerCase() only — no NFD/NFC stripping.
  // Accented forms (e.g. calçots, ñ, á) and their unaccented equivalents are distinct keys,
  // matching the L1 lookup SQL (LOWER() without unaccent()) and the CE-271 precedent
  // where "calçots" and "calcots" coexist as separate aliases on the same dish.
  //
  // keySpaceMap: Map<normalizedTerm, externalId[]>
  const keySpaceMap = new Map<string, string[]>();

  for (const entry of dishes) {
    // Guard against aliases being null/undefined/non-array — the existing
    // validator records that as a blocking error but CONTINUES iterating.
    // The second pass must not throw on the same input.
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const nameLower = typeof entry.nameEs === 'string' ? entry.nameEs.toLowerCase() : '';
    const terms: string[] = nameLower ? [nameLower] : [];
    for (const alias of aliases) {
      if (typeof alias === 'string') terms.push(alias.toLowerCase());
    }
    // Deduplicate terms within this dish (name === nameEs, avoid self-false-collision)
    const uniqueTerms = [...new Set(terms)];
    for (const term of uniqueTerms) {
      if (!keySpaceMap.has(term)) keySpaceMap.set(term, []);
      const owners = keySpaceMap.get(term);
      if (owners) owners.push(entry.externalId);
    }
  }

  for (const [term, externalIds] of keySpaceMap) {
    if (externalIds.length <= 1) continue; // no collision

    // Resolve dishIds for the colliding externalIds
    const collidingDishIds = externalIds.map((eid) => externalIdToDishId.get(eid) ?? '');

    // Check allow-list: find an entry where alias matches AND dishIds are a strict set-equal match
    const allowed = allowList.some((entry) => {
      if (entry.alias !== term) return false;
      const entrySet = new Set(entry.dishIds);
      const collidingSet = new Set(collidingDishIds);
      if (entrySet.size !== collidingSet.size) return false;
      return [...collidingSet].every((id) => entrySet.has(id));
    });

    if (!allowed) {
      errors.push(
        `Collision in lookup key space: term "${term}" is shared by dishes [${externalIds.join(', ')}]`,
      );
      hasBlockingError = true;
    }
  }

  return {
    valid: !hasBlockingError,
    errors,
  };
}
