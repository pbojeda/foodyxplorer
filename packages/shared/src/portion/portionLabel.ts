// F-UX-A — Canonical Spanish portion-size label map, shared across packages.
//
// Historical note: this map used to live in `packages/bot/src/formatters/
// estimateFormatter.ts` and was duplicated in `comparisonFormatter.ts`. It is
// consolidated here so the bot, API, and web packages all agree on the same
// Spanish labels without drifting.
//
// See BUG-F042-01 in docs/project_notes/bugs.md for the original semantic
// correction (0.5 → "media", 0.7 → "pequeña") and ADR-019 for the broader
// canonical-aliases direction.
//
// Contract:
//   - `PORTION_LABEL_MAP` is the exhaustive set of multipliers that map to a
//     natural Spanish word. Any other multiplier is considered "unmapped".
//   - `formatPortionLabel(multiplier)` returns the word for mapped values and
//     a fallback `×N` string for unmapped values (e.g. `×2.5`).
//   - Callers MUST check `multiplier !== 1.0` before calling — the 1.0 case
//     represents "no modifier applied" and has no user-facing label.

export const PORTION_LABEL_MAP: Readonly<Record<number, string>> = Object.freeze({
  0.5: 'media',
  0.7: 'pequeña',
  1.5: 'grande',
  2.0: 'doble',
  3.0: 'triple',
});

/**
 * Format a portion multiplier as a Spanish label for UI display.
 *
 * - The no-op multiplier `1.0` returns an empty string. Callers can treat
 *   an empty result as "no modifier to display" without a separate guard.
 * - Mapped values return the word (`"media"`, `"pequeña"`, `"grande"`,
 *   `"doble"`, `"triple"`).
 * - Unmapped values return a `×N` fallback string trimmed to one decimal
 *   (e.g. `1.25` → `"×1.25"`, `2.5` → `"×2.5"`).
 */
export function formatPortionLabel(multiplier: number): string {
  if (multiplier === 1.0) {
    return '';
  }
  const mapped = PORTION_LABEL_MAP[multiplier];
  if (mapped !== undefined) {
    return mapped;
  }
  // Unmapped fallback — strip trailing ".0" and limit to 2 decimals.
  const normalized = Number.isInteger(multiplier)
    ? multiplier.toString()
    : multiplier.toFixed(2).replace(/\.?0+$/, '');
  return `×${normalized}`;
}
