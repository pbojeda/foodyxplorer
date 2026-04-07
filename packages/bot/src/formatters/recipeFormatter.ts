// Formatter: RecipeCalculateData → MarkdownV2 string (F041).
//
// Builds a compact nutrient card with totals, per-ingredient breakdown,
// optional unresolved list, and a confidence footer.
//
// Smart truncation: the per-ingredient section is trimmed first if the total
// message exceeds 4000 chars, ensuring the header (totals) and footer
// (unresolved + confidence) are always visible.

import type { RecipeCalculateData, ResolvedIngredient } from '@foodxplorer/shared';
import { escapeMarkdown, formatNutrient } from './markdownUtils.js';

// Intentionally copied here (not imported from estimateFormatter) to keep
// each formatter self-contained per project pattern.
const CONFIDENCE_MAP: Record<string, string> = {
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

const MAX_MESSAGE_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve display name for a resolved ingredient (prefer nameEs > name > input.name > fallback). */
function resolveDisplayName(ingredient: ResolvedIngredient): string {
  return (
    ingredient.resolvedAs?.nameEs ??
    ingredient.resolvedAs?.name ??
    ingredient.input.name ??
    'Ingrediente'
  );
}

/** Build a single ingredient bullet line. */
function buildIngredientLine(ingredient: ResolvedIngredient): string {
  const displayName = escapeMarkdown(resolveDisplayName(ingredient));
  const grams = escapeMarkdown(String(ingredient.input.grams));
  const mult = ingredient.input.portionMultiplier;
  const multSuffix = mult !== 1.0 ? ` \\(x${escapeMarkdown(String(mult))}\\)` : '';

  if (!ingredient.nutrients) {
    return `• ${displayName} — ${grams}g${multSuffix} → sin datos`;
  }

  const n = ingredient.nutrients;
  const calStr = n.calories !== null ? formatNutrient(n.calories, 'kcal') : '? kcal';
  const protStr = n.proteins !== null ? formatNutrient(n.proteins, 'g prot') : '? g prot';

  return `• ${displayName} — ${grams}g${multSuffix} → ${calStr}, ${protStr}`;
}

/**
 * Build the ingredient section string given a list of bullet lines and an
 * optional count of omitted (truncated) items.
 */
function buildIngredientSection(lines: string[], headerLine: string, extraCount: number): string {
  const body = lines.join('\n');
  const suffix = extraCount > 0 ? `\n\\.\\.\\.  y ${extraCount} ingredientes más` : '';
  return `${headerLine}\n${body}${suffix}`;
}

// ---------------------------------------------------------------------------
// Public formatter
// ---------------------------------------------------------------------------

export function formatRecipeResult(data: RecipeCalculateData): string {
  const n = data.totalNutrients;

  // ---- 1. Header / totals ----
  const headerLines: string[] = [
    '*Resultado de la receta*',
    '',
  ];

  if (n.calories !== null) {
    headerLines.push(`🔥 Calorías: ${formatNutrient(n.calories, 'kcal')}`);
  }
  if (n.proteins !== null) {
    headerLines.push(`🥩 Proteínas: ${formatNutrient(n.proteins, 'g')}`);
  }
  if (n.carbohydrates !== null) {
    headerLines.push(`🍞 Carbohidratos: ${formatNutrient(n.carbohydrates, 'g')}`);
  }
  if (n.fats !== null) {
    headerLines.push(`🧈 Grasas: ${formatNutrient(n.fats, 'g')}`);
  }
  if (n.fiber !== null && n.fiber > 0) {
    headerLines.push(`🌾 Fibra: ${formatNutrient(n.fiber, 'g')}`);
  }
  if (n.sodium !== null && n.sodium > 0) {
    headerLines.push(`🧂 Sodio: ${formatNutrient(n.sodium, 'mg')}`);
  }
  if (n.saturatedFats !== null && n.saturatedFats > 0) {
    headerLines.push(`🫙 Grasas saturadas: ${formatNutrient(n.saturatedFats, 'g')}`);
  }

  const header = headerLines.join('\n');

  // ---- 1b. Per-portion section (F087) ----
  let portionSection = '';
  if (data.portions !== null && data.portions > 0 && data.perPortion !== null) {
    const p = data.perPortion;
    const pLines: string[] = [
      '',
      `*Por porción \\(${escapeMarkdown(String(data.portions))} ${data.portions === 1 ? 'tupper' : 'tuppers'}\\):*`,
    ];
    if (p.calories !== null) {
      pLines.push(`🔥 ${formatNutrient(p.calories, 'kcal')}`);
    }
    if (p.proteins !== null) {
      pLines.push(`🥩 ${formatNutrient(p.proteins, 'g prot')}`);
    }
    if (p.carbohydrates !== null) {
      pLines.push(`🍞 ${formatNutrient(p.carbohydrates, 'g carbs')}`);
    }
    if (p.fats !== null) {
      pLines.push(`🧈 ${formatNutrient(p.fats, 'g grasa')}`);
    }
    portionSection = pLines.join('\n');
  }

  // ---- 2. Footer ----
  const footerLines: string[] = [];

  if (data.unresolvedIngredients.length > 0) {
    const names = data.unresolvedIngredients.map((s) => escapeMarkdown(s)).join(', ');
    footerLines.push(`*No resueltos:* ${names}`);
    footerLines.push('');
  }

  const confidenceLabel = CONFIDENCE_MAP[data.confidenceLevel] ?? escapeMarkdown(data.confidenceLevel);
  footerLines.push(`_Confianza: ${confidenceLabel}_`);

  const footer = footerLines.join('\n');

  // ---- 3. Ingredient section ----
  const total = data.resolvedCount + data.unresolvedCount;
  const ingredientHeaderLine = `\n*Ingredientes \\(${escapeMarkdown(String(data.resolvedCount))}/${escapeMarkdown(String(total))}\\):*`;

  const resolvedIngredients = data.ingredients.filter((ing) => ing.resolved);
  const allLines = resolvedIngredients.map(buildIngredientLine);

  // ---- 4. Assemble with smart truncation ----
  // Build the full section and check if it fits.
  const headerWithPortion = `${header}${portionSection}`;
  const baseSection = buildIngredientSection(allLines, ingredientHeaderLine, 0);
  const fullMessage = `${headerWithPortion}${baseSection}\n\n${footer}`;

  if (fullMessage.length <= MAX_MESSAGE_LENGTH) {
    return fullMessage;
  }

  // Truncate ingredient lines until the assembled message fits.
  // We scan from the end, dropping one line at a time.
  const footerBlock = `\n\n${footer}`;

  let kept = allLines.length;

  while (kept > 0) {
    const extraCount = allLines.length - kept;
    const keptLines = allLines.slice(0, kept);
    const suffix = extraCount > 0 ? `\n\\.\\.\\.  y ${extraCount} ingredientes más` : '';
    const sectionBody = keptLines.join('\n') + suffix;
    const assembled = `${headerWithPortion}${ingredientHeaderLine}\n${sectionBody}${footerBlock}`;
    if (assembled.length <= MAX_MESSAGE_LENGTH) {
      return assembled;
    }
    kept--;
  }

  // If even keeping 0 lines doesn't fit (very long footer/header), just
  // return header + footer without ingredient lines.
  const extraCount = allLines.length;
  const suffix = extraCount > 0 ? `\n\\.\\.\\.  y ${extraCount} ingredientes más` : '';
  return `${headerWithPortion}${ingredientHeaderLine}\n${suffix}${footerBlock}`;
}
