/**
 * F073 — Spanish Canonical Dishes seed data types.
 * Pure TypeScript interfaces, no runtime dependencies.
 */

export interface SpanishDishNutrients {
  calories: number;
  proteins: number;
  carbohydrates: number;
  sugars: number;
  fats: number;
  saturatedFats: number;
  fiber: number;
  salt: number;
  sodium: number;
}

export interface SpanishDishEntry {
  externalId: string;
  dishId: string;
  nutrientId: string;
  name: string;
  nameEs: string;
  aliases: string[];
  category: string;
  portionGrams: number;
  confidenceLevel: 'high' | 'medium';
  estimationMethod: 'official' | 'ingredients';
  source: 'bedca' | 'recipe';
  nutrients: SpanishDishNutrients;
}

export interface SpanishDishesFile {
  dishes: SpanishDishEntry[];
}
