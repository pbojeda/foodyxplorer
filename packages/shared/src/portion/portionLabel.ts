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

// ---------------------------------------------------------------------------
// F-UX-B — Canonical Spanish portion-term label map
// ---------------------------------------------------------------------------

/**
 * Maps internal canonical DB keys for Spanish portion terms to their display
 * labels. Used as a fallback when `portionAssumption.termDisplay` is absent.
 *
 * Both `pintxo` and `pincho` spellings are included so that either the Basque
 * canonical key or the Castilian variant produces the correct label.
 */
const PORTION_TERM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pintxo: 'Pintxo',
  pincho: 'Pincho',
  tapa: 'Tapa',
  media_racion: 'Media ración',
  racion: 'Ración',
});

/**
 * Format a canonical portion-term key as a Spanish display label.
 *
 * Returns the mapped Spanish label (e.g., `"media_racion"` → `"Media ración"`).
 * Falls through to the original value for unknown keys (pass-through).
 * Callers should prefer `portionAssumption.termDisplay` (the user's literal
 * wording from their query) when available; use this helper only as a fallback.
 */
export function formatPortionTermLabel(term: string): string {
  return PORTION_TERM_LABELS[term] ?? term;
}

// ---------------------------------------------------------------------------
// F-UX-A — Canonical Spanish portion-size label map (multiplier-based)
// ---------------------------------------------------------------------------

export const PORTION_LABEL_MAP: Readonly<Record<number, string>> = Object.freeze({
  0.5: 'media',
  0.7: 'pequeña',
  1.5: 'grande',
  2.0: 'doble',
  3.0: 'triple',
});

/**
 * Epsilon for near-1.0 detection. Multipliers within this band of 1.0 are
 * treated as "no modifier" so a noisy float (e.g. `1.0000001` from JSON
 * round-tripping or query coercion) cannot produce a degenerate "×1" pill.
 * 0.001 is well below the granularity any real modifier pattern emits
 * (the canonical map jumps by 0.2 at minimum between 0.5 and 0.7).
 */
const PORTION_NOOP_EPSILON = 0.001;

/**
 * Format a portion multiplier as a Spanish label for UI display.
 *
 * - Multipliers within `PORTION_NOOP_EPSILON` of 1.0 return an empty string
 *   (caught by the same `=== 1.0` semantic the callers use — but tolerant
 *   of IEEE 754 round-trip noise).
 * - Mapped values return the word (`"media"`, `"pequeña"`, `"grande"`,
 *   `"doble"`, `"triple"`). Matching uses an epsilon tolerance so that
 *   a noisy `0.50000001` still finds the canonical key.
 * - Unmapped values return a `×N` fallback string trimmed to one decimal
 *   (e.g. `1.25` → `"×1.25"`, `2.5` → `"×2.5"`).
 */
export function formatPortionLabel(multiplier: number): string {
  if (Math.abs(multiplier - 1.0) < PORTION_NOOP_EPSILON) {
    return '';
  }
  // Canonical map lookup with epsilon tolerance so that IEEE 754 round-trip
  // values (e.g. 0.500000001) still hit the canonical Spanish label.
  for (const [keyStr, label] of Object.entries(PORTION_LABEL_MAP)) {
    const key = Number(keyStr);
    if (Math.abs(multiplier - key) < PORTION_NOOP_EPSILON) {
      return label;
    }
  }
  // Unmapped fallback — strip trailing ".0" and limit to 2 decimals.
  const normalized = Number.isInteger(multiplier)
    ? multiplier.toString()
    : multiplier.toFixed(2).replace(/\.?0+$/, '');
  return `×${normalized}`;
}
