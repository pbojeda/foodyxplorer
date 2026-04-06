/**
 * F080 — OFF Mapper Unit Tests
 *
 * Tests for mapOffProductToFood() — all field mappings and nutrient conversions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapOffProductToFood } from '../ingest/off/offMapper.js';
import { OFF_SOURCE_UUID } from '../ingest/off/types.js';
import type { OffProduct } from '../ingest/off/types.js';

// ---------------------------------------------------------------------------
// Spy on console.log to verify conversion logs
// ---------------------------------------------------------------------------

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helper: build a fully populated OFF product
// ---------------------------------------------------------------------------

function fullProduct(overrides: Partial<OffProduct> = {}): OffProduct {
  return {
    code: '8480000123456',
    _id: 'abc123',
    product_name: 'Potato Omelette',
    product_name_es: 'Tortilla de Patatas',
    brands: 'Hacendado, Mercadona',
    categories_tags: ['en:prepared-meals', 'en:omelettes'],
    nutriments: {
      'energy-kcal_100g': 160,
      proteins_100g: 6.5,
      carbohydrates_100g: 12.3,
      sugars_100g: 1.2,
      fat_100g: 9.1,
      'saturated-fat_100g': 2.5,
      fiber_100g: 0.8,
      salt_100g: 0.6,
      sodium_100g: 0.24,
      'trans-fat_100g': 0.1,
      cholesterol_100g: 250, // mg → g
      potassium_100g: 300,   // mg → g
      'monounsaturated-fat_100g': 3.5,
      'polyunsaturated-fat_100g': 1.1,
      alcohol_100g: 0,
    },
    nutriscore_grade: 'b',
    nova_group: 4,
    allergens_text_es: 'Contiene: huevo',
    ingredients_text_es: 'Patata 65%, huevo 20%, aceite de girasol 14%',
    serving_size: '200g',
    image_url: 'https://images.openfoodfacts.org/images/products/848/000/012/3456/front.jpg',
    last_modified_t: 1700000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapOffProductToFood', () => {
  describe('food fields', () => {
    it('sets externalId to OFF-{code} when code is present', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.externalId).toBe('OFF-8480000123456');
    });

    it('sets externalId to OFF-id-{_id} when code is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ code: undefined }));
      expect(food.externalId).toBe('OFF-id-abc123');
    });

    it('sets name to product_name when present', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.name).toBe('Potato Omelette');
    });

    it('falls back name to product_name_es when product_name is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ product_name: undefined }));
      expect(food.name).toBe('Tortilla de Patatas');
    });

    it('sets nameEs to product_name_es when present', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.nameEs).toBe('Tortilla de Patatas');
    });

    it('falls back nameEs to product_name when product_name_es is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ product_name_es: undefined }));
      expect(food.nameEs).toBe('Potato Omelette');
    });

    it('sets barcode to code when present', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.barcode).toBe('8480000123456');
    });

    it('sets barcode to null when code is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ code: undefined }));
      expect(food.barcode).toBeNull();
    });

    it('sets brandName to first entry in brands (lowercase, trimmed)', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.brandName).toBe('hacendado');
    });

    it('sets brandName to null when brands is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ brands: undefined }));
      expect(food.brandName).toBeNull();
    });

    it('extracts foodGroup from first en: category tag (prefix stripped)', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.foodGroup).toBe('prepared-meals');
    });

    it('sets foodGroup to null when categories_tags is absent', () => {
      const { food } = mapOffProductToFood(fullProduct({ categories_tags: undefined }));
      expect(food.foodGroup).toBeNull();
    });

    it('sets foodGroup to null when no en: tag found', () => {
      const { food } = mapOffProductToFood(
        fullProduct({ categories_tags: ['fr:plats-cuisines', 'de:fertiggerichte'] }),
      );
      expect(food.foodGroup).toBeNull();
    });

    it('truncates foodGroup to 100 chars max', () => {
      const longTag = 'en:' + 'a'.repeat(200);
      const { food } = mapOffProductToFood(
        fullProduct({ categories_tags: [longTag] }),
      );
      expect(food.foodGroup).toHaveLength(100);
    });

    it('sets foodType to "branded" always', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.foodType).toBe('branded');
    });

    it('sets confidenceLevel to "high" always', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.confidenceLevel).toBe('high');
    });

    it('sets aliases to empty array always', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.aliases).toEqual([]);
    });

    it('sets sourceId to OFF_SOURCE_UUID', () => {
      const { food } = mapOffProductToFood(fullProduct());
      expect(food.sourceId).toBe(OFF_SOURCE_UUID);
    });
  });

  describe('nutrient fields', () => {
    it('maps calories directly from energy-kcal_100g', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.calories).toBe(160);
    });

    it('maps proteins_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.proteins).toBe(6.5);
    });

    it('maps carbohydrates_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.carbohydrates).toBe(12.3);
    });

    it('maps sugars_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.sugars).toBe(1.2);
    });

    it('maps fat_100g to fats directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.fats).toBe(9.1);
    });

    it('maps saturated-fat_100g to saturatedFats directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.saturatedFats).toBe(2.5);
    });

    it('maps fiber_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.fiber).toBe(0.8);
    });

    it('maps salt_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.salt).toBe(0.6);
    });

    it('maps sodium_100g directly (already in g)', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.sodium).toBe(0.24);
    });

    it('converts cholesterol from mg to g (÷1000)', () => {
      const { nutrients } = mapOffProductToFood(fullProduct()); // 250 mg
      expect(nutrients.cholesterol).toBeCloseTo(0.25, 5);
    });

    it('converts potassium from mg to g (÷1000)', () => {
      const { nutrients } = mapOffProductToFood(fullProduct()); // 300 mg
      expect(nutrients.potassium).toBeCloseTo(0.3, 5);
    });

    it('maps trans-fat_100g to transFats directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.transFats).toBe(0.1);
    });

    it('maps monounsaturated-fat_100g to monounsaturatedFats', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.monounsaturatedFats).toBe(3.5);
    });

    it('maps polyunsaturated-fat_100g to polyunsaturatedFats', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.polyunsaturatedFats).toBe(1.1);
    });

    it('maps alcohol_100g directly', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.alcohol).toBe(0);
    });

    it('sets referenceBasis to per_100g always', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      expect(nutrients.referenceBasis).toBe('per_100g');
    });

    it('defaults optional nutrients to 0 when absent (fiber)', () => {
      const { nutrients } = mapOffProductToFood(
        fullProduct({
          nutriments: {
            'energy-kcal_100g': 160,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
            // fiber, transFats, etc. absent
          },
        }),
      );
      expect(nutrients.fiber).toBe(0);
      expect(nutrients.transFats).toBe(0);
      expect(nutrients.cholesterol).toBe(0);
      expect(nutrients.potassium).toBe(0);
      expect(nutrients.monounsaturatedFats).toBe(0);
      expect(nutrients.polyunsaturatedFats).toBe(0);
      expect(nutrients.alcohol).toBe(0);
    });
  });

  describe('kJ → kcal conversion', () => {
    it('converts energy_100g (kJ) to kcal when energy-kcal_100g is absent', () => {
      const { nutrients } = mapOffProductToFood(
        fullProduct({
          nutriments: {
            energy_100g: 1674, // 1674 / 4.184 ≈ 400 kcal
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
          },
        }),
      );
      expect(nutrients.calories).toBeCloseTo(400, 0);
    });

    it('logs kJ→kcal conversion', () => {
      mapOffProductToFood(
        fullProduct({
          code: '8480000123456',
          nutriments: {
            energy_100g: 1674,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
          },
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('OFF-8480000123456'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('kJ'),
      );
    });
  });

  describe('sodium derivation from salt', () => {
    it('derives sodium from salt when sodium_100g is absent', () => {
      const { nutrients } = mapOffProductToFood(
        fullProduct({
          nutriments: {
            'energy-kcal_100g': 160,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
            salt_100g: 1.0,
            // sodium_100g absent
          },
        }),
      );
      // sodium = salt / 2.5 = 1.0 / 2.5 = 0.4
      expect(nutrients.sodium).toBeCloseTo(0.4, 5);
    });

    it('logs sodium derivation from salt', () => {
      mapOffProductToFood(
        fullProduct({
          code: '8480000123456',
          nutriments: {
            'energy-kcal_100g': 160,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
            salt_100g: 1.0,
          },
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('sodium'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('salt'),
      );
    });

    it('defaults both salt and sodium to 0 when both absent, and logs it', () => {
      const { nutrients } = mapOffProductToFood(
        fullProduct({
          code: '8480000999999',
          nutriments: {
            'energy-kcal_100g': 160,
            proteins_100g: 6,
            carbohydrates_100g: 12,
            fat_100g: 9,
            // no salt, no sodium
          },
        }),
      );
      expect(nutrients.salt).toBe(0);
      expect(nutrients.sodium).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('absent'),
      );
    });
  });

  describe('extra.offMeta', () => {
    it('populates all offMeta fields from source product', () => {
      const { nutrients } = mapOffProductToFood(fullProduct());
      const meta = nutrients.extra.offMeta;
      expect(meta.nutriscoreGrade).toBe('b');
      expect(meta.novaGroup).toBe(4);
      expect(meta.allergensText).toBe('Contiene: huevo');
      expect(meta.ingredientsText).toBe('Patata 65%, huevo 20%, aceite de girasol 14%');
      expect(meta.servingSize).toBe('200g');
      expect(meta.imageUrl).toBe('https://images.openfoodfacts.org/images/products/848/000/012/3456/front.jpg');
      // lastModified: Unix ts 1700000000 → ISO string
      expect(meta.lastModified).not.toBeNull();
    });

    it('sets offMeta fields to null when absent', () => {
      const { nutrients } = mapOffProductToFood(
        fullProduct({
          nutriscore_grade: undefined,
          nova_group: undefined,
          allergens_text_es: undefined,
          ingredients_text_es: undefined,
          serving_size: undefined,
          image_url: undefined,
          last_modified_t: undefined,
        }),
      );
      const meta = nutrients.extra.offMeta;
      expect(meta.nutriscoreGrade).toBeNull();
      expect(meta.novaGroup).toBeNull();
      expect(meta.allergensText).toBeNull();
      expect(meta.ingredientsText).toBeNull();
      expect(meta.servingSize).toBeNull();
      expect(meta.imageUrl).toBeNull();
      expect(meta.lastModified).toBeNull();
    });
  });
});
