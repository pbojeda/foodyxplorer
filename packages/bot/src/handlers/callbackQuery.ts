// Callback query handler for inline keyboard interactions (F032).
//
// Dispatches on query.data:
//   sel:{uuid}    — user selected a restaurant from the search results
//   create_rest   — user wants to create the restaurant they searched for
//   (anything else) — silently ignored, spinner dismissed
//
// Names are recovered from Redis bot state to avoid the Telegram 64-byte
// callback_data limit. Always calls answerCallbackQuery to dismiss the spinner.

import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { getState, setState } from '../lib/conversationState.js';
import { handleApiError } from '../commands/errorMessages.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';

/** Dismiss the Telegram spinner. Never throws — a failed answer is harmless. */
async function safeAnswerCallback(bot: TelegramBot, queryId: string): Promise<void> {
  try {
    await bot.answerCallbackQuery(queryId);
  } catch (err) {
    logger.warn({ err, queryId }, 'answerCallbackQuery failed');
  }
}

/**
 * Handle a Telegram callback_query event.
 *
 * @param query     The CallbackQuery object from Telegram.
 * @param bot       TelegramBot instance (used to send messages + answer query).
 * @param apiClient API client for restaurant creation.
 * @param redis     ioredis instance for conversation state.
 */
export async function handleCallbackQuery(
  query: TelegramBot.CallbackQuery,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
): Promise<void> {
  // The query always needs to be answered to dismiss the loading spinner.
  // We call it at the end after handling (or in the finally-equivalent flow).
  // If message is missing, we can still answer the query.

  const chatId = query.message?.chat.id;
  const data = query.data ?? '';

  if (!chatId) {
    // No chat context — just dismiss the spinner and return
    await safeAnswerCallback(bot, query.id);
    return;
  }

  // -------------------------------------------------------------------------
  // sel:{uuid} — select a restaurant from search results
  // -------------------------------------------------------------------------

  if (data.startsWith('sel:')) {
    const uuid = data.slice(4);
    const state = await getState(redis, chatId);
    const name = state?.searchResults?.[uuid];

    if (name) {
      await setState(redis, chatId, {
        ...state,
        selectedRestaurant: { id: uuid, name },
      });

      await bot.sendMessage(
        chatId,
        `*Restaurante seleccionado:* ${escapeMarkdown(name)}`,
        { parse_mode: 'MarkdownV2' },
      );
    } else {
      // State expired or UUID not in results — graceful fallback
      await bot.sendMessage(
        chatId,
        escapeMarkdown('No se pudo recuperar el restaurante. Intenta la búsqueda de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
    }

    await safeAnswerCallback(bot, query.id);
    return;
  }

  // -------------------------------------------------------------------------
  // create_rest — create the restaurant from the pending search
  // -------------------------------------------------------------------------

  if (data === 'create_rest') {
    const state = await getState(redis, chatId);
    const name = state?.pendingSearch;

    if (!name) {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('No hay búsqueda pendiente. Usa /restaurante <nombre> para buscar.'),
        { parse_mode: 'MarkdownV2' },
      );
      await safeAnswerCallback(bot, query.id);
      return;
    }

    try {
      // Phase 1: Spain-only bot — dynamic countryCode deferred to F037
      const created = await apiClient.createRestaurant({ name, countryCode: 'ES' });

      await setState(redis, chatId, {
        ...state,
        selectedRestaurant: { id: created.id, name: created.name },
      });

      await bot.sendMessage(
        chatId,
        `*Restaurante creado:* ${escapeMarkdown(created.name)}`,
        { parse_mode: 'MarkdownV2' },
      );
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        await bot.sendMessage(
          chatId,
          escapeMarkdown('El restaurante ya existe en la base de datos.'),
          { parse_mode: 'MarkdownV2' },
        );
      } else {
        logger.warn({ err, chatId }, 'createRestaurant error in callback_query');
        const errorText = handleApiError(err);
        await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
      }
    }

    await safeAnswerCallback(bot, query.id);
    return;
  }

  // -------------------------------------------------------------------------
  // Unknown callback_data — silently dismiss spinner
  // -------------------------------------------------------------------------

  await safeAnswerCallback(bot, query.id);
}
