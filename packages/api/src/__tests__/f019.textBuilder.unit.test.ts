// Unit tests for F019 text builder — buildFoodText, buildDishText, mapFoodRow, mapDishRow
//
// Pure functions, no DB, no mocks needed.

import { describe, it, expect } from 'vitest';
import {
  buildFoodText,
  buildDishText,
} from '../embeddings/textBuilder.js';
import {
  mapFoodRow,
  mapDishRow,
  type FoodRowRaw,
  type DishRowRaw,
} from '../embeddings/types.js';

// ---------------------------------------------------------------------------
// buildFoodText tests
// ---------------------------------------------------------------------------

describe('buildFoodText', () => {
  const fullFood = {
    id: 'f019food-0001-4000-a000-000000000001',
    name: 'Chicken Breast',
    nameEs: 'Pechuga de pollo',
    foodGroup: 'Poultry Products',
    foodType: 'generic',
    calories: 165,
    proteins: 31,
    carbohydrates: 0,
    sugars: 0,
    fats: 3.6,
    saturatedFats: 1,
    fiber: 0,
    sodium: 74,
  };

  it('produces expected text when all fields are present', () => {
    const text = buildFoodText(fullFood);
    expect(text).toContain('Food: Chicken Breast.');
    expect(text).toContain('Spanish name: Pechuga de pollo.');
    expect(text).toContain('Type: generic.');
    expect(text).toContain('Category: Poultry Products.');
    expect(text).toContain('Nutrition per 100g:');
    expect(text).toContain('165 kcal');
    expect(text).toContain('31g protein');
    expect(text).toContain('0g carbohydrates');
    expect(text).toContain('0g sugars');
    expect(text).toContain('3.6g fat');
    expect(text).toContain('1g saturated fat');
    expect(text).toContain('0g fiber');
    expect(text).toContain('74mg sodium');
  });

  it('omits Category line when foodGroup is null', () => {
    const text = buildFoodText({ ...fullFood, foodGroup: null });
    expect(text).not.toContain('Category:');
    expect(text).toContain('Food: Chicken Breast.');
    expect(text).toContain('Type: generic.');
  });

  it('always includes Spanish name (nameEs is NOT NULL for foods)', () => {
    const text = buildFoodText({ ...fullFood });
    expect(text).toContain('Spanish name: Pechuga de pollo.');
  });

  it('produces name-only text when all nutrients are null', () => {
    const text = buildFoodText({
      ...fullFood,
      calories: null,
      proteins: null,
      carbohydrates: null,
      sugars: null,
      fats: null,
      saturatedFats: null,
      fiber: null,
      sodium: null,
    });
    expect(text).toContain('Food: Chicken Breast.');
    expect(text).toContain('Spanish name: Pechuga de pollo.');
    expect(text).toContain('Type: generic.');
    expect(text).not.toContain('Nutrition');
    expect(text).not.toContain('kcal');
  });

  it('rounds nutrients to 1 decimal place', () => {
    const text = buildFoodText({ ...fullFood, fats: 3.567, sodium: 74.123 });
    expect(text).toContain('3.6g fat');
    expect(text).toContain('74.1mg sodium');
  });

  it('includes Type line using foodType enum (generic/branded/composite)', () => {
    const text = buildFoodText({ ...fullFood, foodType: 'branded' });
    expect(text).toContain('Type: branded.');
  });

  it('uses foodGroup for Category (not foodType)', () => {
    const text = buildFoodText({ ...fullFood, foodGroup: 'Dairy and Egg Products' });
    expect(text).toContain('Category: Dairy and Egg Products.');
    expect(text).not.toContain('Category: generic');
  });
});

// ---------------------------------------------------------------------------
// buildDishText tests
// ---------------------------------------------------------------------------

describe('buildDishText', () => {
  const fullDish = {
    id: 'f019dish-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    chainSlug: 'mcdonalds-es',
    portionGrams: 215,
    categorySlugs: ['burgers', 'sandwiches'],
    cookingMethodSlugs: ['grilled'],
    calories: 550,
    proteins: 25,
    carbohydrates: 46,
    sugars: 9,
    fats: 30,
    saturatedFats: 11,
    fiber: 3,
    sodium: 730,
  };

  it('produces expected text when all fields are present', () => {
    const text = buildDishText(fullDish);
    expect(text).toContain('Dish: Big Mac.');
    expect(text).toContain('Spanish name: Big Mac.');
    expect(text).toContain('Restaurant chain: mcdonalds-es.');
    expect(text).toContain('Categories: burgers, sandwiches.');
    expect(text).toContain('Cooking methods: grilled.');
    expect(text).toContain('Serving size: 215g.');
    expect(text).toContain('Nutrition per serving:');
    expect(text).toContain('550 kcal');
    expect(text).toContain('25g protein');
    expect(text).toContain('46g carbohydrates');
    expect(text).toContain('9g sugars');
    expect(text).toContain('30g fat');
    expect(text).toContain('11g saturated fat');
    expect(text).toContain('3g fiber');
    expect(text).toContain('730mg sodium');
  });

  it('omits Spanish name line when nameEs is null', () => {
    const text = buildDishText({ ...fullDish, nameEs: null });
    expect(text).not.toContain('Spanish name:');
    expect(text).toContain('Dish: Big Mac.');
  });

  it('omits Categories line when categorySlugs is empty', () => {
    const text = buildDishText({ ...fullDish, categorySlugs: [] });
    expect(text).not.toContain('Categories:');
  });

  it('omits Cooking methods line when cookingMethodSlugs is empty', () => {
    const text = buildDishText({ ...fullDish, cookingMethodSlugs: [] });
    expect(text).not.toContain('Cooking methods:');
  });

  it('omits Serving size line when portionGrams is null', () => {
    const text = buildDishText({ ...fullDish, portionGrams: null });
    expect(text).not.toContain('Serving size:');
  });

  it('produces name + chain text when all nutrients are null', () => {
    const text = buildDishText({
      ...fullDish,
      calories: null,
      proteins: null,
      carbohydrates: null,
      sugars: null,
      fats: null,
      saturatedFats: null,
      fiber: null,
      sodium: null,
    });
    expect(text).toContain('Dish: Big Mac.');
    expect(text).toContain('Restaurant chain: mcdonalds-es.');
    expect(text).not.toContain('Nutrition');
    expect(text).not.toContain('kcal');
  });

  it('handles single category and single cooking method correctly', () => {
    const text = buildDishText({
      ...fullDish,
      categorySlugs: ['burgers'],
      cookingMethodSlugs: ['grilled'],
    });
    expect(text).toContain('Categories: burgers.');
    expect(text).toContain('Cooking methods: grilled.');
    // No trailing comma
    expect(text).not.toContain('burgers,');
  });

  it('handles multiple categories and cooking methods', () => {
    const text = buildDishText({
      ...fullDish,
      categorySlugs: ['burgers', 'sandwiches', 'mains'],
      cookingMethodSlugs: ['grilled', 'fried'],
    });
    expect(text).toContain('Categories: burgers, sandwiches, mains.');
    expect(text).toContain('Cooking methods: grilled, fried.');
  });

  it('rounds nutrients to 1 decimal place', () => {
    const text = buildDishText({ ...fullDish, fats: 30.567, sodium: 730.123 });
    expect(text).toContain('30.6g fat');
    expect(text).toContain('730.1mg sodium');
  });
});

// ---------------------------------------------------------------------------
// mapFoodRow tests
// ---------------------------------------------------------------------------

describe('mapFoodRow', () => {
  const rawFood: FoodRowRaw = {
    id: 'f019food-0001-4000-a000-000000000001',
    name: 'Chicken Breast',
    name_es: 'Pechuga de pollo',
    food_group: 'Poultry Products',
    food_type: 'generic',
    calories: '165.00',
    proteins: '31.00',
    carbohydrates: '0.00',
    sugars: '0.00',
    fats: '3.60',
    saturated_fats: '1.00',
    fiber: '0.00',
    sodium: '74.00',
  };

  it('converts snake_case keys to camelCase', () => {
    const mapped = mapFoodRow(rawFood);
    expect(mapped.nameEs).toBe('Pechuga de pollo');
    expect(mapped.foodGroup).toBe('Poultry Products');
    expect(mapped.foodType).toBe('generic');
  });

  it('parses Decimal string "165.50" to number 165.5', () => {
    const mapped = mapFoodRow({ ...rawFood, calories: '165.50' });
    expect(mapped.calories).toBe(165.5);
    expect(typeof mapped.calories).toBe('number');
  });

  it('maps null Decimal fields to null (not NaN)', () => {
    const mapped = mapFoodRow({ ...rawFood, calories: null, proteins: null });
    expect(mapped.calories).toBeNull();
    expect(mapped.proteins).toBeNull();
  });

  it('maps all nutrient fields correctly', () => {
    const mapped = mapFoodRow(rawFood);
    expect(mapped.calories).toBe(165);
    expect(mapped.proteins).toBe(31);
    expect(mapped.carbohydrates).toBe(0);
    expect(mapped.sugars).toBe(0);
    expect(mapped.fats).toBe(3.6);
    expect(mapped.saturatedFats).toBe(1);
    expect(mapped.fiber).toBe(0);
    expect(mapped.sodium).toBe(74);
  });

  it('preserves id and name unchanged', () => {
    const mapped = mapFoodRow(rawFood);
    expect(mapped.id).toBe(rawFood.id);
    expect(mapped.name).toBe(rawFood.name);
  });
});

// ---------------------------------------------------------------------------
// mapDishRow tests
// ---------------------------------------------------------------------------

describe('mapDishRow', () => {
  const rawDish: DishRowRaw = {
    id: 'f019dish-0001-4000-a000-000000000001',
    name: 'Big Mac',
    name_es: 'Big Mac',
    chain_slug: 'mcdonalds-es',
    portion_grams: '215.00',
    category_slugs: 'burgers,sandwiches',
    cooking_method_slugs: 'grilled',
    calories: '550.00',
    proteins: '25.00',
    carbohydrates: '46.00',
    sugars: '9.00',
    fats: '30.00',
    saturated_fats: '11.00',
    fiber: '3.00',
    sodium: '730.00',
  };

  it('converts snake_case keys to camelCase', () => {
    const mapped = mapDishRow(rawDish);
    expect(mapped.nameEs).toBe('Big Mac');
    expect(mapped.chainSlug).toBe('mcdonalds-es');
    expect(mapped.portionGrams).toBe(215);
  });

  it('splits STRING_AGG result "burgers,sandwiches" into array ["burgers", "sandwiches"]', () => {
    const mapped = mapDishRow(rawDish);
    expect(mapped.categorySlugs).toEqual(['burgers', 'sandwiches']);
  });

  it('maps null STRING_AGG (no categories) to empty array []', () => {
    const mapped = mapDishRow({ ...rawDish, category_slugs: null });
    expect(mapped.categorySlugs).toEqual([]);
  });

  it('maps null STRING_AGG (no cooking methods) to empty array []', () => {
    const mapped = mapDishRow({ ...rawDish, cooking_method_slugs: null });
    expect(mapped.cookingMethodSlugs).toEqual([]);
  });

  it('parses Decimal string values to numbers', () => {
    const mapped = mapDishRow(rawDish);
    expect(mapped.calories).toBe(550);
    expect(mapped.proteins).toBe(25);
    expect(mapped.portionGrams).toBe(215);
  });

  it('maps null Decimal fields to null (not NaN)', () => {
    const mapped = mapDishRow({ ...rawDish, calories: null, portion_grams: null });
    expect(mapped.calories).toBeNull();
    expect(mapped.portionGrams).toBeNull();
  });

  it('maps nullable name_es to null correctly', () => {
    const mapped = mapDishRow({ ...rawDish, name_es: null });
    expect(mapped.nameEs).toBeNull();
  });

  it('splits single category slug into single-element array', () => {
    const mapped = mapDishRow({ ...rawDish, category_slugs: 'burgers' });
    expect(mapped.categorySlugs).toEqual(['burgers']);
  });
});
