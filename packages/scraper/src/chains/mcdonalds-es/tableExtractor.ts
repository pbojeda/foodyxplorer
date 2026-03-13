// HTML nutrition table fallback extractor for McDonald's Spain product pages.
//
// Used when JSON-LD is absent or incomplete. Reads rows from
// `.cmp-nutrition-summary__table tr` and maps Spanish labels to nutrient keys.

import type { Page } from 'playwright';
import type { RawDishData } from '../../base/types.js';

// ---------------------------------------------------------------------------
// Spanish label → nutrient key mapping
// ---------------------------------------------------------------------------

const LABEL_MAP: Record<string, keyof RawDishData['nutrients']> = {
  'valor energético':  'calories',
  'calorías':          'calories',
  'grasas':            'fats',
  'lípidos':           'fats',
  'grasas saturadas':  'saturatedFats',
  'grasas trans':      'transFats',
  'hidratos de carbono': 'carbohydrates',
  'azúcares':          'sugars',
  'fibra':             'fiber',
  'fibra alimentaria': 'fiber',
  'proteínas':         'proteins',
  'sal':               'salt',
  'sodio':             'sodium',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts nutritional data from the HTML nutrition table on a McDonald's
 * Spain product page.
 *
 * Reads all `<tr>` elements inside `.cmp-nutrition-summary__table`. For each
 * row, col[0] is the Spanish label and col[1] is the value string. Labels are
 * normalised (lowercase, trimmed, collapsed spaces) before lookup.
 *
 * Returns a partial nutrients object — only fields found in the table are set.
 * Returns an empty object if no rows are found (caller handles the empty case).
 *
 * @param page - Playwright Page object navigated to the product page.
 */
export async function extractNutritionTable(
  page: Page,
): Promise<Partial<RawDishData['nutrients']>> {
  const rows = await page.$$('.cmp-nutrition-summary__table tr');

  const result: Partial<RawDishData['nutrients']> = {};

  for (const row of rows) {
    const cells = await row.$$('td');
    if (cells.length < 2) continue;

    const labelCell = cells[0];
    const valueCell = cells[1];

    if (labelCell === undefined || valueCell === undefined) continue;

    const rawLabel = await labelCell.textContent();
    const rawValue = await valueCell.textContent();

    if (rawLabel === null || rawValue === null) continue;

    const label = rawLabel.trim().toLowerCase().replace(/\s+/g, ' ');
    const value = rawValue.trim();

    const nutrientKey = LABEL_MAP[label];
    if (nutrientKey !== undefined) {
      // Type assertion needed: the Zod schema allows string | number for all
      // nutrient fields except `extra`. We only ever assign strings from table cells.
      (result as Record<string, string | number>)[nutrientKey] = value;
    }
  }

  return result;
}
