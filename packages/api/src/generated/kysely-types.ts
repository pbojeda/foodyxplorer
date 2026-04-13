import type { ColumnType } from "kysely";
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type {
  DataSourceType,
  ConfidenceLevel,
  EstimationMethod,
  PortionConfidence,
  FoodType,
  NutrientReferenceBasis,
  DishAvailability,
  ApiKeyTier,
  ActorType,
  QueryLogLevelHit,
  QueryLogSource,
  MissedQueryStatus,
} from "./kysely-enums";

export type Actor = {
  id: string;
  type: ActorType;
  external_id: string;
  locale: string | null;
  created_at: Generated<Timestamp>;
  last_seen_at: Generated<Timestamp>;
};
export type ApiKey = {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  tier: Generated<ApiKeyTier>;
  is_active: Generated<boolean>;
  expires_at: Timestamp | null;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type CookingMethod = {
  id: string;
  name: string;
  name_es: string;
  slug: string;
  description: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type CookingProfile = {
  id: string;
  food_group: string;
  food_name: Generated<string>;
  cooking_method: string;
  yield_factor: string;
  fat_absorption: string | null;
  source: string;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type DataSource = {
  id: string;
  name: string;
  type: DataSourceType;
  url: string | null;
  priority_tier: number | null;
  last_updated: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type Dish = {
  id: string;
  restaurant_id: string;
  food_id: string | null;
  source_id: string;
  name: string;
  name_es: string | null;
  name_source_locale: string | null;
  description: string | null;
  external_id: string | null;
  availability: Generated<DishAvailability>;
  portion_grams: string | null;
  price_eur: string | null;
  confidence_level: ConfidenceLevel;
  estimation_method: EstimationMethod;
  aliases: string[];
  embedding_updated_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type DishCategory = {
  id: string;
  name: string;
  name_es: string;
  slug: string;
  description: string | null;
  sort_order: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type DishCookingMethod = {
  dish_id: string;
  cooking_method_id: string;
};
export type DishDishCategory = {
  dish_id: string;
  dish_category_id: string;
};
export type DishIngredient = {
  id: string;
  dish_id: string;
  ingredient_food_id: string;
  amount: string;
  unit: string;
  gram_weight: string | null;
  sort_order: number;
  notes: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type DishNutrient = {
  id: string;
  dish_id: string;
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  extra: unknown | null;
  reference_basis: Generated<NutrientReferenceBasis>;
  trans_fats: Generated<string>;
  cholesterol: Generated<string>;
  potassium: Generated<string>;
  monounsaturated_fats: Generated<string>;
  polyunsaturated_fats: Generated<string>;
  alcohol: Generated<string>;
  estimation_method: EstimationMethod;
  source_id: string;
  confidence_level: ConfidenceLevel;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type Food = {
  id: string;
  name: string;
  name_es: string;
  aliases: string[];
  food_group: string | null;
  source_id: string;
  external_id: string | null;
  confidence_level: ConfidenceLevel;
  food_type: Generated<FoodType>;
  brand_name: string | null;
  barcode: string | null;
  embedding_updated_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type FoodNutrient = {
  id: string;
  food_id: string;
  calories: string;
  proteins: string;
  carbohydrates: string;
  sugars: string;
  fats: string;
  saturated_fats: string;
  fiber: string;
  salt: string;
  sodium: string;
  extra: unknown | null;
  reference_basis: Generated<NutrientReferenceBasis>;
  trans_fats: Generated<string>;
  cholesterol: Generated<string>;
  potassium: Generated<string>;
  monounsaturated_fats: Generated<string>;
  polyunsaturated_fats: Generated<string>;
  alcohol: Generated<string>;
  source_id: string;
  confidence_level: ConfidenceLevel;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type MissedQueryTracking = {
  id: string;
  query_text: string;
  hit_count: number;
  status: Generated<MissedQueryStatus>;
  resolved_dish_id: string | null;
  notes: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type QueryLog = {
  id: string;
  query_text: string;
  chain_slug: string | null;
  restaurant_id: string | null;
  level_hit: QueryLogLevelHit | null;
  cache_hit: boolean;
  response_time_ms: number;
  api_key_id: string | null;
  actor_id: string | null;
  source: Generated<QueryLogSource>;
  queried_at: Generated<Timestamp>;
};
export type Recipe = {
  id: string;
  food_id: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  source_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  ingredient_food_id: string;
  amount: string;
  unit: string;
  gram_weight: string | null;
  sort_order: number;
  notes: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type Restaurant = {
  id: string;
  name: string;
  name_es: string | null;
  chain_slug: string;
  website: string | null;
  logo_url: string | null;
  country_code: Generated<string>;
  is_active: Generated<boolean>;
  address: string | null;
  google_maps_url: string | null;
  latitude: string | null;
  longitude: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type StandardPortion = {
  id: string;
  dish_id: string;
  term: string;
  grams: number;
  pieces: number | null;
  piece_name: string | null;
  confidence: PortionConfidence;
  notes: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Timestamp;
};
export type WaitlistSubmission = {
  id: Generated<string>;
  email: string;
  phone: string | null;
  variant: Generated<string>;
  source: Generated<string>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  ip_address: string | null;
  created_at: Generated<Timestamp>;
};
export type WebMetricsEvent = {
  id: string;
  query_count: number;
  success_count: number;
  error_count: number;
  retry_count: number;
  intents: unknown;
  errors: unknown;
  avg_response_time_ms: number;
  session_started_at: Timestamp;
  received_at: Generated<Timestamp>;
  ip_hash: string | null;
};
export type DB = {
  actors: Actor;
  api_keys: ApiKey;
  cooking_methods: CookingMethod;
  cooking_profiles: CookingProfile;
  data_sources: DataSource;
  dish_categories: DishCategory;
  dish_cooking_methods: DishCookingMethod;
  dish_dish_categories: DishDishCategory;
  dish_ingredients: DishIngredient;
  dish_nutrients: DishNutrient;
  dishes: Dish;
  food_nutrients: FoodNutrient;
  foods: Food;
  missed_query_tracking: MissedQueryTracking;
  query_logs: QueryLog;
  recipe_ingredients: RecipeIngredient;
  recipes: Recipe;
  restaurants: Restaurant;
  standard_portions: StandardPortion;
  waitlist_submissions: WaitlistSubmission;
  web_metrics_events: WebMetricsEvent;
};
