// Pure entity extraction functions for the Conversation Core (F070).
//
// All functions are copied from bot package sources — they remain unchanged
// in the bot. The bot's naturalLanguage.ts handler will be refactored in
// Step 9 to call POST /conversation/message rather than these functions
// directly.
//
// Sources:
//   detectContextSet      — packages/bot/src/lib/contextDetector.ts
//   extractPortionModifier — packages/bot/src/lib/portionModifier.ts
//   extractComparisonQuery, splitByComparator, parseDishExpression
//                          — packages/bot/src/lib/comparisonParser.ts
//   extractFoodQuery       — packages/bot/src/handlers/naturalLanguage.ts

// ---------------------------------------------------------------------------
// detectContextSet (from packages/bot/src/lib/contextDetector.ts)
// ---------------------------------------------------------------------------

// Regex matches: "estoy en [optional article] <capture>"
// Articles el/la/los/las are in a non-capturing optional group — NOT part of capture.
// Capture group is limited to 1-50 non-comma non-punctuation characters.
const CONTEXT_SET_REGEX = /^estoy\s+en\s+(?:el\s+|la\s+|los\s+|las\s+)?([^,¿?!.]{1,50})$/i;

/**
 * Detect a context-set intent from raw input text.
 *
 * Strips leading ¿/¡ and trailing ?/!/. then applies CONTEXT_SET_REGEX.
 * Returns the trimmed chain identifier, or null if no match.
 */
export function detectContextSet(text: string): string | null {
  // Strip leading inverted punctuation and trailing punctuation
  const stripped = text
    .replace(/^[¿¡]+/, '')
    .replace(/[?!.]+$/, '')
    .trim();

  if (!stripped || /\n/.test(stripped)) return null;

  const match = CONTEXT_SET_REGEX.exec(stripped);
  if (!match) return null;

  const captured = match[1]?.trim() ?? '';
  return captured.length > 0 ? captured : null;
}

// ---------------------------------------------------------------------------
// F086 — detectReverseSearch
// ---------------------------------------------------------------------------

export interface DetectedReverseSearch {
  maxCalories: number;
  minProtein?: number;
}

// Patterns for calorie detection in reverse search queries.
// All patterns extract a numeric calorie value.
const REVERSE_SEARCH_PATTERNS: RegExp[] = [
  // "qué como/pido con X kcal/calorías"
  /qu[eé]\s+(?:como|pido)\s+con\s+(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "me quedan X kcal/calorías"
  /me\s+quedan\s+(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "tengo X kcal/calorías"
  /tengo\s+(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "con X kcal/calorías qué puedo comer/pedir"
  /con\s+(\d+)\s*(?:kcal|calor[ií]as?)\s+qu[eé]\s+(?:puedo\s+)?(?:comer|pedir|pido|como)/i,
  // "X kcal/calorías qué como/pido"
  /(\d+)\s*(?:kcal|calor[ií]as?)\s+qu[eé]\s+(?:como|pido)/i,
];

// Optional protein patterns — scanned after calorie match.
const PROTEIN_PATTERNS: RegExp[] = [
  // "necesito Xg proteína(s)"
  /necesito\s+(\d+)\s*g\s*prote[ií]nas?/i,
  // "mínimo Xg proteína(s)"
  /m[ií]nimo\s+(\d+)\s*g\s*prote[ií]nas?/i,
  // "al menos Xg proteína(s)"
  /al\s+menos\s+(\d+)\s*g\s*prote[ií]nas?/i,
];

/**
 * Detect a reverse search intent from raw input text.
 * Returns `{ maxCalories, minProtein? }` or null if no match.
 */
export function detectReverseSearch(text: string): DetectedReverseSearch | null {
  // Strip leading ¿¡ and trailing ?!.
  const cleaned = text.replace(/^[¿¡]+/, '').replace(/[?!.]+$/, '').trim();
  if (!cleaned || /\n/.test(cleaned)) return null;

  let maxCalories: number | null = null;

  for (const pattern of REVERSE_SEARCH_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (match?.[1]) {
      maxCalories = Number(match[1]);
      break;
    }
  }

  if (maxCalories === null) return null;

  // Check for optional protein constraint
  let minProtein: number | undefined;
  for (const pattern of PROTEIN_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (match?.[1]) {
      minProtein = Number(match[1]);
      break;
    }
  }

  return minProtein !== undefined
    ? { maxCalories, minProtein }
    : { maxCalories };
}

// ---------------------------------------------------------------------------
// extractPortionModifier (from packages/bot/src/lib/portionModifier.ts)
// ---------------------------------------------------------------------------

interface PortionModifierResult {
  cleanQuery: string;
  portionMultiplier: number;
}

interface PatternEntry {
  regex: RegExp;
  multiplier: number;
}

// Ordered longest/most-specific first to prevent short patterns from matching
// inside longer ones (e.g. "grande" must not match inside "extra grande").
const PATTERNS: readonly PatternEntry[] = [
  { regex: /\bextra[\s-]grandes?\b/i,           multiplier: 1.5 },
  { regex: /\braci[oó]n\s+doble\b/i,            multiplier: 2.0 },
  { regex: /\braciones\s+dobles\b/i,             multiplier: 2.0 },
  { regex: /\bmedias?\s+raci[oó]n\b/i,           multiplier: 0.5 },
  { regex: /\bmedias\s+raciones\b/i,             multiplier: 0.5 },
  { regex: /\btriples?\b/i,                      multiplier: 3.0 },
  { regex: /\bdobles?\b/i,                       multiplier: 2.0 },
  { regex: /\bgrandes?\b/i,                      multiplier: 1.5 },
  { regex: /\bxl\b/i,                            multiplier: 1.5 },
  { regex: /\bpeque[ñn][oa]s?\b/i,               multiplier: 0.7 },
  { regex: /\bpeque\b/i,                         multiplier: 0.7 },
  { regex: /\bminis?\b/i,                        multiplier: 0.7 },
  { regex: /\bmedios?\b/i,                       multiplier: 0.5 },
  { regex: /\bmedias?\b/i,                       multiplier: 0.5 },
  { regex: /\bhalf\b/i,                          multiplier: 0.5 },
];

export function extractPortionModifier(text: string): PortionModifierResult {
  for (const { regex, multiplier } of PATTERNS) {
    if (regex.test(text)) {
      const cleaned = text.replace(regex, '').replace(/\s+/g, ' ').trim();
      if (cleaned.length === 0) {
        // Stripping the modifier leaves nothing — fall back to original text.
        return { cleanQuery: text, portionMultiplier: 1.0 };
      }
      return { cleanQuery: cleaned, portionMultiplier: multiplier };
    }
  }
  return { cleanQuery: text, portionMultiplier: 1.0 };
}

// ---------------------------------------------------------------------------
// Types for comparison parsing
// ---------------------------------------------------------------------------

export type NutrientFocusKey =
  | 'calorías'
  | 'proteínas'
  | 'grasas'
  | 'carbohidratos'
  | 'fibra'
  | 'sodio'
  | 'sal';

export interface ParsedComparison {
  dishA: string;
  dishB: string;
  nutrientFocus?: NutrientFocusKey;
}

// ---------------------------------------------------------------------------
// Comparison parser constants (from packages/bot/src/lib/comparisonParser.ts)
// ---------------------------------------------------------------------------

// Strong separators (word-boundary, first occurrence) tried first,
// then weak separators (space-flanked, last occurrence).
export const COMPARISON_SEPARATORS = ['versus', 'contra', 'vs', 'o', 'y', 'con'] as const;

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at
// least one hyphen.
const CHAIN_SLUG_REGEX_COMP = /^[a-z0-9-]+-[a-z0-9-]+$/;

// Nutrient token → canonical NutrientFocusKey.
const NUTRIENT_TOKEN_MAP: Record<string, NutrientFocusKey> = {
  'calorias': 'calorías',
  'calorías': 'calorías',
  'proteinas': 'proteínas',
  'proteínas': 'proteínas',
  'grasas': 'grasas',
  'hidratos': 'carbohidratos',
  'carbohidratos': 'carbohidratos',
  'fibra': 'fibra',
  'sodio': 'sodio',
  'sal': 'sal',
};

const NUTRIENT_TOKENS = Object.keys(NUTRIENT_TOKEN_MAP).join('|');

interface PrefixMatch {
  remainder: string;
  nutrientFocus: NutrientFocusKey | undefined;
}

const PREFIX_PATTERNS_COMP: Array<{
  regex: RegExp;
  extractFocus: boolean;
  fixedFocus?: NutrientFocusKey;
}> = [
  // "qué tiene más <nutrient>,? <remainder>"
  { regex: new RegExp(`^qu[eé]\\s+tiene\\s+m[aá]s\\s+(${NUTRIENT_TOKENS}),?\\s+`, 'i'), extractFocus: true },
  // "qué tiene menos <nutrient>,? <remainder>"
  { regex: new RegExp(`^qu[eé]\\s+tiene\\s+menos\\s+(${NUTRIENT_TOKENS}),?\\s+`, 'i'), extractFocus: true },
  // "qué engorda más,? <remainder>"
  { regex: /^qu[eé]\s+engorda\s+m[aá]s,?\s+/i, extractFocus: false, fixedFocus: 'calorías' },
  // "qué es más sano,? <remainder>"
  { regex: /^qu[eé]\s+es\s+m[aá]s\s+san[oa],?\s+/i, extractFocus: false },
  // "compara[r]? <remainder>"
  { regex: /^compara[r]?\s+/i, extractFocus: false },
];

// ---------------------------------------------------------------------------
// splitByComparator (from packages/bot/src/lib/comparisonParser.ts)
// ---------------------------------------------------------------------------

/**
 * Split a text string on the first recognised comparison separator.
 * Separators are tried in descending length order (longest first wins).
 * For 'o' and 'y', uses the LAST occurrence and requires space-flanking.
 * Returns [left, right] or null if no valid split found.
 */
export function splitByComparator(text: string): [string, string] | null {
  if (!text) return null;

  for (const sep of COMPARISON_SEPARATORS) {
    let regex: RegExp;
    let useLastOccurrence = false;

    if (sep === 'con' || sep === 'o' || sep === 'y') {
      // Space-flanked + last-occurrence to avoid matching inside dish names
      regex = new RegExp(` ${sep} `, 'gi');
      useLastOccurrence = true;
    } else {
      // Word-boundary match with optional trailing dot (for "vs.").
      regex = new RegExp(`\\b${sep}\\.?(?=\\s|$)`, 'gi');
    }

    if (useLastOccurrence) {
      let lastIndex = -1;
      let lastMatchLen = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        lastIndex = match.index;
        lastMatchLen = match[0].length;
      }
      if (lastIndex !== -1) {
        const left = text.slice(0, lastIndex).trim();
        const right = text.slice(lastIndex + lastMatchLen).trim();
        if (left && right) return [left, right];
      }
    } else {
      const match = regex.exec(text);
      if (match) {
        const left = text.slice(0, match.index).trim();
        const right = text.slice(match.index + match[0].length).trim();
        if (left && right) return [left, right];
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseDishExpression (from packages/bot/src/lib/comparisonParser.ts)
// ---------------------------------------------------------------------------

/**
 * Parse a single dish expression (one side of the comparison).
 * Extracts optional chainSlug (last " en " + valid slug) and portionMultiplier.
 */
export function parseDishExpression(text: string): {
  query: string;
  chainSlug?: string;
  portionMultiplier: number;
} {
  const trimmed = text.trim();

  // Step 1 — Chain slug extraction (last " en " split, same as estimar.ts)
  const separator = ' en ';
  const lastIdx = trimmed.lastIndexOf(separator);

  let remainder = trimmed;
  let chainSlug: string | undefined;

  if (lastIdx !== -1) {
    const candidateSlug = trimmed.slice(lastIdx + separator.length).trim();
    if (CHAIN_SLUG_REGEX_COMP.test(candidateSlug)) {
      chainSlug = candidateSlug;
      remainder = trimmed.slice(0, lastIdx).trim();
    }
  }

  // Step 2 — Strip trailing punctuation (?, !) and leading articles (un, una, el, la).
  remainder = remainder.replace(/[?!]+$/, '').trim();
  remainder = remainder.replace(/^(?:un[ao]?|el|la)\s+/i, '');

  // Step 2.5 — F078: Strip serving-format prefixes (tapa de, pincho de, pintxo de, ración de)
  for (const pattern of SERVING_FORMAT_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder && stripped.trim().length > 0) {
      remainder = stripped.trim();
      break;
    }
  }

  // Step 3 — Portion modifier extraction
  const { cleanQuery, portionMultiplier } = extractPortionModifier(remainder);

  const result: { query: string; chainSlug?: string; portionMultiplier: number } = {
    query: cleanQuery,
    portionMultiplier,
  };

  if (chainSlug !== undefined) {
    result.chainSlug = chainSlug;
  }

  return result;
}

// ---------------------------------------------------------------------------
// extractComparisonQuery (from packages/bot/src/lib/comparisonParser.ts)
// ---------------------------------------------------------------------------

function matchPrefix(text: string): PrefixMatch | null {
  for (const pattern of PREFIX_PATTERNS_COMP) {
    const match = pattern.regex.exec(text);
    if (match) {
      const remainder = text.slice(match[0].length).trim();
      if (!remainder) return null;

      let nutrientFocus: NutrientFocusKey | undefined;

      if (pattern.extractFocus && match[1]) {
        nutrientFocus = NUTRIENT_TOKEN_MAP[match[1].toLowerCase()];
      } else if (pattern.fixedFocus) {
        nutrientFocus = pattern.fixedFocus;
      }

      return { remainder, nutrientFocus };
    }
  }
  return null;
}

/**
 * Detect NL comparison intent. Returns ParsedComparison if matched, null otherwise.
 *
 * Two-phase approach:
 * Phase 1 — Match a prefix regex to identify comparison intent + optional nutrientFocus.
 * Phase 2 — Pass remainder to splitByComparator for separator splitting.
 */
export function extractComparisonQuery(text: string): ParsedComparison | null {
  // Strip leading ¿/¡ and trailing ?/! — Spanish punctuation common in chat.
  const cleaned = text.replace(/^[¿¡]+/, '').replace(/[?!]+$/, '').trim();

  const prefixMatch = matchPrefix(cleaned);
  if (!prefixMatch) return null;

  // Strip trailing punctuation from remainder too (e.g. "big mac o whopper?").
  const remainder = prefixMatch.remainder.replace(/[?!]+$/, '').trim();

  const split = splitByComparator(remainder);
  if (!split) return null;

  return {
    dishA: split[0],
    dishB: split[1],
    nutrientFocus: prefixMatch.nutrientFocus,
  };
}

// ---------------------------------------------------------------------------
// extractFoodQuery (from packages/bot/src/handlers/naturalLanguage.ts)
// ---------------------------------------------------------------------------

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at
// least one hyphen. Identical to the regex used in commands/estimar.ts.
const CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/;

// Prefix patterns applied in order — longest/most-specific first.
// Single pass: first match wins. All patterns use the `i` flag.
export const PREFIX_PATTERNS: readonly RegExp[] = [
  // "cuántas calorías tiene[n] ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+tiene[n]?\s+/i,
  // "cuántas calorías hay en ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+hay\s+en\s+/i,
  // "cuántas calorías ..."
  /^cu[aá]ntas?\s+calor[ií]as?\s+/i,
  // "qué lleva/contiene/tiene ..."
  /^qu[eé]\s+(?:lleva|contiene|tiene)\s+/i,
  // "dame/dime [las] información/info/calorías [del] ..."
  /^(?:dame|dime)\s+(?:la[s]?\s+)?(?:informaci[oó]n|info|calor[ií]as?)\s+(?:de[l]?\s+)/i,
  // "información [nutricional] [del] ..."
  /^(?:informaci[oó]n|info)\s+(?:de[l]?\s+)?(?:nutricional\s+)?(?:de[l]?\s+)?/i,
  // "calorías de[l] [una?] ..."
  /^calor[ií]as?\s+de[l]?\s+(?:un[ao]?\s+)?/i,
  // "[buscar] [las] calorías [de[l]] [un[ao]] ..." — also covers bare "calorías ..."
  /^(?:busca[r]?\s+)?(?:la[s]?\s+)?calor[ií]as?\s+(?:de[l]?\s+)?(?:un[ao]?\s+)?/i,
];

// F078: Serving-format prefixes — "tapa(s) de", "pincho(s) de", "pintxo(s) de", "ración/racion(es) de".
// Used in both extractFoodQuery and parseDishExpression. Shared constant to avoid duplication.
export const SERVING_FORMAT_PATTERNS: readonly RegExp[] = [
  /^tapas?\s+de\s+/i,
  /^pintxos?\s+de\s+/i,
  /^pinchos?\s+de\s+/i,
  /^raciones\s+de\s+/i,
  /^raci[oó]n\s+de\s+/i,
];

// Article/determiner stripping — applied once after prefix step.
export const ARTICLE_PATTERN = /^(?:un[ao]?|el|la[s]?|los|del|al)\s+/i;

/**
 * Parse raw Spanish text into a query and optional chain slug.
 * Pure function — no side effects, no I/O.
 */
export function extractFoodQuery(text: string): { query: string; chainSlug?: string } {
  // Strip leading ¿¡ and trailing ?! — consistent with extractComparisonQuery
  // and detectContextSet.
  const originalTrimmed = text.replace(/^[¿¡]+/, '').replace(/[?!]+$/, '').trim();

  // Step 1 — Chain slug extraction (identical to parseEstimarArgs in estimar.ts)
  const separator = ' en ';
  const lastIdx = originalTrimmed.lastIndexOf(separator);

  let remainder = originalTrimmed;
  let chainSlug: string | undefined;

  if (lastIdx !== -1) {
    const candidateSlug = originalTrimmed.slice(lastIdx + separator.length).trim();
    if (CHAIN_SLUG_REGEX.test(candidateSlug)) {
      chainSlug = candidateSlug;
      remainder = originalTrimmed.slice(0, lastIdx).trim();
    }
  }

  // Step 2 — Prefix stripping (single pass, first match wins)
  for (const pattern of PREFIX_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder) {
      remainder = stripped;
      break;
    }
  }

  // Article/determiner stripping (once, after prefix step)
  remainder = remainder.replace(ARTICLE_PATTERN, '');

  // F078: Serving-format prefix stripping (tapa de, pincho de, pintxo de, ración de)
  for (const pattern of SERVING_FORMAT_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder && stripped.trim().length > 0) {
      remainder = stripped.trim();
      break;
    }
  }

  // Step 3 — Fallback: if stripped result is empty, use original trimmed text
  const query = remainder.trim() || originalTrimmed;

  return chainSlug !== undefined ? { query, chainSlug } : { query };
}
