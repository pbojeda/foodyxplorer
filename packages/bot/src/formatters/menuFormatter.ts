// Formatter: MenuEstimationData → MarkdownV2 string (F076).
//
// Shows per-item compact cards + aggregated total row + match count + confidence.

import type { MenuEstimationData } from '@foodxplorer/shared';
import { escapeMarkdown, formatNutrient } from './markdownUtils.js';

const CONFIDENCE_MAP: Record<string, string> = {
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

/**
 * Format a MenuEstimationData payload for Telegram MarkdownV2.
 */
export function formatMenuEstimate(data: MenuEstimationData): string {
  const lines: string[] = ['*Menú del día*', ''];

  for (const item of data.items) {
    if (item.estimation.result) {
      const r = item.estimation.result;
      const name = r.nameEs ?? r.name ?? item.query;
      const n = r.nutrients;
      lines.push(
        `🍽 *${escapeMarkdown(name)}* — 🔥 ${formatNutrient(n.calories, 'kcal')} \\| 🥩 ${formatNutrient(n.proteins, 'g')} \\| 🍞 ${formatNutrient(n.carbohydrates, 'g')} \\| 🧈 ${formatNutrient(n.fats, 'g')}`,
      );
    } else {
      lines.push(`❓ ${escapeMarkdown(item.query)}: _no encontrado_`);
    }
  }

  // Separator + totals
  lines.push('');
  lines.push('──────────────────');

  const t = data.totals;
  lines.push(
    `*Total* — 🔥 ${formatNutrient(t.calories, 'kcal')} \\| 🥩 ${formatNutrient(t.proteins, 'g')} \\| 🍞 ${formatNutrient(t.carbohydrates, 'g')} \\| 🧈 ${formatNutrient(t.fats, 'g')}`,
  );

  // Match count
  lines.push('');
  lines.push(`_${data.matchedCount}/${data.itemCount} platos encontrados_`);

  // Confidence — show lowest among matched items
  if (data.matchedCount > 0) {
    const confidenceLevels = data.items
      .filter((i) => i.estimation.result)
      .map((i) => i.estimation.result!.confidenceLevel);

    const lowestConfidence = getLowestConfidence(confidenceLevels);
    if (lowestConfidence) {
      const label = CONFIDENCE_MAP[lowestConfidence] ?? escapeMarkdown(lowestConfidence);
      lines.push(`_Confianza: ${label}_`);
    }
  }

  return lines.join('\n');
}

function getLowestConfidence(levels: string[]): string | null {
  if (levels.length === 0) return null;
  const ORDER = ['low', 'medium', 'high'];
  let lowest = levels[0]!;
  for (const level of levels) {
    if (ORDER.indexOf(level) < ORDER.indexOf(lowest)) {
      lowest = level;
    }
  }
  return lowest;
}
