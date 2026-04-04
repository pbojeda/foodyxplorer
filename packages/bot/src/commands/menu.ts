// /menu command handler (F076).
//
// Syntax: /menu plato1, plato2, plato3, plato4
// Prepends "menú: " and delegates to ConversationCore via processMessage.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { formatMenuEstimate } from '../formatters/menuFormatter.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { getState } from '../lib/conversationState.js';

const USAGE_MESSAGE =
  'Uso: /menu plato1, plato2, plato3, plato4\n\nEjemplo: /menu gazpacho, pollo con patatas, flan, café';

export async function handleMenu(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return escapeMarkdown(USAGE_MESSAGE);
  }

  // Read legacy chain context (fail-open)
  const botState = await getState(redis, chatId).catch(() => null);
  const legacyChainContext = botState?.chainContext;

  // Prepend "menú: " so ConversationCore detects menu intent
  const text = `menú: ${trimmed}`;

  const data = await apiClient.processMessage(text, chatId, legacyChainContext);

  switch (data.intent) {
    case 'menu_estimation': {
      if (!data.menuEstimation) {
        return escapeMarkdown('No se pudo procesar el menú.');
      }
      return formatMenuEstimate(data.menuEstimation);
    }

    // Fallthrough: if ConversationCore classified as single-dish (< 2 items)
    case 'estimation': {
      if (!data.estimation) {
        return 'No se encontraron datos nutricionales para esta consulta\\.';
      }
      return formatEstimate(data.estimation);
    }

    case 'text_too_long':
      return escapeMarkdown('El texto del menú es demasiado largo. Intenta con menos platos.');

    default:
      return escapeMarkdown('No se pudo procesar el menú. Inténtalo de nuevo.');
  }
}
