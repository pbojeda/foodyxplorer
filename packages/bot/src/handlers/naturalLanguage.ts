// Natural language handler for the Telegram bot (F070 refactor).
//
// handleNaturalLanguage: thin adapter that calls apiClient.processMessage()
//   and switches on data.intent to format the Telegram-specific response.
//
// extractFoodQuery: pure function retained for backward compatibility with
//   other callers. NOT used by handleNaturalLanguage after F070.
//
// The Telegram-specific formatters (estimateFormatter, comparisonFormatter,
// contextFormatter) are NOT changed — they format the structured data returned
// by the API into MarkdownV2 strings.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { formatComparison } from '../formatters/comparisonFormatter.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { formatContextConfirmation } from '../formatters/contextFormatter.js';
import { getState } from '../lib/conversationState.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_NL_TEXT_LENGTH = 500;

// ChainSlug format: lowercase letters, digits, hyphens — MUST contain at
// least one hyphen. Identical to the regex used in commands/estimar.ts.
// Copied verbatim — do NOT import from estimar.ts (private implementation).
const CHAIN_SLUG_REGEX = /^[a-z0-9-]+-[a-z0-9-]+$/;

// Prefix patterns applied in order — longest/most-specific first.
// Single pass: first match wins. All patterns use the `i` flag.
const PREFIX_PATTERNS: readonly RegExp[] = [
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

// Article/determiner stripping — applied once after prefix step.
const ARTICLE_PATTERN = /^(?:un[ao]?|el|la[s]?|los|del|al)\s+/i;

// ---------------------------------------------------------------------------
// extractFoodQuery (retained for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Parse raw Spanish text into a query and optional chain slug.
 * Pure function — no side effects, no I/O.
 *
 * NOTE: This function is NOT used by handleNaturalLanguage after F070.
 * It is retained here for backward compatibility with other callers.
 */
export function extractFoodQuery(text: string): { query: string; chainSlug?: string } {
  // Strip leading ¿¡ and trailing ?! — consistent with extractComparisonQuery
  // and detectContextSet (BUG-AUDIT-01 / F050).
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

  // Step 3 — Fallback: if stripped result is empty, use original trimmed text
  const query = remainder.trim() || originalTrimmed;

  return chainSlug !== undefined ? { query, chainSlug } : { query };
}

// ---------------------------------------------------------------------------
// handleNaturalLanguage
// ---------------------------------------------------------------------------

// Pre-escaped MarkdownV2 string for the >500-char prompt.
// Must NOT be built with escapeMarkdown() — that would escape the _ delimiters
// breaking italic formatting.
const TOO_LONG_MESSAGE =
  'Por favor, sé más específico\\. Escribe el nombre del plato directamente, por ejemplo: _big mac_';

/**
 * Handle a plain-text natural language message (F070 refactor).
 * Calls apiClient.processMessage() and formats the structured response.
 * Returns a MarkdownV2-formatted string for Telegram.
 *
 * Unknown errors are rethrown so wrapHandler in bot.ts can log them and
 * reply with the generic "error inesperado" message.
 */
export async function handleNaturalLanguage(
  text: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string> {
  // Read legacy bot:state chainContext (for backward compat while /contexto
  // command still writes to bot:state rather than conv:ctx).
  // getState is fail-open (returns null on Redis error).
  const botState = await getState(redis, chatId);
  const legacyChainContext = botState?.chainContext;

  // Call ConversationCore via HTTP
  const data = await apiClient.processMessage(text, chatId, legacyChainContext);

  // Format based on intent
  switch (data.intent) {
    case 'estimation': {
      if (!data.estimation) {
        return 'No se encontraron datos nutricionales para esta consulta\\.';
      }

      let result = formatEstimate(data.estimation);

      // Append context indicator ONLY when chainSlug was injected from context,
      // not when the user typed an explicit slug (F054 behavior preserved).
      if (data.usedContextFallback && data.activeContext) {
        result += `\n_Contexto activo: ${escapeMarkdown(data.activeContext.chainName)}_`;
      }

      return result;
    }

    case 'comparison': {
      if (!data.comparison) {
        return 'No se encontraron datos de comparación\\.';
      }

      return formatComparison(
        data.comparison.dishA,
        data.comparison.dishB,
        data.comparison.nutrientFocus as Parameters<typeof formatComparison>[2],
        {},
      );
    }

    case 'context_set': {
      if (data.ambiguous) {
        return 'Encontré varias cadenas con ese nombre\\. Por favor, usa el slug exacto \\(por ejemplo: mcdonalds\\-es\\)\\. Usa /cadenas para ver los slugs\\.';
      }

      if (data.contextSet) {
        return formatContextConfirmation(data.contextSet.chainName, data.contextSet.chainSlug);
      }

      // Should not reach here
      return 'Contexto procesado\\.';
    }

    case 'text_too_long':
      return TOO_LONG_MESSAGE;

    default: {
      // Exhaustive check — TypeScript ensures all intents are handled
      const _exhaustive: never = data.intent;
      return `Intent desconocido: ${_exhaustive}`;
    }
  }
}
