// Pure function to extract Spanish portion-size modifiers from free-form text.
// Returns the cleaned query (modifier stripped) and a numeric multiplier.

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
