// Formatter: EstimateData → MarkdownV2 string.

import type { EstimateData } from '@foodxplorer/shared';
import { escapeMarkdown, formatNutrient } from './markdownUtils.js';

const CONFIDENCE_MAP: Record<string, string> = {
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

/**
 * Format an EstimateData payload for Telegram MarkdownV2.
 *
 * When result is null (no data found at any level), returns a "no data" message.
 * Otherwise returns a compact nutrient card with optional nutrient rows for non-zero values.
 */
export function formatEstimate(data: EstimateData): string {
  if (data.result === null) {
    return 'No se encontraron datos nutricionales para esta consulta\\.';
  }

  const { result } = data;
  const displayName = result.nameEs ?? result.name;
  const n = result.nutrients;

  const lines: string[] = [
    `*${escapeMarkdown(displayName)}*`,
    '',
    `🔥 Calorías: ${formatNutrient(n.calories, 'kcal')}`,
    `🥩 Proteínas: ${formatNutrient(n.proteins, 'g')}`,
    `🍞 Carbohidratos: ${formatNutrient(n.carbohydrates, 'g')}`,
    `🧈 Grasas: ${formatNutrient(n.fats, 'g')}`,
  ];

  // Optional nutrients — only show when > 0
  if (n.fiber > 0)        lines.push(`🌾 Fibra: ${formatNutrient(n.fiber, 'g')}`);
  if (n.saturatedFats > 0) lines.push(`🫙 Grasas saturadas: ${formatNutrient(n.saturatedFats, 'g')}`);
  if (n.sodium > 0)       lines.push(`🧂 Sodio: ${formatNutrient(n.sodium, 'mg')}`);
  if (n.salt > 0)         lines.push(`🧂 Sal: ${formatNutrient(n.salt, 'g')}`);

  if (result.portionGrams !== null) {
    lines.push('');
    lines.push(`Porción: ${escapeMarkdown(String(result.portionGrams))} g`);
  }

  if (result.chainSlug) {
    lines.push(`Cadena: ${escapeMarkdown(result.chainSlug)}`);
  }

  const confidenceLabel = CONFIDENCE_MAP[result.confidenceLevel] ?? escapeMarkdown(result.confidenceLevel);
  lines.push('');
  lines.push(`_Confianza: ${confidenceLabel}_`);

  return lines.join('\n');
}
