// /restaurante [name] command handler (F032).
//
// Unlike other command handlers, this one does NOT return a Promise<string>.
// It sends messages directly via bot.sendMessage so that it can attach inline
// keyboards (reply_markup). The wrapHandler pattern in bot.ts only supports
// text-only responses; this handler is wired directly.
//
// Behaviour:
//   /restaurante           → show current context from Redis (or "no context")
//   /restaurante <name>    → search for restaurants, show inline keyboard
//                            0 results → show "Crear restaurante" button

import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { getState, setState } from '../lib/conversationState.js';
import { handleApiError } from './errorMessages.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';

// Max number of results shown in the inline keyboard.
const MAX_RESULTS = 5;

/**
 * Handle the /restaurante command.
 *
 * @param args    Text after the command (trimmed). Empty string if no args.
 * @param chatId  Telegram chat ID.
 * @param bot     TelegramBot instance (used to send messages directly).
 * @param apiClient API client for restaurant search/creation.
 * @param redis   ioredis instance for conversation state.
 */
export async function handleRestaurante(
  args: string,
  chatId: number,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
): Promise<void> {
  const query = args.trim();

  // -------------------------------------------------------------------------
  // No args — show current context
  // -------------------------------------------------------------------------

  if (!query) {
    const state = await getState(redis, chatId);

    if (state?.selectedRestaurant) {
      const name = escapeMarkdown(state.selectedRestaurant.name);
      const id = escapeMarkdown(state.selectedRestaurant.id);
      await bot.sendMessage(
        chatId,
        `*Restaurante actual:* ${name}\nID: \`${id}\``,
        { parse_mode: 'MarkdownV2' },
      );
    } else {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('No hay restaurante seleccionado. Usa /restaurante <nombre> para buscar.'),
        { parse_mode: 'MarkdownV2' },
      );
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Search path
  // -------------------------------------------------------------------------

  try {
    const result = await apiClient.searchRestaurants(query);
    const items = result.items.slice(0, MAX_RESULTS);

    if (items.length === 0) {
      // No results — offer to create the restaurant
      await setState(redis, chatId, { pendingSearch: query });

      await bot.sendMessage(
        chatId,
        escapeMarkdown(`No se encontraron restaurantes para "${query}". ¿Deseas crearlo?`),
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[{ text: 'Crear restaurante', callback_data: 'create_rest' }]],
          },
        },
      );
      return;
    }

    // Build searchResults map: { [uuid]: name }
    const searchResults: Record<string, string> = {};
    for (const item of items) {
      searchResults[item.id] = item.name;
    }

    // Persist search context so callbacks can recover names
    await setState(redis, chatId, { pendingSearch: query, searchResults });

    // Build one button per result (one per row)
    const inline_keyboard = items.map((item) => [
      { text: item.name, callback_data: `sel:${item.id}` },
    ]);

    await bot.sendMessage(
      chatId,
      escapeMarkdown(`Resultados para "${query}":`),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard },
      },
    );
  } catch (err) {
    logger.warn({ err, query, chatId }, '/restaurante API error');
    const errorText = handleApiError(err);
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
  }
}
