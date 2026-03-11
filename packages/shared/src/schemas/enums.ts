import { z } from 'zod';

export const DataSourceTypeSchema = z.enum(['official', 'estimated', 'scraped', 'user']);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const EstimationMethodSchema = z.enum([
  'official',
  'ingredients',
  'extrapolation',
  'scraped',
]);
export type EstimationMethod = z.infer<typeof EstimationMethodSchema>;

export const PortionContextSchema = z.enum([
  'main_course',
  'side_dish',
  'dessert',
  'starter',
  'snack',
]);
export type PortionContext = z.infer<typeof PortionContextSchema>;

export const FoodTypeSchema = z.enum(['generic', 'branded', 'composite']);
export type FoodType = z.infer<typeof FoodTypeSchema>;

export const NutrientReferenceBasisSchema = z.enum([
  'per_100g',
  'per_serving',
  'per_package',
]);
export type NutrientReferenceBasis = z.infer<typeof NutrientReferenceBasisSchema>;
