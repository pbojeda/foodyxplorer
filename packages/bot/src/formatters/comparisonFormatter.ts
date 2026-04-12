// Formatter: two EstimateData → side-by-side MarkdownV2 comparison card.

import type { EstimateData, EstimateNutrients } from '@foodxplorer/shared';
import { formatPortionLabel } from '@foodxplorer/shared';
import { escapeMarkdown } from './markdownUtils.js';
import { formatEstimate } from './estimateFormatter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_MAP: Record<string, string> = {
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

// ES → EN nutrient focus mapping.
export const NUTRIENT_FOCUS_MAP: Record<string, keyof EstimateNutrients> = {
  'calorías': 'calories',
  'proteínas': 'proteins',
  'grasas': 'fats',
  'carbohidratos': 'carbohydrates',
  'fibra': 'fiber',
  'sodio': 'sodium',
  'sal': 'salt',
};

// Winner logic sets.
const LOWER_IS_BETTER = new Set(['calories', 'fats', 'saturatedFats', 'sodium', 'salt']);
const HIGHER_IS_BETTER = new Set(['proteins', 'fiber']);

// Nutrient display config.
interface NutrientRow {
  key: keyof EstimateNutrients;
  emoji: string;
  label: string;
  unit: string;
  optional: boolean;
}

const NUTRIENT_ROWS: NutrientRow[] = [
  { key: 'calories', emoji: '🔥', label: 'Calorías', unit: 'kcal', optional: false },
  { key: 'proteins', emoji: '🥩', label: 'Proteínas', unit: 'g', optional: false },
  { key: 'carbohydrates', emoji: '🍞', label: 'Carbohidr', unit: 'g', optional: false },
  { key: 'fats', emoji: '🧈', label: 'Grasas', unit: 'g', optional: false },
  { key: 'fiber', emoji: '🌾', label: 'Fibra', unit: 'g', optional: true },
  { key: 'saturatedFats', emoji: '🫙', label: 'Grasas sat', unit: 'g', optional: true },
  { key: 'sodium', emoji: '🧂', label: 'Sodio', unit: 'mg', optional: true },
  { key: 'salt', emoji: '🧂', label: 'Sal', unit: 'g', optional: true },
];

const NAME_COL_WIDTH = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateName(name: string, maxLen: number): string {
  return name.length > maxLen ? name.slice(0, maxLen) : name;
}

function formatValue(value: number, unit: string): string {
  // Raw numbers — NO MarkdownV2 escaping (inside code block).
  const numStr = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${numStr} ${unit}`;
}

function getDisplayName(data: EstimateData): string {
  return data.result?.nameEs ?? data.result?.name ?? data.query;
}

function getWinner(
  key: string,
  valA: number,
  valB: number,
  nutrientFocus?: string,
): 'A' | 'B' | 'tie' | 'none' {
  if (valA === valB) {
    // For focus nutrient, show tie indicator; for others, no indicator.
    const focusKey = nutrientFocus ? NUTRIENT_FOCUS_MAP[nutrientFocus] : undefined;
    return key === focusKey ? 'tie' : 'none';
  }

  if (LOWER_IS_BETTER.has(key)) {
    return valA < valB ? 'A' : 'B';
  }
  if (HIGHER_IS_BETTER.has(key)) {
    return valA > valB ? 'A' : 'B';
  }

  // Carbohydrates/sugars — ambiguous unless nutrientFocus targets them.
  const focusKey = nutrientFocus ? NUTRIENT_FOCUS_MAP[nutrientFocus] : undefined;
  if (key === focusKey) {
    // When focused, lower wins.
    return valA < valB ? 'A' : 'B';
  }

  return 'none';
}

// ---------------------------------------------------------------------------
// formatComparison
// ---------------------------------------------------------------------------

export interface ErrorNotes {
  errorNoteA?: 'timeout' | 'error';
  errorNoteB?: 'timeout' | 'error';
}

/**
 * Format a side-by-side comparison card in MarkdownV2.
 *
 * Layout: bold header → code block nutrient table → footer (confidence, chain, portion).
 * When one result is null, shows available dish card + note.
 * When both null, returns a static error message.
 */
export function formatComparison(
  dataA: EstimateData,
  dataB: EstimateData,
  nutrientFocus?: string,
  errorNotes?: ErrorNotes,
): string {
  const resultA = dataA.result;
  const resultB = dataB.result;

  // Both null — static error message.
  if (resultA === null && resultB === null) {
    return 'No se encontraron datos nutricionales para ninguno de los platos\\.';
  }

  // One null — partial data path.
  if (resultA === null || resultB === null) {
    return formatPartialComparison(dataA, dataB, errorNotes);
  }

  // Both non-null — full comparison.
  const nameA = getDisplayName(dataA);
  const nameB = getDisplayName(dataB);
  const shortA = truncateName(nameA, NAME_COL_WIDTH);
  const shortB = truncateName(nameB, NAME_COL_WIDTH);

  const lines: string[] = [];

  // Bold header (outside code block — escape MarkdownV2).
  lines.push(`*${escapeMarkdown(nameA)}* vs *${escapeMarkdown(nameB)}*`);
  lines.push('');

  // Build rows, reordering if nutrientFocus is set.
  const rows = buildNutrientRows(resultA.nutrients, resultB.nutrients, nutrientFocus);

  // Code block.
  const codeLines: string[] = [];
  // Column header row.
  const labelPad = 14; // emoji + label column
  codeLines.push(
    `${''.padEnd(labelPad)}${shortA.padEnd(NAME_COL_WIDTH + 2)}${shortB}`,
  );

  for (const row of rows) {
    const valA = row.valA as number;
    const valB = row.valB as number;
    const winner = getWinner(row.key, valA, valB, nutrientFocus);

    const fmtA = formatValue(valA, row.unit);
    const fmtB = formatValue(valB, row.unit);

    let colA: string;
    let colB: string;

    if (winner === 'A') {
      colA = `${fmtA} ✅`.padEnd(NAME_COL_WIDTH + 2);
      colB = fmtB;
    } else if (winner === 'B') {
      colA = fmtA.padEnd(NAME_COL_WIDTH + 2);
      colB = `${fmtB} ✅`;
    } else if (winner === 'tie') {
      colA = `${fmtA} —`.padEnd(NAME_COL_WIDTH + 2);
      colB = `${fmtB} —`;
    } else {
      colA = fmtA.padEnd(NAME_COL_WIDTH + 2);
      colB = fmtB;
    }

    const labelStr = `${row.emoji} ${row.label}${row.isFocus ? ' (foco)' : ''}`;
    codeLines.push(`${labelStr.padEnd(labelPad)}${colA}${colB}`);
  }

  lines.push('```');
  lines.push(codeLines.join('\n'));
  lines.push('```');

  // Footer lines (outside code block — escape dynamic values).
  const confA = CONFIDENCE_MAP[resultA.confidenceLevel] ?? escapeMarkdown(resultA.confidenceLevel);
  const confB = CONFIDENCE_MAP[resultB.confidenceLevel] ?? escapeMarkdown(resultB.confidenceLevel);
  lines.push(`_Confianza: ${confA} / ${confB}_`);

  // Chain line.
  const chainA = resultA.chainSlug;
  const chainB = resultB.chainSlug;
  if (chainA && chainB) {
    lines.push(`_Cadena: ${escapeMarkdown(chainA)} / ${escapeMarkdown(chainB)}_`);
  } else if (chainA) {
    lines.push(`_Cadena: ${escapeMarkdown(chainA)}_`);
  } else if (chainB) {
    lines.push(`_Cadena: ${escapeMarkdown(chainB)}_`);
  }

  // Portion multiplier lines.
  // F-UX-A: label sourced from @foodxplorer/shared formatPortionLabel helper.
  if (dataA.portionMultiplier !== 1.0) {
    const label = formatPortionLabel(dataA.portionMultiplier);
    lines.push(`_Porción ${escapeMarkdown(nameA)}: ${escapeMarkdown(label)} \\(x${escapeMarkdown(String(dataA.portionMultiplier))}\\)_`);
  }
  if (dataB.portionMultiplier !== 1.0) {
    const label = formatPortionLabel(dataB.portionMultiplier);
    lines.push(`_Porción ${escapeMarkdown(nameB)}: ${escapeMarkdown(label)} \\(x${escapeMarkdown(String(dataB.portionMultiplier))}\\)_`);
  }

  // Same-entity note.
  if (resultA.entityId === resultB.entityId) {
    lines.push('');
    lines.push('_Ambos platos corresponden al mismo resultado en la base de datos\\._');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RowData {
  key: string;
  emoji: string;
  label: string;
  unit: string;
  valA: number;
  valB: number;
  isFocus: boolean;
}

function buildNutrientRows(
  nutsA: EstimateNutrients,
  nutsB: EstimateNutrients,
  nutrientFocus?: string,
): RowData[] {
  const focusEnKey = nutrientFocus ? NUTRIENT_FOCUS_MAP[nutrientFocus] : undefined;

  const rows: RowData[] = [];
  let focusRow: RowData | undefined;

  for (const row of NUTRIENT_ROWS) {
    const valA = nutsA[row.key] as number;
    const valB = nutsB[row.key] as number;

    // Skip optional rows where both values are 0.
    if (row.optional && valA === 0 && valB === 0) continue;

    const rowData: RowData = {
      key: row.key,
      emoji: row.emoji,
      label: row.label,
      unit: row.unit,
      valA,
      valB,
      isFocus: row.key === focusEnKey,
    };

    if (row.key === focusEnKey) {
      focusRow = rowData;
    } else {
      rows.push(rowData);
    }
  }

  // Focus row goes first.
  if (focusRow) {
    rows.unshift(focusRow);
  }

  return rows;
}

function formatPartialComparison(
  dataA: EstimateData,
  dataB: EstimateData,
  errorNotes?: ErrorNotes,
): string {
  const resultA = dataA.result;
  const available = resultA !== null ? dataA : dataB;
  const nullSide = resultA === null ? 'A' : 'B';
  const nullQuery = nullSide === 'A' ? dataA.query : dataB.query;
  const errorNote = nullSide === 'A' ? errorNotes?.errorNoteA : errorNotes?.errorNoteB;

  const card = formatEstimate(available);

  let note: string;
  if (errorNote === 'timeout') {
    note = `_Tiempo de espera agotado para "${escapeMarkdown(nullQuery)}"\\._`;
  } else {
    note = `_No se encontraron datos para "${escapeMarkdown(nullQuery)}"\\._`;
  }

  return `${card}\n\n${note}`;
}
