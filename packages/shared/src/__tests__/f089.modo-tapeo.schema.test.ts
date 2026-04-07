// Schema tests for F089 — "Modo Tapeo" (shared portions)
//
// Tests: diners + perPerson fields in MenuEstimationDataSchema

import { describe, it, expect } from 'vitest';
import { MenuEstimationDataSchema, type MenuEstimationData } from '../schemas/menuEstimation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOTALS = {
  calories: 1200,
  proteins: 60,
  carbohydrates: 120,
  sugars: 15,
  fats: 50,
  saturatedFats: 15,
  fiber: 8,
  salt: 3,
  sodium: 1200,
  transFats: 0,
  cholesterol: 80,
  potassium: 600,
  monounsaturatedFats: 15,
  polyunsaturatedFats: 8,
  alcohol: 10,
};

const BASE_DATA: MenuEstimationData = {
  items: [],
  totals: VALID_TOTALS,
  itemCount: 3,
  matchedCount: 3,
  diners: null,
  perPerson: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MenuEstimationDataSchema — diners + perPerson (F089)', () => {
  it('accepts data with diners: null and perPerson: null', () => {
    const result = MenuEstimationDataSchema.parse(BASE_DATA);
    expect(result.diners).toBeNull();
    expect(result.perPerson).toBeNull();
  });

  it('accepts data with diners and perPerson populated', () => {
    const perPerson = { ...VALID_TOTALS, calories: 400, proteins: 20 };
    const result = MenuEstimationDataSchema.parse({
      ...BASE_DATA,
      diners: 3,
      perPerson,
    });
    expect(result.diners).toBe(3);
    expect(result.perPerson?.calories).toBe(400);
    expect(result.perPerson?.proteins).toBe(20);
  });

  it('diners = 1 is valid', () => {
    const result = MenuEstimationDataSchema.parse({
      ...BASE_DATA,
      diners: 1,
      perPerson: VALID_TOTALS,
    });
    expect(result.diners).toBe(1);
  });

  it('diners = 20 is valid (max)', () => {
    const result = MenuEstimationDataSchema.parse({
      ...BASE_DATA,
      diners: 20,
      perPerson: VALID_TOTALS,
    });
    expect(result.diners).toBe(20);
  });

  it('diners = 0 fails validation', () => {
    expect(() =>
      MenuEstimationDataSchema.parse({ ...BASE_DATA, diners: 0, perPerson: VALID_TOTALS }),
    ).toThrow();
  });

  it('diners = 21 fails validation', () => {
    expect(() =>
      MenuEstimationDataSchema.parse({ ...BASE_DATA, diners: 21, perPerson: VALID_TOTALS }),
    ).toThrow();
  });

  it('diners must be integer', () => {
    expect(() =>
      MenuEstimationDataSchema.parse({ ...BASE_DATA, diners: 2.5, perPerson: VALID_TOTALS }),
    ).toThrow();
  });
});
