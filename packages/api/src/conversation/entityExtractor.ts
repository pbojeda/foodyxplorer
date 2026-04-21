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
  // "qué como/pido/comer con X kcal/calorías"
  /qu[eé]\s+(?:como|pido|comer|puedo\s+comer|puedo\s+pedir)\s+con\s+(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "me quedan/sobran X kcal/calorías"
  /me\s+(?:quedan|sobran)\s+(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "tengo [solo/sólo] X kcal/calorías"
  /tengo\s+(?:solo\s+|s[oó]lo\s+)?(\d+)\s*(?:kcal|calor[ií]as?)/i,
  // "con X kcal/calorías qué puedo comer/pedir"
  /con\s+(\d+)\s*(?:kcal|calor[ií]as?)\s+qu[eé]\s+(?:puedo\s+)?(?:comer|pedir|pido|como)/i,
  // "X kcal/calorías qué como/pido"
  /(\d+)\s*(?:kcal|calor[ií]as?)\s+qu[eé]\s+(?:como|pido|comer)/i,
];

// Optional protein patterns — scanned after calorie match.
const PROTEIN_PATTERNS: RegExp[] = [
  // "necesito Xg proteína(s)"
  /necesito\s+(\d+)\s*g\s*prote[ií]nas?/i,
  // "mínimo Xg proteína(s)"
  /m[ií]nimo\s+(\d+)\s*g\s*prote[ií]nas?/i,
  // "al menos Xg [de] proteína(s)"
  /al\s+menos\s+(\d+)\s*g\s*(?:de\s+)?prote[ií]nas?/i,
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

// F-NLP (spec §Decision 1): Conversational wrapper patterns — Spanish past-tense
// self-reference, intent-to-eat, and extended info-request wrappers. Applied BEFORE
// PREFIX_PATTERNS so that extended-nutrient requests (e.g., "cuánta proteína tiene")
// are stripped before the narrower "cuántas calorías" patterns get a chance to fire.
// The nutrient alternation in pattern 10 explicitly excludes `calor[ií]as` to stay
// disjoint from PREFIX_PATTERNS[0]. All patterns: `^`-anchored, `i` flag, longest-first.
// Single pass: first match wins. Intent-to-eat requires `me` (pattern 7) to stay
// disjoint from Category D ("voy a pedir una receta" → non-food, must NOT strip).
export const CONVERSATIONAL_WRAPPER_PATTERNS: readonly RegExp[] = [
  // 1. Past-tense + object pronoun: "me he tomado/bebido/comido/..." — longest form
  /^me\s+he\s+(?:tomado|bebido|comido|cenado|desayunado|almorzado|merendado)\s+/i,
  // 2. Past-tense impersonal with temporal marker + pronoun: "anoche me cené ..."
  /^(?:ayer|anoche|anteayer|hoy|esta\s+ma[nñ]ana|esta\s+noche)\s+me\s+(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|beb[ií])\s+/i,
  // 3. Past-tense impersonal without pronoun: "anoche cené ..."
  /^(?:ayer|anoche|anteayer|hoy|esta\s+ma[nñ]ana|esta\s+noche)\s+(?:cen[eé]|desayun[eé]|almorc[eé]|com[ií]|merend[eé]|tom[eé]|beb[ií])\s+/i,
  // 4. "he + participle" bare (with optional hoy): "he desayunado ..." / "hoy he comido ..."
  /^(?:hoy\s+)?he\s+(?:tomado|bebido|comido|cenado|desayunado|almorzado|merendado)\s+/i,
  // 5. "acabo de + infinitive": "acabo de comer ..."
  /^acabo\s+de\s+(?:comer|tomar|beber|cenar|desayunar|almorzar|merendar)\s+/i,
  // 6. "para + meal + tuve/comí/tomé": "para cenar tuve ..."
  /^para\s+(?:cenar|desayunar|comer|almorzar|merendar)\s+(?:tuve|com[ií]|tom[eé])\s+/i,
  // 7. Intent-to-eat (me voy a pedir / me pido): "me voy a pedir ..." / "me pido ..."
  /^me\s+(?:voy\s+a\s+(?:pedir|comer|tomar|beber)|pido)\s+/i,
  // 8. "quiero saber / necesito saber" + nutrient phrase: "quiero saber las calorías de ..."
  /^(?:quiero|necesito)\s+saber\s+(?:las?\s+|los?\s+)?(?:calor[ií]as?|nutrientes|informaci[oó]n\s+nutricional|valores?\s+nutricionales?)\s+(?:de[l]?\s+)?/i,
  // 9. "cuánto engorda [un/una] ...": "cuánto engorda una ración de croquetas"
  /^cu[aá]nto\s+engorda\s+(?:un[ao]?\s+)?/i,
  // 10. "cuánta/cuántos + nutrient + tiene/hay en/lleva/contiene [article]"
  /^cu[aá]nt[ao]s?\s+(?:prote[ií]nas?|grasas?|carbohidratos?|hidratos?|fibra|sodio|sal|az[uú]car)\s+(?:tiene[n]?|hay\s+en|lleva|contiene)\s+(?:un[ao]?\s+|el\s+|la\s+|del?\s+|al\s+)?/i,
  // 11. "necesito [saber] los nutrientes de[l]"
  /^necesito\s+(?:saber\s+)?(?:los?\s+|las?\s+)?(?:nutrientes|valores\s+nutricionales?|calor[ií]as?)\s+(?:de[l]?\s+)?/i,
];

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
// F-MORPH: added "caña(s) de" so that normalizeDiminutive("cañita"→"caña") creates a SERVING candidate
// that the second SERVING pass (post-normalizeDiminutive) can strip correctly (AC7).
// Used in both extractFoodQuery and parseDishExpression. Shared constant to avoid duplication.
export const SERVING_FORMAT_PATTERNS: readonly RegExp[] = [
  /^tapas?\s+de\s+/i,
  /^pintxos?\s+de\s+/i,
  /^pinchos?\s+de\s+/i,
  /^raciones\s+de\s+/i,
  /^raci[oó]n\s+de\s+/i,
  /^ca[ñn]as?\s+de\s+/i,
];

// Article/determiner stripping — applied once after prefix step.
// F-MORPH: extended un[ao]? → un[ao]?s? to cover unas/unos (P3 fix).
export const ARTICLE_PATTERN = /^(?:un[ao]?s?|el|la[s]?|los|del|al)\s+/i;

// F-MORPH: Container/vessel strip — pure wrappers with no calorie semantics.
// Applied AFTER ARTICLE_PATTERN, BEFORE SERVING_FORMAT_PATTERNS.
// NOTE: "vaso de" is intentionally excluded — it belongs to F-DRINK (drink portion).
// "vasito de" (diminutive container) is owned by F-MORPH.
export const CONTAINER_PATTERNS: readonly RegExp[] = [
  /^plato\s+de\s+/i,
  /^platito\s+de\s+/i,
  /^cuenco\s+de\s+/i,
  /^bol\s+de\s+/i,
  /^vasito\s+de\s+/i,
  /^jarrita\s+de\s+/i,
  /^poco\s+de\s+/i,
  /^poqu?ito\s+de\s+/i,
  /^trozo\s+de\s+/i,
  /^trocito\s+de\s+/i,
];

// F-MORPH: Curated diminutive → base form map (Option A).
// Only known food/portion diminutives to avoid false-positive on non-food words.
// Extend this map as future QA batteries surface additional cases.
export const DIMINUTIVE_MAP: Readonly<Record<string, string>> = {
  tapita: 'tapa',
  tapitas: 'tapas',
  cañita: 'caña',
  cañitas: 'cañas',
  copita: 'copa',
  copitas: 'copas',
  pintxito: 'pintxo',
  pinchito: 'pincho',
  racioncita: 'ración',
  racioncitas: 'raciones',
  croquetita: 'croqueta',
  croquetitas: 'croquetas',
  gambita: 'gamba',
  gambitas: 'gambas',
  boqueronito: 'boquerón',
  boqueronitos: 'boquerones',
  trocito: 'trozo',
  trocitos: 'trozos',
};

/**
 * Replace each whitespace-separated token in `text` with its base form
 * if found in DIMINUTIVE_MAP (case-insensitive). Tokens not in the map
 * are returned unchanged.
 */
export function normalizeDiminutive(text: string): string {
  return text
    .split(/\s+/)
    .map((token) => DIMINUTIVE_MAP[token.toLowerCase()] ?? token)
    .join(' ');
}

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

  // Step 2a — F-NLP: Conversational wrapper stripping (single pass, first match wins).
  // Runs before PREFIX_PATTERNS so that extended info-request and past-tense wrappers
  // are stripped cleanly before the narrower prefix patterns are attempted.
  for (const pattern of CONVERSATIONAL_WRAPPER_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder) {
      remainder = stripped;
      break;
    }
  }

  // Step 2b — Prefix stripping (single pass, first match wins)
  for (const pattern of PREFIX_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder) {
      remainder = stripped;
      break;
    }
  }

  // Article/determiner stripping (once, after prefix step)
  // F-MORPH: ARTICLE_PATTERN now includes unas/unos (P3 fix).
  remainder = remainder.replace(ARTICLE_PATTERN, '');

  // F-MORPH: Container/vessel strip (plato de, cuenco de, bol de, vasito de, jarrita de, poco/poquito de).
  // Applied AFTER article strip, BEFORE serving-format strip.
  for (const pattern of CONTAINER_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder && stripped.trim().length > 0) {
      remainder = stripped.trim();
      break;
    }
  }

  // F078: Serving-format prefix stripping (tapa de, pincho de, pintxo de, ración de, caña de)
  for (const pattern of SERVING_FORMAT_PATTERNS) {
    const stripped = remainder.replace(pattern, '');
    if (stripped !== remainder && stripped.trim().length > 0) {
      remainder = stripped.trim();
      break;
    }
  }

  // F-MORPH: Diminutive normalization — map known diminutive tokens to base forms.
  // Runs on tokens so partial matches (e.g., "de") are left untouched.
  const normalized = normalizeDiminutive(remainder);
  if (normalized !== remainder) {
    remainder = normalized;
    // Second SERVING pass: normalizeDiminutive may produce a new SERVING candidate
    // (e.g., "tapita de aceitunas" → "tapa de aceitunas" → SERVING strips "tapa de").
    for (const pattern of SERVING_FORMAT_PATTERNS) {
      const stripped = remainder.replace(pattern, '');
      if (stripped !== remainder && stripped.trim().length > 0) {
        remainder = stripped.trim();
        break;
      }
    }
  }

  // Step 3 — Fallback: if stripped result is empty, use original trimmed text
  const query = remainder.trim() || originalTrimmed;

  return chainSlug !== undefined ? { query, chainSlug } : { query };
}
