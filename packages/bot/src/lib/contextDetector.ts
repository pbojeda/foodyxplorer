// Context-set detection for natural language messages.
//
// Detects messages like "estoy en mcdonalds" and returns the chain identifier
// so the bot can resolve and store the user's active chain context.
//
// Pure function — no side effects, no I/O.

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
