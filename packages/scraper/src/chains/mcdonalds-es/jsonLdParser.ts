// JSON-LD parser for McDonald's Spain product pages.
//
// Extracts NutritionInformation structured data from a raw JSON-LD string.
// Supports three embedding patterns:
//   1. Top-level @type: "NutritionInformation"
//   2. Nested inside a Product: { "@type": "Product", "nutrition": { ... } }
//   3. Inside a @graph array: [ { "@type": "Product", "nutrition": { ... } }, ... ]
//
// Values are returned as-is (e.g. "490 cal", "19 g") — coercion happens
// downstream in normalizeNutrients() via coerceNutrient().

import type { RawDishData } from '../../base/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NutrientPartial = Partial<RawDishData['nutrients']>;

// Minimal shape we expect from a NutritionInformation JSON-LD node.
interface NutritionInfoNode {
  '@type'?: string;
  calories?: string;
  fatContent?: string;
  saturatedFatContent?: string;
  transFatContent?: string;
  carbohydrateContent?: string;
  sugarContent?: string;
  fiberContent?: string;
  proteinContent?: string;
  sodiumContent?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a NutritionInformation node from a parsed JSON-LD value.
 * Handles top-level, nested-in-Product, and @graph patterns.
 */
function findNutritionNode(data: unknown): NutritionInfoNode | null {
  if (data === null || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Pattern 1: top-level NutritionInformation
  if (obj['@type'] === 'NutritionInformation') {
    return obj as NutritionInfoNode;
  }

  // Pattern 2: Product with nested nutrition
  if (obj['@type'] === 'Product' && obj['nutrition'] !== undefined) {
    const nutrition = obj['nutrition'] as Record<string, unknown>;
    if (nutrition['@type'] === 'NutritionInformation') {
      return nutrition as NutritionInfoNode;
    }
  }

  // Pattern 3: @graph array — search each node
  if (Array.isArray(obj['@graph'])) {
    for (const node of obj['@graph'] as unknown[]) {
      const found = findNutritionNode(node);
      if (found !== null) return found;
    }
  }

  // Pattern 4: top-level array
  if (Array.isArray(data)) {
    for (const node of data as unknown[]) {
      const found = findNutritionNode(node);
      if (found !== null) return found;
    }
  }

  return null;
}

/**
 * Maps a NutritionInformation node to our RawDishData nutrients partial.
 * Returns undefined for any field not present in the node.
 */
function mapNutritionNode(node: NutritionInfoNode): NutrientPartial {
  const result: NutrientPartial = {};

  if (node.calories !== undefined)            result.calories = node.calories;
  if (node.fatContent !== undefined)          result.fats = node.fatContent;
  if (node.saturatedFatContent !== undefined) result.saturatedFats = node.saturatedFatContent;
  if (node.transFatContent !== undefined)     result.transFats = node.transFatContent;
  if (node.carbohydrateContent !== undefined) result.carbohydrates = node.carbohydrateContent;
  if (node.sugarContent !== undefined)        result.sugars = node.sugarContent;
  if (node.fiberContent !== undefined)        result.fiber = node.fiberContent;
  if (node.proteinContent !== undefined)      result.proteins = node.proteinContent;
  if (node.sodiumContent !== undefined)       result.sodium = node.sodiumContent;

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a raw JSON-LD string and extracts nutritional data.
 *
 * @param raw - The raw text content of a `<script type="application/ld+json">` tag.
 * @returns A partial nutrients object, or null if no NutritionInformation found
 *          or if the JSON is malformed.
 */
export function parseJsonLd(raw: string): NutrientPartial | null {
  let data: unknown;

  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const node = findNutritionNode(data);
  if (node === null) return null;

  return mapNutritionNode(node);
}

/**
 * Returns true if the nutrition partial contains all four required fields
 * (calories, proteins, carbohydrates, fats). Used to decide whether to fall
 * back to the HTML table extractor.
 *
 * @param nutrition - Output of parseJsonLd(), or null.
 */
export function isComplete(nutrition: NutrientPartial | null): boolean {
  if (nutrition === null) return false;

  // A field is "present" only if it is a non-empty, non-null value.
  // null or '' would pass coerceNutrient as 0 or NaN — trigger table fallback instead.
  const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

  return (
    hasValue(nutrition.calories) &&
    hasValue(nutrition.proteins) &&
    hasValue(nutrition.carbohydrates) &&
    hasValue(nutrition.fats)
  );
}
