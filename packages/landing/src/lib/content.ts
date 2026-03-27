/**
 * Static content data for the landing page.
 * All user-facing copy lives in src/lib/i18n/locales/es.ts.
 * This file contains structured data that drives UI components.
 */

export type ConfidenceLevel = 'L1' | 'L2' | 'L3';
export type ConfidenceLabel = 'Alta' | 'Media' | 'Baja';

export type Dish = {
  /** Key used for autocomplete matching */
  query: string;
  /** Display name shown in results */
  dish: string;
  /** Confidence tier */
  level: ConfidenceLevel;
  /** Human-readable confidence label */
  confidence: ConfidenceLabel;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Explanation of how this data was obtained */
  note: string;
  /** Allergen status message */
  allergen: string;
};

/**
 * 10 pre-loaded dishes for the SearchSimulator.
 * Covers all three confidence levels (L1, L2, L3) across a variety of Spanish cuisines.
 *
 * Prepared to be replaced by real /estimate API responses in a future iteration.
 */
export const DISHES: readonly Dish[] = [
  {
    query: 'big mac',
    dish: "Big Mac · McDonald's",
    level: 'L1',
    confidence: 'Alta',
    kcal: 508,
    protein: 26,
    carbs: 42,
    fat: 26,
    note: 'Dato oficial verificado del restaurante.',
    allergen: 'Verificado por fuente oficial',
  },
  {
    query: 'pulpo a feira',
    dish: 'Pulpo a Feira',
    level: 'L2',
    confidence: 'Media',
    kcal: 482,
    protein: 31,
    carbs: 18,
    fat: 21,
    note: 'Estimación inteligente por ingredientes y ración estándar.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'poke salmón',
    dish: 'Poke salmón y aguacate',
    level: 'L3',
    confidence: 'Baja',
    kcal: 576,
    protein: 25,
    carbs: 65,
    fat: 22,
    note: 'Extrapolado por similitud semántica.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'tortilla española',
    dish: 'Tortilla Española',
    level: 'L2',
    confidence: 'Media',
    kcal: 348,
    protein: 14,
    carbs: 22,
    fat: 24,
    note: 'Estimación inteligente por ingredientes y ración estándar.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'lentejas con chorizo',
    dish: 'Lentejas con Chorizo',
    level: 'L1',
    confidence: 'Alta',
    kcal: 412,
    protein: 24,
    carbs: 48,
    fat: 14,
    note: 'Dato oficial de cadena verificado.',
    allergen: 'Verificado por fuente oficial',
  },
  {
    query: 'huevos rotos',
    dish: 'Huevos Rotos con Jamón',
    level: 'L2',
    confidence: 'Media',
    kcal: 520,
    protein: 28,
    carbs: 38,
    fat: 30,
    note: 'Estimación inteligente por ingredientes y ración estándar.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'ensalada césar',
    dish: 'Ensalada César',
    level: 'L2',
    confidence: 'Media',
    kcal: 380,
    protein: 18,
    carbs: 20,
    fat: 26,
    note: 'Estimación inteligente por ingredientes y ración estándar.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'paella valenciana',
    dish: 'Paella Valenciana',
    level: 'L3',
    confidence: 'Baja',
    kcal: 486,
    protein: 22,
    carbs: 72,
    fat: 12,
    note: 'Extrapolado por similitud semántica.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'croquetas de jamón',
    dish: 'Croquetas de Jamón',
    level: 'L2',
    confidence: 'Media',
    kcal: 290,
    protein: 10,
    carbs: 26,
    fat: 16,
    note: 'Estimación inteligente por ingredientes y ración estándar.',
    allergen: 'Sin dato oficial, no verificado',
  },
  {
    query: 'pizza margarita',
    dish: 'Pizza Margarita Telepizza',
    level: 'L1',
    confidence: 'Alta',
    kcal: 620,
    protein: 24,
    carbs: 78,
    fat: 22,
    note: 'Dato oficial verificado del restaurante.',
    allergen: 'Verificado por fuente oficial',
  },
] as const;

/**
 * Get the confidence badge color classes for a given level.
 */
export function getConfidenceBadgeClass(level: ConfidenceLevel): string {
  switch (level) {
    case 'L1':
      return 'bg-green-500/20 text-green-200';
    case 'L2':
      return 'bg-yellow-500/20 text-yellow-200';
    case 'L3':
      return 'bg-red-500/20 text-red-300';
  }
}

/**
 * Get the full level display string for a dish.
 */
export function getLevelDisplay(level: ConfidenceLevel, confidence: ConfidenceLabel): string {
  return `Nivel ${level.slice(1)} · Confianza ${confidence}`;
}
