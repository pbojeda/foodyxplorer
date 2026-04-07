/**
 * F083 — Allergen Cross-Reference
 *
 * Rule-based allergen detection from food/dish names using keyword matching.
 * Detects the 14 EU-regulated allergen categories from Spanish + English
 * food name keywords.
 *
 * Unlike F082 (first-match-wins), allergens accumulate: a dish can trigger
 * multiple allergen categories simultaneously (e.g., "pizza con queso y
 * gambas" → gluten + dairy + crustaceans).
 *
 * No DB migration needed — rules are static and deterministic.
 */

import type { DetectedAllergen } from '@foodxplorer/shared';

export type { DetectedAllergen } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AllergenRule {
  /** EU allergen category name in Spanish */
  allergen: string;
  /** Keywords matched against lowercase dish name (Spanish + English) */
  patterns: string[];
}

// ---------------------------------------------------------------------------
// 14 EU-regulated allergen categories with Spanish keyword patterns
// ---------------------------------------------------------------------------

const ALLERGEN_RULES: AllergenRule[] = [
  {
    allergen: 'Gluten',
    patterns: [
      'trigo', 'cebada', 'centeno', 'avena', 'espelta',
      'pan ', 'pan,', 'pasta', 'pizza', 'harina', 'galleta', 'bizcocho',
      'croissant', 'empanada', 'croqueta', 'rebozado', 'empanado',
      'wheat', 'barley', 'rye', 'oat', 'bread', 'flour',
    ],
  },
  {
    allergen: 'Crustáceos',
    patterns: [
      'gamba', 'langostino', 'cangrejo', 'bogavante', 'langosta',
      'camarón', 'cigala', 'centollo', 'nécora', 'crustáceo',
      'shrimp', 'prawn', 'crab', 'lobster', 'crayfish',
    ],
  },
  {
    allergen: 'Huevo',
    patterns: [
      'huevo', 'tortilla', 'mayonesa', 'mayo', 'merengue', 'flan',
      'egg', 'omelette', 'omelet',
    ],
  },
  {
    allergen: 'Pescado',
    patterns: [
      'pescado', 'merluza', 'salmón', 'salmon', 'atún', 'atun', 'bacalao',
      'lubina', 'dorada', 'sardina', 'anchoa', 'boquerón', 'boqueron',
      'trucha', 'rape', 'lenguado', 'rodaballo', 'pez espada',
      'fish', 'cod', 'tuna', 'haddock', 'sole',
    ],
  },
  {
    allergen: 'Cacahuete',
    patterns: [
      'cacahuete', 'cacahuetes', 'maní', 'mani',
      'peanut', 'peanuts',
    ],
  },
  {
    allergen: 'Soja',
    patterns: [
      'soja', 'edamame', 'tofu', 'tempeh', 'miso',
      'soy', 'soybean',
    ],
  },
  {
    allergen: 'Lácteos',
    patterns: [
      'leche', 'queso', 'mantequilla', 'nata', 'yogur', 'yogurt',
      'crema', 'requesón', 'cuajada', 'mozzarella', 'parmesano',
      'cheddar', 'brie', 'camembert', 'gouda', 'manchego',
      'milk', 'cheese', 'butter', 'cream', 'dairy',
    ],
  },
  {
    allergen: 'Frutos de cáscara',
    patterns: [
      'almendra', 'avellana', 'nuez', 'nueces', 'pistacho',
      'anacardo', 'macadamia', 'pecan', 'pecana',
      'almond', 'hazelnut', 'walnut', 'cashew', 'pistachio',
    ],
  },
  {
    allergen: 'Apio',
    patterns: ['apio', 'celery'],
  },
  {
    allergen: 'Mostaza',
    patterns: ['mostaza', 'mustard'],
  },
  {
    allergen: 'Sésamo',
    patterns: ['sésamo', 'sesamo', 'ajonjolí', 'ajonjoli', 'sesame'],
  },
  {
    allergen: 'Sulfitos',
    patterns: ['sulfito', 'sulfitos', 'sulphite', 'sulfite'],
  },
  {
    allergen: 'Altramuces',
    patterns: ['altramuz', 'altramuces', 'lupino', 'lupin'],
  },
  {
    allergen: 'Moluscos',
    patterns: [
      'molusco', 'calamar', 'pulpo', 'mejillón', 'mejillon',
      'almeja', 'ostra', 'berberecho', 'navaja', 'sepia',
      'squid', 'octopus', 'mussel', 'clam', 'oyster',
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect allergens present in a food/dish name.
 *
 * Returns all matching allergen categories (not first-match-wins).
 * Returns an empty array when:
 * - dishName is empty/falsy
 * - No keyword match found
 */
export function detectAllergens(dishName: string): DetectedAllergen[] {
  if (!dishName) return [];

  const lowerName = dishName.toLowerCase();
  const results: DetectedAllergen[] = [];

  for (const rule of ALLERGEN_RULES) {
    for (const pattern of rule.patterns) {
      if (lowerName.includes(pattern)) {
        results.push({
          allergen: rule.allergen,
          keyword: pattern,
        });
        break; // one match per category is enough
      }
    }
  }

  return results;
}

/**
 * Compute allergen detection from an EstimateResult.
 *
 * Returns an empty object when no allergens detected, or
 * { allergens: [...] } ready to spread into EstimateData.
 */
export function enrichWithAllergens(
  result: { nameEs: string | null; name: string } | null,
): { allergens?: DetectedAllergen[] } {
  if (result === null) return {};

  const dishName = result.nameEs ?? result.name;
  const allergens = detectAllergens(dishName);

  return allergens.length > 0 ? { allergens } : {};
}
