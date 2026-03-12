// Type definitions for USDA SR Legacy seed data files.
// Used by seed.ts and validateSeedData.ts.

export interface UsdaSrLegacyFoodEntry {
  fdcId: number;
  description: string;
  foodGroup: string;
  nutrients: {
    calories: number;
    proteins: number;
    carbohydrates: number;
    sugars: number;
    fats: number;
    saturatedFats: number;
    fiber: number;
    sodium: number;
    salt: number;
    transFats: number;
    cholesterol: number;
    potassium: number;
    monounsaturatedFats: number;
    polyunsaturatedFats: number;
  };
}

// Shape of name-es-map.json: fdcId (as string) → Spanish name
export type NameEsMap = Record<string, string>;
