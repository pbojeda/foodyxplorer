/**
 * F080 — Open Food Facts (OFF) Ingestion
 * Type definitions for OFF API data structures and mapped schema types.
 *
 * OFF API: https://world.openfoodfacts.org/
 * License: ODbL 1.0 — attribution required in all API responses.
 */

/** Deterministic UUID for the OFF DataSource row. Single source of truth. */
export const OFF_SOURCE_UUID = '00000000-0000-0000-0000-000000000004';

/** Nutriment fields returned by the OFF Search API per product. All values are per 100g. */
export interface OffNutriments {
  'energy-kcal_100g'?: number;
  'energy_100g'?: number; // kJ — fallback when kcal absent
  proteins_100g?: number;
  carbohydrates_100g?: number;
  sugars_100g?: number;
  fat_100g?: number;
  'saturated-fat_100g'?: number;
  fiber_100g?: number;
  salt_100g?: number;
  sodium_100g?: number;
  'trans-fat_100g'?: number;
  cholesterol_100g?: number; // mg
  potassium_100g?: number;   // mg
  'monounsaturated-fat_100g'?: number;
  'polyunsaturated-fat_100g'?: number;
  alcohol_100g?: number;
}

/** Raw product object as returned by the OFF Search/Product API. */
export interface OffProduct {
  /** EAN barcode (may be absent for some products). */
  code?: string;
  /** OFF internal unique identifier (fallback when no barcode). */
  _id?: string;
  /** English product name. */
  product_name?: string;
  /** Spanish product name. */
  product_name_es?: string;
  /** Comma-separated brand names. */
  brands?: string;
  /** Taxonomy category tags (e.g., ["en:prepared-meals", "en:pizzas"]). */
  categories_tags?: string[];
  /** Nutrient values per 100g. */
  nutriments?: OffNutriments;
  /** Nutri-Score grade: a, b, c, d, e. */
  nutriscore_grade?: string;
  /** NOVA group: 1, 2, 3, or 4. */
  nova_group?: number;
  /** Allergen text in Spanish. */
  allergens_text_es?: string;
  /** Ingredients text in Spanish. */
  ingredients_text_es?: string;
  /** Serving size description (e.g., "200g", "1 unidad"). */
  serving_size?: string;
  /** Product image URL. */
  image_url?: string;
  /** Unix timestamp of last modification. */
  last_modified_t?: number;
}

/**
 * OFF product mapped to the nutriXplorer schema, ready for DB upsert.
 *
 * food: all foods columns except id/createdAt/updatedAt
 * nutrients: all food_nutrients columns except id/foodId/createdAt/updatedAt
 */
export interface MappedOffFood {
  food: {
    name: string;
    nameEs: string | null;
    aliases: string[];
    foodGroup: string | null;
    foodType: 'branded';
    confidenceLevel: 'high';
    sourceId: string;
    externalId: string;
    barcode: string | null;
    brandName: string | null;
  };
  nutrients: {
    calories: number;
    proteins: number;
    carbohydrates: number;
    sugars: number;
    fats: number;
    saturatedFats: number;
    fiber: number;
    salt: number;
    sodium: number;
    transFats: number;
    cholesterol: number;
    potassium: number;
    monounsaturatedFats: number;
    polyunsaturatedFats: number;
    alcohol: number;
    referenceBasis: 'per_100g';
    extra: {
      offMeta: {
        nutriscoreGrade: string | null;
        novaGroup: number | null;
        allergensText: string | null;
        ingredientsText: string | null;
        servingSize: string | null;
        imageUrl: string | null;
        lastModified: string | null;
      };
    };
  };
}
