// Menu detection for "Modo Menú del Día" (F076).
//
// detectMenuQuery(text): detects "menú"/"menu" patterns in user input,
//   splits into individual dish items, filters noise, truncates to 8 items.
//   Returns string[] of dish names, or null if not a menu query.
//
// Pure function — no I/O, no side effects.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MENU_ITEMS = 8;

// Accent-insensitive menu trigger patterns (ordered longest-first).
// Each captures the remainder (dish list) after the trigger phrase.
const MENU_PATTERNS: readonly RegExp[] = [
  /^(?:hoy\s+)?(?:he\s+comido\s+)?de\s+men[uú]\s+del\s+d[ií]a[:\s,]+(.+)/is,
  /^(?:hoy\s+)?(?:he\s+comido\s+)?de\s+men[uú][:\s,]+(.+)/is,
  /^men[uú]\s+del\s+d[ií]a[:\s,]+(.+)/is,
  /^mi\s+men[uú][:\s,]+(.+)/is,
  /^men[uú][:\s,]+(.+)/is,
];

// Noise filter: prices ("12.50€", "€15", "12 euros", "€"), pure digits.
const NOISE_REGEX = /^\d+(?:[.,]\d+)?\s*(?:€|euros?)?$|^€\d|^€$/i;

// ---------------------------------------------------------------------------
// splitMenuItems — splits a raw item list string into individual dish names
// ---------------------------------------------------------------------------

function splitMenuItems(raw: string): string[] {
  // Step 1: Split by comma (primary separator)
  let items = raw.split(',').map((s) => s.trim()).filter(Boolean);

  // Step 2: Handle conjunction ` y ` / ` más ` ONLY when no commas produced 2+ items.
  // When commas ARE present, ` y ` inside items is part of dish names (e.g., "arroz y verduras").
  if (items.length === 1) {
    // No commas: try splitting on ` y ` / ` más ` to get 2 items
    const first = items[0];
    if (!first) throw new Error('items array unexpectedly empty after split — invariant violated');
    const conjSplit = splitOnFinalConjunction(first);
    if (conjSplit) {
      items = conjSplit;
    }
  }

  return items.filter(Boolean);
}

function splitOnFinalConjunction(text: string): string[] | null {
  // Try ` más ` first (less ambiguous), then ` y `
  for (const conj of [' más ', ' y ']) {
    const idx = text.lastIndexOf(conj);
    if (idx !== -1) {
      const left = text.slice(0, idx).trim();
      const right = text.slice(idx + conj.length).trim();
      if (left && right) {
        return [left, right];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// detectMenuQuery
// ---------------------------------------------------------------------------

/**
 * Detect a menu query and extract individual dish names.
 *
 * Returns an array of dish name strings (2-8 items), or null if:
 * - No "menú"/"menu" keyword found
 * - Fewer than 2 valid items after parsing/filtering
 */
export function detectMenuQuery(text: string): string[] | null {
  const trimmed = text.trim();

  // Try each pattern in order (longest/most-specific first)
  let itemsRaw: string | null = null;
  for (const pattern of MENU_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) {
      itemsRaw = match[1].trim();
      break;
    }
  }

  if (!itemsRaw) return null;

  // Split into individual items
  let items = splitMenuItems(itemsRaw);

  // Filter noise (prices, pure digits)
  items = items.filter((item) => !NOISE_REGEX.test(item));

  // Filter empty strings after noise removal
  items = items.filter(Boolean);

  // Truncate to max items
  if (items.length > MAX_MENU_ITEMS) {
    items = items.slice(0, MAX_MENU_ITEMS);
  }

  // Must have at least 2 items to be a menu
  if (items.length < 2) return null;

  return items;
}
