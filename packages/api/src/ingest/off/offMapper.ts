/**
 * F080 — OFF Product Mapper
 *
 * Maps a raw OFF product to the nutriXplorer MappedOffFood shape,
 * ready for DB upsert into foods + food_nutrients tables.
 *
 * Unit conversions:
 * - cholesterol_100g: mg → g (÷1000)
 * - potassium_100g: mg → g (÷1000)
 * - energy_100g (kJ): fallback when energy-kcal_100g absent (÷4.184); logged
 * - sodium: derived from salt when sodium_100g absent (÷2.5); logged
 * - Both sodium + salt absent: default to 0; logged
 */

import type { OffProduct, MappedOffFood } from './types.js';
import { OFF_SOURCE_UUID } from './types.js';

/** kJ → kcal conversion factor. */
const KJ_TO_KCAL = 4.184;

/** mg → g conversion factor. */
const MG_TO_G = 1000;

/**
 * Compute the stable external identifier for a product.
 * Prefers EAN barcode. Falls back to OFF internal _id.
 */
function computeExternalId(product: OffProduct): string {
  const code = product.code?.trim();
  if (code) {
    return `OFF-${code}`;
  }
  return `OFF-id-${product._id?.trim()}`;
}

/**
 * Extract the first `en:` category tag, strip the prefix, and truncate to 100 chars.
 * Returns null when absent or no en: tag found.
 */
function extractFoodGroup(categoriesTags: string[] | undefined): string | null {
  if (!categoriesTags || categoriesTags.length === 0) return null;
  const enTag = categoriesTags.find((t) => t.startsWith('en:'));
  if (!enTag) return null;
  const stripped = enTag.slice(3); // remove "en:" prefix
  return stripped.length > 100 ? stripped.slice(0, 100) : stripped;
}

/**
 * Map a raw OFF product to the nutriXplorer MappedOffFood shape.
 *
 * Callers must have validated the product with validateOffProduct() first.
 * This function does NOT re-validate — it assumes valid input.
 */
export function mapOffProductToFood(product: OffProduct): MappedOffFood {
  const externalId = computeExternalId(product);
  const idForLog = externalId;

  const n = product.nutriments ?? {};

  // ---------------------------------------------------------------------------
  // Calories: prefer kcal, fall back to kJ conversion
  // ---------------------------------------------------------------------------
  let calories: number;
  if (typeof n['energy-kcal_100g'] === 'number') {
    calories = n['energy-kcal_100g'];
  } else if (typeof n['energy_100g'] === 'number') {
    const kj = n['energy_100g'];
    calories = kj / KJ_TO_KCAL;
    console.log(
      `${idForLog}: converted energy from kJ (${kj}) to kcal (${calories.toFixed(1)})`,
    );
  } else {
    calories = 0;
  }

  // ---------------------------------------------------------------------------
  // Salt + Sodium with derivation logic
  // ---------------------------------------------------------------------------
  const hasSodium = typeof n.sodium_100g === 'number';
  const hasSalt = typeof n.salt_100g === 'number';

  let salt: number;
  let sodium: number;

  if (hasSodium && hasSalt) {
    sodium = n.sodium_100g as number;
    salt = n.salt_100g as number;
  } else if (hasSodium && !hasSalt) {
    sodium = n.sodium_100g as number;
    // salt = sodium * 2.5 (EU Regulation 1169/2011)
    salt = sodium * 2.5;
  } else if (!hasSodium && hasSalt) {
    salt = n.salt_100g as number;
    sodium = salt / 2.5;
    console.log(
      `${idForLog}: derived sodium from salt (${salt} / 2.5 = ${sodium.toFixed(4)})`,
    );
  } else {
    // Both absent — default to 0
    salt = 0;
    sodium = 0;
    console.log(`${idForLog}: sodium and salt absent — defaulted to 0`);
  }

  // ---------------------------------------------------------------------------
  // Food fields
  // ---------------------------------------------------------------------------
  const name = product.product_name?.trim() || product.product_name_es?.trim() || '';
  const nameEs = product.product_name_es?.trim() || product.product_name?.trim() || null;

  const rawBrand = product.brands?.split(',')[0]?.trim().toLowerCase();
  const brandName = rawBrand || null;

  const trimmedCode = product.code?.trim();
  const barcode = trimmedCode || null;

  const foodGroup = extractFoodGroup(product.categories_tags);

  // ---------------------------------------------------------------------------
  // Nutrient fields
  // ---------------------------------------------------------------------------
  const cholesterol = typeof n.cholesterol_100g === 'number' ? n.cholesterol_100g / MG_TO_G : 0;
  const potassium = typeof n.potassium_100g === 'number' ? n.potassium_100g / MG_TO_G : 0;

  // ---------------------------------------------------------------------------
  // offMeta (extra JSONB)
  // ---------------------------------------------------------------------------
  const lastModified =
    typeof product.last_modified_t === 'number'
      ? new Date(product.last_modified_t * 1000).toISOString()
      : null;

  return {
    food: {
      name,
      nameEs,
      aliases: [],
      foodGroup,
      foodType: 'branded',
      confidenceLevel: 'high',
      sourceId: OFF_SOURCE_UUID,
      externalId,
      barcode,
      brandName: brandName !== '' ? brandName : null,
    },
    nutrients: {
      calories,
      proteins: n.proteins_100g ?? 0,
      carbohydrates: n.carbohydrates_100g ?? 0,
      sugars: n.sugars_100g ?? 0,
      fats: n.fat_100g ?? 0,
      saturatedFats: n['saturated-fat_100g'] ?? 0,
      fiber: n.fiber_100g ?? 0,
      salt,
      sodium,
      transFats: n['trans-fat_100g'] ?? 0,
      cholesterol,
      potassium,
      monounsaturatedFats: n['monounsaturated-fat_100g'] ?? 0,
      polyunsaturatedFats: n['polyunsaturated-fat_100g'] ?? 0,
      alcohol: n.alcohol_100g ?? 0,
      referenceBasis: 'per_100g',
      extra: {
        offMeta: {
          nutriscoreGrade: product.nutriscore_grade ?? null,
          novaGroup: product.nova_group ?? null,
          allergensText: product.allergens_text_es ?? null,
          ingredientsText: product.ingredients_text_es ?? null,
          servingSize: product.serving_size ?? null,
          imageUrl: product.image_url ?? null,
          lastModified,
        },
      },
    },
  };
}
