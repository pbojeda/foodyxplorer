export const DataSourceType = {
  official: "official",
  estimated: "estimated",
  scraped: "scraped",
  user: "user",
} as const;
export type DataSourceType = (typeof DataSourceType)[keyof typeof DataSourceType];
export const ConfidenceLevel = {
  high: "high",
  medium: "medium",
  low: "low",
} as const;
export type ConfidenceLevel = (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];
export const EstimationMethod = {
  official: "official",
  ingredients: "ingredients",
  extrapolation: "extrapolation",
  scraped: "scraped",
} as const;
export type EstimationMethod = (typeof EstimationMethod)[keyof typeof EstimationMethod];
export const PortionContext = {
  main_course: "main_course",
  side_dish: "side_dish",
  dessert: "dessert",
  starter: "starter",
  snack: "snack",
} as const;
export type PortionContext = (typeof PortionContext)[keyof typeof PortionContext];
export const FoodType = {
  generic: "generic",
  branded: "branded",
  composite: "composite",
} as const;
export type FoodType = (typeof FoodType)[keyof typeof FoodType];
export const NutrientReferenceBasis = {
  per_100g: "per_100g",
  per_serving: "per_serving",
  per_package: "per_package",
} as const;
export type NutrientReferenceBasis =
  (typeof NutrientReferenceBasis)[keyof typeof NutrientReferenceBasis];
export const DishAvailability = {
  available: "available",
  seasonal: "seasonal",
  discontinued: "discontinued",
  regional: "regional",
} as const;
export type DishAvailability = (typeof DishAvailability)[keyof typeof DishAvailability];
export const ApiKeyTier = {
  free: "free",
  pro: "pro",
} as const;
export type ApiKeyTier = (typeof ApiKeyTier)[keyof typeof ApiKeyTier];
export const QueryLogLevelHit = {
  l1: "l1",
  l2: "l2",
  l3: "l3",
  l4: "l4",
} as const;
export type QueryLogLevelHit = (typeof QueryLogLevelHit)[keyof typeof QueryLogLevelHit];
export const QueryLogSource = {
  api: "api",
  bot: "bot",
} as const;
export type QueryLogSource = (typeof QueryLogSource)[keyof typeof QueryLogSource];
