// Callback query handler for inline keyboard interactions (F032, F031).
//
// Dispatches on query.data:
//   sel:{uuid}      — user selected a restaurant from the search results
//   create_rest     — user wants to create the restaurant they searched for
//   upload_ingest   — upload pending photo to the ingest catalog (F031)
//   upload_menu     — analyze menu from photo (coming soon — F034)
//   upload_dish     — identify dish from photo (coming soon — F034)
//   (anything else) — silently ignored, spinner dismissed
//
// Names are recovered from Redis bot state to avoid the Telegram 64-byte
// callback_data limit. Always calls answerCallbackQuery to dismiss the spinner.

import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { getState, setState } from '../lib/conversationState.js';
import { handleApiError } from '../commands/errorMessages.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';
import { formatUploadSuccess, formatUploadError, UPLOAD_SOURCE_ID, MAX_FILE_SIZE_BYTES, downloadTelegramFile } from './fileUpload.js';

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
 * @param apiClient API client for restaurant creation and file uploads.
 * @param redis     ioredis instance for conversation state.
 * @param config    Bot configuration (required — used for ALLOWED_CHAT_IDS guard in F031 upload branches).
 */
export async function handleCallbackQuery(
  query: TelegramBot.CallbackQuery,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
  config: BotConfig,
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
  // upload_ingest — upload pending photo to the ingest catalog (F031)
  // -------------------------------------------------------------------------

  if (data === 'upload_ingest') {
    await safeAnswerCallback(bot, query.id);

    // End-to-end ALLOWED_CHAT_IDS guard — prevents bypass via stale keyboard
    if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;

    const state = await getState(redis, chatId);

    if (!state?.selectedRestaurant) {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('No hay restaurante seleccionado. Usa /restaurante <nombre> de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    if (!state.pendingPhotoFileId) {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('La foto ha expirado. Envía la foto de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Inform user that processing has started (plain text — no parse_mode)
    await bot.sendMessage(chatId, 'Procesando imagen…');

    // Download the file from Telegram (reuses shared helper from fileUpload.ts)
    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadTelegramFile(bot, state.pendingPhotoFileId);
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_ingest: file download failed');
      await bot.sendMessage(
        chatId,
        escapeMarkdown('Error al descargar el archivo. Inténtalo de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Upload the image to the API.
    // Telegram's `message.photo` type always delivers JPEG-compressed images,
    // so hardcoding image/jpeg is safe. The API also validates via magic bytes.
    try {
      const result = await apiClient.uploadImage({
        fileBuffer,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        restaurantId: state.selectedRestaurant.id,
        sourceId: UPLOAD_SOURCE_ID,
        chainSlug: state.selectedRestaurant.chainSlug,
      });

      // Clear pendingPhotoFileId after successful upload
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined });

      await bot.sendMessage(
        chatId,
        formatUploadSuccess(result, state.selectedRestaurant.name),
        { parse_mode: 'MarkdownV2' },
      );
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_ingest: API upload failed');
      await bot.sendMessage(
        chatId,
        formatUploadError(err),
        { parse_mode: 'MarkdownV2' },
      );
    }

    return;
  }

  // -------------------------------------------------------------------------
  // upload_menu — analyze menu from photo (coming soon — F034)
  // -------------------------------------------------------------------------

  if (data === 'upload_menu') {
    await safeAnswerCallback(bot, query.id);

    // End-to-end ALLOWED_CHAT_IDS guard
    if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;

    await bot.sendMessage(
      chatId,
      escapeMarkdown('Esta función estará disponible próximamente. 🔜'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // -------------------------------------------------------------------------
  // upload_dish — identify dish from photo (coming soon — F034)
  // -------------------------------------------------------------------------

  if (data === 'upload_dish') {
    await safeAnswerCallback(bot, query.id);

    // End-to-end ALLOWED_CHAT_IDS guard
    if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;

    await bot.sendMessage(
      chatId,
      escapeMarkdown('Esta función estará disponible próximamente. 🔜'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Unknown callback_data — silently dismiss spinner
  // -------------------------------------------------------------------------

  await safeAnswerCallback(bot, query.id);
}
