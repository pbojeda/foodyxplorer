// Formatter: EstimateData → MarkdownV2 string.

import type { EstimateData } from '@foodxplorer/shared';
import { formatPortionLabel } from '@foodxplorer/shared';
import { escapeMarkdown, formatNutrient } from './markdownUtils.js';

/** Format a numeric diff with explicit sign: "+5" or "-10" */
function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

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
  const displayName = result.nameEs ?? result.name ?? 'Plato';
  const n = result.nutrients;

  const lines: string[] = [
    `*${escapeMarkdown(displayName)}*`,
  ];

  // Portion modifier line — shown only when multiplier !== 1.0
  if (data.portionMultiplier !== 1.0) {
    // F-UX-A: canonical label sourced from @foodxplorer/shared so bot, API
    // and web all agree on the same Spanish vocabulary. The `×N` fallback
    // for unmapped multipliers is also produced by the helper; the bot's
    // legacy output format shows both the label and the raw multiplier
    // inside the "(x1.5)" trailing group so the fallback looks correct too.
    const label = formatPortionLabel(data.portionMultiplier);
    const portionLine = result.portionGrams !== null
      ? `Porción: ${escapeMarkdown(label)} \\(x${escapeMarkdown(String(data.portionMultiplier))}\\) — ${escapeMarkdown(String(result.portionGrams))} g`
      : `Porción: ${escapeMarkdown(label)} \\(x${escapeMarkdown(String(data.portionMultiplier))}\\)`;
    lines.push(portionLine);
  }

  lines.push(
    '',
    data.uncertaintyRange
      ? `🔥 Calorías: ${formatNutrient(n.calories, 'kcal')} \\(${escapeMarkdown(String(data.uncertaintyRange.caloriesMin))}\\-${escapeMarkdown(String(data.uncertaintyRange.caloriesMax))}\\)`
      : `🔥 Calorías: ${formatNutrient(n.calories, 'kcal')}`,
    `🥩 Proteínas: ${formatNutrient(n.proteins, 'g')}`,
    `🍞 Carbohidratos: ${formatNutrient(n.carbohydrates, 'g')}`,
    `🧈 Grasas: ${formatNutrient(n.fats, 'g')}`,
  );

  // Optional nutrients — only show when > 0
  if (n.fiber > 0)        lines.push(`🌾 Fibra: ${formatNutrient(n.fiber, 'g')}`);
  if (n.saturatedFats > 0) lines.push(`🫙 Grasas saturadas: ${formatNutrient(n.saturatedFats, 'g')}`);
  if (n.sodium > 0)       lines.push(`🧂 Sodio: ${formatNutrient(n.sodium, 'mg')}`);
  if (n.salt > 0)         lines.push(`🧂 Sal: ${formatNutrient(n.salt, 'g')}`);
  if (n.alcohol > 0)      lines.push(`🍺 Alcohol: ${formatNutrient(n.alcohol, 'g')}`);

  // Portion grams line at the bottom — only when multiplier is 1.0 (standard portion)
  if (data.portionMultiplier === 1.0 && result.portionGrams !== null) {
    lines.push('');
    lines.push(`Porción: ${escapeMarkdown(String(result.portionGrams))} g`);
  }

  if (result.chainSlug) {
    lines.push(`Cadena: ${escapeMarkdown(result.chainSlug)}`);
  }

  // F081: Health-Hacker tips
  if (data.healthHackerTips && data.healthHackerTips.length > 0) {
    lines.push('');
    lines.push('💡 *Health\\-Hacker Tips:*');
    for (const tip of data.healthHackerTips) {
      lines.push(`  • ${escapeMarkdown(tip.tip)}: \\-${escapeMarkdown(String(tip.caloriesSaved))} kcal`);
    }
  }

  // F082: Nutritional substitutions
  if (data.substitutions && data.substitutions.length > 0) {
    lines.push('');
    lines.push('🔄 *Sustituciones:*');
    for (const sub of data.substitutions) {
      const diff = sub.nutrientDiff;
      const parts: string[] = [`${formatDiff(diff.calories)} kcal`];
      if (diff.proteins !== 0) parts.push(`${formatDiff(diff.proteins)} prot`);
      if (diff.carbohydrates !== 0) parts.push(`${formatDiff(diff.carbohydrates)} carbs`);
      if (diff.fats !== 0) parts.push(`${formatDiff(diff.fats)} grasas`);
      if (diff.fiber !== 0) parts.push(`${formatDiff(diff.fiber)} fibra`);
      lines.push(`  • ${escapeMarkdown(sub.original)} → ${escapeMarkdown(sub.substitute)}: ${escapeMarkdown(parts.join(', '))}`);
    }
  }

  // F083: Detected allergens
  if (data.allergens && data.allergens.length > 0) {
    lines.push('');
    lines.push('⚠️ *Alérgenos detectados:*');
    lines.push(`  ${escapeMarkdown(data.allergens.map((a) => a.allergen).join(', '))}`);
    lines.push(`_\\(orientativo — verificar con el establecimiento\\)_`);
  }

  // F085: Portion sizing context
  if (data.portionSizing) {
    const ps = data.portionSizing;
    const gramsLabel = ps.gramsMin === ps.gramsMax
      ? `${ps.gramsMin} g`
      : `${ps.gramsMin}\\-${ps.gramsMax} g`;
    lines.push('');
    lines.push(`📏 *Porción detectada:* ${escapeMarkdown(ps.term)} \\(${gramsLabel}\\)`);
  }

  const confidenceLabel = CONFIDENCE_MAP[result.confidenceLevel] ?? escapeMarkdown(result.confidenceLevel);
  lines.push('');
  lines.push(`_Confianza: ${confidenceLabel}_`);

  return lines.join('\n');
}
