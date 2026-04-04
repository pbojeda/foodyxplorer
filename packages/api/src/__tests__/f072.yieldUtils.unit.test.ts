// Unit tests for F072 — yieldUtils.ts pure functions
//
// Covers: normalizeFoodGroup, getDefaultCookingMethod, getDefaultCookingState,
//         isAlreadyCookedFood, applyYieldFactor

import { describe, it, expect } from 'vitest';
import type { EstimateNutrients } from '@foodxplorer/shared';
import {
  normalizeFoodGroup,
  getDefaultCookingMethod,
  getDefaultCookingState,
  isAlreadyCookedFood,
  applyYieldFactor,
} from '../estimation/yieldUtils.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAW_RICE_NUTRIENTS: EstimateNutrients = {
  calories: 360,
  proteins: 7.0,
  carbohydrates: 79.0,
  sugars: 0.1,
  fats: 0.6,
  saturatedFats: 0.1,
  fiber: 1.3,
  salt: 0.0,
  sodium: 1.0,
  transFats: 0.0,
  cholesterol: 0.0,
  potassium: 115.0,
  monounsaturatedFats: 0.2,
  polyunsaturatedFats: 0.2,
  alcohol: 0,
  referenceBasis: 'per_100g',
};

// ---------------------------------------------------------------------------
// normalizeFoodGroup
// ---------------------------------------------------------------------------

describe('normalizeFoodGroup', () => {
  // --- grains ---
  it('maps "Cereal Grains and Pasta" → "grains"', () => {
    expect(normalizeFoodGroup('Cereal Grains and Pasta')).toBe('grains');
  });

  it('maps "cereal" (lowercase) → "grains"', () => {
    expect(normalizeFoodGroup('cereal')).toBe('grains');
  });

  it('maps "Whole Grain Products" → "grains"', () => {
    expect(normalizeFoodGroup('Whole Grain Products')).toBe('grains');
  });

  // --- pasta ---
  it('maps "Pasta Products" → "pasta"', () => {
    expect(normalizeFoodGroup('Pasta Products')).toBe('pasta');
  });

  it('maps "pasta" (lowercase) → "pasta"', () => {
    expect(normalizeFoodGroup('pasta')).toBe('pasta');
  });

  // --- legumes ---
  it('maps "Legumes and Legume Products" → "legumes"', () => {
    expect(normalizeFoodGroup('Legumes and Legume Products')).toBe('legumes');
  });

  it('maps "Bean Products" → "legumes"', () => {
    expect(normalizeFoodGroup('Bean Products')).toBe('legumes');
  });

  it('maps "Lentil Products" → "legumes"', () => {
    expect(normalizeFoodGroup('Lentil Products')).toBe('legumes');
  });

  it('maps "Chickpea" → "legumes"', () => {
    expect(normalizeFoodGroup('Chickpea')).toBe('legumes');
  });

  // --- meat ---
  it('maps "Beef Products" → "meat"', () => {
    expect(normalizeFoodGroup('Beef Products')).toBe('meat');
  });

  it('maps "Pork Products" → "meat"', () => {
    expect(normalizeFoodGroup('Pork Products')).toBe('meat');
  });

  it('maps "Lamb" → "meat"', () => {
    expect(normalizeFoodGroup('Lamb')).toBe('meat');
  });

  it('maps "Poultry Products" → "meat"', () => {
    expect(normalizeFoodGroup('Poultry Products')).toBe('meat');
  });

  it('maps "Chicken" → "meat"', () => {
    expect(normalizeFoodGroup('Chicken')).toBe('meat');
  });

  it('maps "Meat Products" → "meat"', () => {
    expect(normalizeFoodGroup('Meat Products')).toBe('meat');
  });

  // --- fish ---
  it('maps "Fish Products" → "fish"', () => {
    expect(normalizeFoodGroup('Fish Products')).toBe('fish');
  });

  it('maps "Finfish and Shellfish Products" → "fish"', () => {
    expect(normalizeFoodGroup('Finfish and Shellfish Products')).toBe('fish');
  });

  it('maps "Seafood" → "fish"', () => {
    expect(normalizeFoodGroup('Seafood')).toBe('fish');
  });

  it('maps "Shellfish" → "fish"', () => {
    expect(normalizeFoodGroup('Shellfish')).toBe('fish');
  });

  it('maps "Finfish" → "fish"', () => {
    expect(normalizeFoodGroup('Finfish')).toBe('fish');
  });

  // --- vegetables ---
  it('maps "Vegetables and Vegetable Products" → "vegetables"', () => {
    expect(normalizeFoodGroup('Vegetables and Vegetable Products')).toBe('vegetables');
  });

  it('maps "Potato Products" → "vegetables"', () => {
    expect(normalizeFoodGroup('Potato Products')).toBe('vegetables');
  });

  it('maps "Tomato Products" → "vegetables"', () => {
    expect(normalizeFoodGroup('Tomato Products')).toBe('vegetables');
  });

  it('maps "Pepper" → "vegetables"', () => {
    expect(normalizeFoodGroup('Pepper')).toBe('vegetables');
  });

  // --- case-insensitive ---
  it('is case-insensitive: "BEEF PRODUCTS" → "meat"', () => {
    expect(normalizeFoodGroup('BEEF PRODUCTS')).toBe('meat');
  });

  it('is case-insensitive: "Fish" → "fish"', () => {
    expect(normalizeFoodGroup('Fish')).toBe('fish');
  });

  // --- unmatched ---
  it('returns null for "Dairy Products"', () => {
    expect(normalizeFoodGroup('Dairy Products')).toBeNull();
  });

  it('returns null for "Beverages"', () => {
    expect(normalizeFoodGroup('Beverages')).toBeNull();
  });

  it('returns null for "Snacks"', () => {
    expect(normalizeFoodGroup('Snacks')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeFoodGroup('')).toBeNull();
  });

  // --- grains takes priority over pasta when both keywords present ---
  it('"Cereal Grains and Pasta" → "grains" not "pasta" (grains checked first)', () => {
    // "Cereal Grains and Pasta" contains "grain" keyword which matches "grains"
    // grains is checked before pasta in the implementation to handle this USDA category
    expect(normalizeFoodGroup('Cereal Grains and Pasta')).toBe('grains');
  });
});

// ---------------------------------------------------------------------------
// getDefaultCookingMethod
// ---------------------------------------------------------------------------

describe('getDefaultCookingMethod', () => {
  it('grains → "boiled"', () => {
    expect(getDefaultCookingMethod('grains')).toBe('boiled');
  });

  it('legumes → "boiled"', () => {
    expect(getDefaultCookingMethod('legumes')).toBe('boiled');
  });

  it('pasta → "boiled"', () => {
    expect(getDefaultCookingMethod('pasta')).toBe('boiled');
  });

  it('vegetables → "boiled"', () => {
    expect(getDefaultCookingMethod('vegetables')).toBe('boiled');
  });

  it('meat → "grilled"', () => {
    expect(getDefaultCookingMethod('meat')).toBe('grilled');
  });

  it('fish → "grilled"', () => {
    expect(getDefaultCookingMethod('fish')).toBe('grilled');
  });

  it('null (composite/unknown) → null', () => {
    expect(getDefaultCookingMethod(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDefaultCookingState
// ---------------------------------------------------------------------------

describe('getDefaultCookingState', () => {
  it('grains → "cooked" (users report serving weight)', () => {
    expect(getDefaultCookingState('grains')).toBe('cooked');
  });

  it('legumes → "cooked"', () => {
    expect(getDefaultCookingState('legumes')).toBe('cooked');
  });

  it('pasta → "cooked"', () => {
    expect(getDefaultCookingState('pasta')).toBe('cooked');
  });

  it('meat → "raw" (traditional recipe writing convention)', () => {
    expect(getDefaultCookingState('meat')).toBe('raw');
  });

  it('fish → "raw" (consistent with USDA per-100g raw reference)', () => {
    expect(getDefaultCookingState('fish')).toBe('raw');
  });

  it('vegetables → "raw"', () => {
    expect(getDefaultCookingState('vegetables')).toBe('raw');
  });

  it('null (composite/unknown) → "as_served"', () => {
    expect(getDefaultCookingState(null)).toBe('as_served');
  });
});

// ---------------------------------------------------------------------------
// isAlreadyCookedFood
// ---------------------------------------------------------------------------

describe('isAlreadyCookedFood', () => {
  // Spanish keywords
  it('detects "hervido" (ES: boiled)', () => {
    expect(isAlreadyCookedFood('Arroz hervido')).toBe(true);
  });

  it('detects "cocido" (ES: cooked)', () => {
    expect(isAlreadyCookedFood('Pollo cocido')).toBe(true);
  });

  it('detects "frito" (ES: fried)', () => {
    expect(isAlreadyCookedFood('Huevo frito')).toBe(true);
  });

  it('detects "asado" (ES: roasted/grilled)', () => {
    expect(isAlreadyCookedFood('Pimiento asado')).toBe(true);
  });

  it('detects "al horno" (ES: baked)', () => {
    expect(isAlreadyCookedFood('Patata al horno')).toBe(true);
  });

  // English keywords
  it('detects "boiled" (EN)', () => {
    expect(isAlreadyCookedFood('Rice, boiled')).toBe(true);
  });

  it('detects "cooked" (EN)', () => {
    expect(isAlreadyCookedFood('Chicken, cooked')).toBe(true);
  });

  it('detects "fried" (EN)', () => {
    expect(isAlreadyCookedFood('Potato, fried')).toBe(true);
  });

  it('detects "grilled" (EN)', () => {
    expect(isAlreadyCookedFood('Salmon, grilled')).toBe(true);
  });

  it('detects "baked" (EN)', () => {
    expect(isAlreadyCookedFood('Chicken, baked')).toBe(true);
  });

  it('detects "steamed" (EN)', () => {
    expect(isAlreadyCookedFood('Broccoli, steamed')).toBe(true);
  });

  // Case-insensitive
  it('is case-insensitive: "HERVIDO"', () => {
    expect(isAlreadyCookedFood('ARROZ HERVIDO')).toBe(true);
  });

  it('is case-insensitive: "Boiled"', () => {
    expect(isAlreadyCookedFood('Rice, Boiled')).toBe(true);
  });

  // No false positives
  it('returns false for plain uncooked food name "Arroz"', () => {
    expect(isAlreadyCookedFood('Arroz')).toBe(false);
  });

  it('returns false for "Pollo crudo"', () => {
    expect(isAlreadyCookedFood('Pollo crudo')).toBe(false);
  });

  it('returns false for "Rice, raw"', () => {
    expect(isAlreadyCookedFood('Rice, raw')).toBe(false);
  });

  it('returns false for "Salmon fillet"', () => {
    expect(isAlreadyCookedFood('Salmon fillet')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAlreadyCookedFood('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyYieldFactor
// ---------------------------------------------------------------------------

describe('applyYieldFactor', () => {
  it('scales up nutrients for grains (yieldFactor=2.8 — absorbs water)', () => {
    // cooked weight = raw weight × 2.8; to convert cooked→raw divide by 2.8
    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8);

    // calories: 360 / 2.8 ≈ 128.57
    expect(result.calories).toBeCloseTo(360 / 2.8, 1);
    expect(result.proteins).toBeCloseTo(7.0 / 2.8, 2);
    expect(result.carbohydrates).toBeCloseTo(79.0 / 2.8, 2);
    expect(result.fats).toBeCloseTo(0.6 / 2.8, 3);
    expect(result.saturatedFats).toBeCloseTo(0.1 / 2.8, 3);
  });

  it('scales down nutrients for meat (yieldFactor=0.85 — loses moisture)', () => {
    // chicken breast raw; yieldFactor=0.85 means cooked is 85% of raw weight
    // to convert cooked grams → raw equivalent, divide by 0.85
    const chickenNutrients: EstimateNutrients = {
      ...RAW_RICE_NUTRIENTS,
      calories: 165,
      proteins: 31.0,
      fats: 3.6,
      carbohydrates: 0.0,
      sugars: 0.0,
    };

    const result = applyYieldFactor(chickenNutrients, 0.85);

    expect(result.calories).toBeCloseTo(165 / 0.85, 1);
    expect(result.proteins).toBeCloseTo(31.0 / 0.85, 2);
    expect(result.fats).toBeCloseTo(3.6 / 0.85, 2);
  });

  it('fat absorption is added to fats and calories BEFORE dividing by yieldFactor', () => {
    // fatAbsorption = 14g per 100g raw food (potato fried, yieldFactor=0.62)
    // Step 1: add fat absorption to fats: 0.6 + 14 = 14.6
    // Step 1: add calorie from fat: 360 + 14*9 = 360 + 126 = 486
    // Step 2: divide all by yieldFactor=0.62
    const fatAbsorption = 14.0;
    const yieldFactor = 0.62;

    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, yieldFactor, fatAbsorption);

    const expectedFats = (0.6 + fatAbsorption) / yieldFactor;
    const expectedCalories = (360 + fatAbsorption * 9) / yieldFactor;

    expect(result.fats).toBeCloseTo(expectedFats, 2);
    expect(result.calories).toBeCloseTo(expectedCalories, 1);
  });

  it('fat absorption does NOT affect saturatedFats', () => {
    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, 0.62, 14.0);
    // saturatedFats should only be divided by yieldFactor, not increased by fatAbsorption
    expect(result.saturatedFats).toBeCloseTo(RAW_RICE_NUTRIENTS.saturatedFats / 0.62, 3);
  });

  it('null fatAbsorption is skipped (no fat added)', () => {
    const withFat = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8, 14.0);
    const withoutFat = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8, null);

    // fats should differ when fat absorption is applied
    expect(withFat.fats).not.toBeCloseTo(withoutFat.fats, 2);
    // calories should differ
    expect(withFat.calories).not.toBeCloseTo(withoutFat.calories, 1);
  });

  it('undefined fatAbsorption is skipped (same as null)', () => {
    const withoutFat = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8);
    expect(withoutFat.calories).toBeCloseTo(RAW_RICE_NUTRIENTS.calories / 2.8, 1);
    expect(withoutFat.fats).toBeCloseTo(RAW_RICE_NUTRIENTS.fats / 2.8, 3);
  });

  it('is pure — does not mutate the input nutrients', () => {
    const originalCalories = RAW_RICE_NUTRIENTS.calories;
    applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8, 14.0);
    expect(RAW_RICE_NUTRIENTS.calories).toBe(originalCalories);
  });

  it('preserves referenceBasis from the input', () => {
    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8);
    expect(result.referenceBasis).toBe('per_100g');
  });

  it('divides ALL numeric nutrient keys (including extended nutrients)', () => {
    const yieldFactor = 2.0;
    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, yieldFactor);

    // Verify all 14 numeric fields are divided
    expect(result.potassium).toBeCloseTo(RAW_RICE_NUTRIENTS.potassium / yieldFactor, 3);
    expect(result.cholesterol).toBeCloseTo(RAW_RICE_NUTRIENTS.cholesterol / yieldFactor, 3);
    expect(result.transFats).toBeCloseTo(RAW_RICE_NUTRIENTS.transFats / yieldFactor, 3);
    expect(result.fiber).toBeCloseTo(RAW_RICE_NUTRIENTS.fiber / yieldFactor, 3);
    expect(result.salt).toBeCloseTo(RAW_RICE_NUTRIENTS.salt / yieldFactor, 3);
    expect(result.sodium).toBeCloseTo(RAW_RICE_NUTRIENTS.sodium / yieldFactor, 3);
    expect(result.monounsaturatedFats).toBeCloseTo(RAW_RICE_NUTRIENTS.monounsaturatedFats / yieldFactor, 3);
    expect(result.polyunsaturatedFats).toBeCloseTo(RAW_RICE_NUTRIENTS.polyunsaturatedFats / yieldFactor, 3);
    expect(result.sugars).toBeCloseTo(RAW_RICE_NUTRIENTS.sugars / yieldFactor, 3);
  });

  it('returns a new object (referential inequality with input)', () => {
    const result = applyYieldFactor(RAW_RICE_NUTRIENTS, 2.8);
    expect(result).not.toBe(RAW_RICE_NUTRIENTS);
  });
});
