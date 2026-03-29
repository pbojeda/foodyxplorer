// Callback query handler for inline keyboard interactions (F032, F031, F034).
//
// Dispatches on query.data:
//   sel:{uuid}      — user selected a restaurant from the search results
//   create_rest     — user wants to create the restaurant they searched for
//   upload_ingest   — upload pending photo to the ingest catalog (F031)
//   upload_menu     — analyze menu from photo (F034)
//   upload_dish     — identify dish from photo (F034)
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
import { escapeMarkdown, formatNutrient } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';
import { formatUploadSuccess, formatUploadError, UPLOAD_SOURCE_ID, downloadTelegramFile } from './fileUpload.js';
import type { MenuAnalysisData, MenuAnalysisDish } from '@foodxplorer/shared';

/** Dismiss the Telegram spinner. Never throws — a failed answer is harmless. */
async function safeAnswerCallback(bot: TelegramBot, queryId: string): Promise<void> {
  try {
    await bot.answerCallbackQuery(queryId);
  } catch (err) {
    logger.warn({ err, queryId }, 'answerCallbackQuery failed');
  }
}

// ---------------------------------------------------------------------------
// Menu analysis helpers (F034)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_TTL_SECONDS = 3600;

/**
 * Detect MIME type from buffer magic bytes.
 * Supports JPEG, PNG, WebP, PDF.
 * Returns null for unknown types.
 */
function detectMimeType(buf: Buffer): { mimeType: string; filename: string } | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', filename: 'photo.jpg' };
  }
  // PNG: 89 50 4E 47
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mimeType: 'image/png', filename: 'photo.png' };
  }
  // WebP: RIFF....WEBP at bytes 0-3 and 8-11
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { mimeType: 'image/webp', filename: 'photo.webp' };
  }
  // PDF: %PDF
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { mimeType: 'application/pdf', filename: 'menu.pdf' };
  }
  return null;
}

/**
 * Check per-user rate limit for menu analysis.
 * Counter key: fxp:analyze:bot:<chatId>, TTL 3600s, max 5/hour.
 * Returns true if rate limit is exceeded. Fail-open on Redis error.
 */
async function isRateLimited(redis: Redis, chatId: number): Promise<boolean> {
  try {
    const count = await redis.incr(`fxp:analyze:bot:${chatId}`);
    if (count === 1) {
      // First request in this window — set TTL
      await redis.expire(`fxp:analyze:bot:${chatId}`, RATE_LIMIT_TTL_SECONDS);
    }
    return count > RATE_LIMIT_MAX;
  } catch {
    // Fail-open: Redis error → allow the request
    return false;
  }
}

/**
 * Format a single dish entry for MarkdownV2.
 * Shows top 4 nutrients (calories, proteins, fats, carbohydrates) when estimate is non-null.
 * Shows "(sin datos)" for null estimates.
 */
function formatMenuDish(dish: MenuAnalysisDish): string {
  const name = escapeMarkdown(dish.dishName);
  if (!dish.estimate?.result) {
    return `• *${name}* _\\(sin datos\\)_`;
  }
  const n = dish.estimate.result.nutrients;
  return (
    `• *${name}*\n` +
    `  🔥 ${formatNutrient(n.calories, 'kcal')} · ` +
    `🥩 ${formatNutrient(n.proteins, 'g')} prot · ` +
    `🧈 ${formatNutrient(n.fats, 'g')} grasas · ` +
    `🍞 ${formatNutrient(n.carbohydrates, 'g')} carbs`
  );
}

/**
 * Format the full menu analysis result as MarkdownV2.
 */
function formatMenuAnalysisResult(data: MenuAnalysisData): string {
  const lines: string[] = [
    `*Platos encontrados en el menú: ${escapeMarkdown(String(data.dishCount))}*`,
  ];

  if (data.partial) {
    lines.push('_\\(resultados parciales por timeout\\)_');
  }

  lines.push('');

  for (const dish of data.dishes) {
    lines.push(formatMenuDish(dish));
  }

  return lines.join('\n');
}

/**
 * Format a single dish identification result (identify mode) as MarkdownV2.
 * Shows the full nutrient breakdown for the single dish.
 */
function formatDishIdentifyResult(data: MenuAnalysisData): string {
  const dish = data.dishes[0];
  if (!dish) {
    return escapeMarkdown('No se pudo identificar el plato.');
  }

  const name = escapeMarkdown(dish.dishName);

  if (!dish.estimate?.result) {
    return (
      `*${name}*\n\n` +
      escapeMarkdown('No se encontraron datos nutricionales para este plato.')
    );
  }

  const n = dish.estimate.result.nutrients;
  const lines: string[] = [
    `*${name}*`,
    '',
    `🔥 Calorías: ${formatNutrient(n.calories, 'kcal')}`,
    `🥩 Proteínas: ${formatNutrient(n.proteins, 'g')}`,
    `🍞 Carbohidratos: ${formatNutrient(n.carbohydrates, 'g')}`,
    `🧈 Grasas: ${formatNutrient(n.fats, 'g')}`,
  ];

  if (n.fiber > 0) lines.push(`🌾 Fibra: ${formatNutrient(n.fiber, 'g')}`);
  if (n.saturatedFats > 0) lines.push(`🫙 Grasas saturadas: ${formatNutrient(n.saturatedFats, 'g')}`);
  if (n.sodium > 0) lines.push(`🧂 Sodio: ${formatNutrient(n.sodium, 'mg')}`);
  if (n.salt > 0) lines.push(`🧂 Sal: ${formatNutrient(n.salt, 'g')}`);

  if (dish.estimate.result.portionGrams !== null) {
    lines.push('');
    lines.push(`Porción: ${escapeMarkdown(String(dish.estimate.result.portionGrams))} g`);
  }

  return lines.join('\n');
}

/**
 * Map an ApiError code from the analyze endpoint to a user-friendly Spanish message.
 */
function formatAnalyzeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'MENU_ANALYSIS_FAILED':
        return escapeMarkdown('No se pudieron identificar platos en la imagen. Prueba con una foto más clara del menú.');
      case 'INVALID_IMAGE':
        return escapeMarkdown('El archivo no es una imagen o formato válido. Envía una foto JPEG, PNG, WebP o un PDF.');
      case 'OCR_FAILED':
        return escapeMarkdown('No se pudo extraer texto de la imagen. Asegúrate de que el texto del menú sea legible.');
      case 'VISION_API_UNAVAILABLE':
        return escapeMarkdown('El servicio de análisis de imágenes no está disponible en este momento. Inténtalo más tarde.');
      case 'RATE_LIMIT_EXCEEDED':
        return escapeMarkdown('Has alcanzado el límite de análisis. Inténtalo de nuevo más tarde.');
      default:
        return escapeMarkdown(`Error al analizar la imagen: ${err.message}. Inténtalo de nuevo.`);
    }
  }
  return escapeMarkdown('Error al analizar la imagen. Inténtalo de nuevo.');
}

/**
 * Format a rate limit exceeded message for the bot user.
 */
function formatRateLimitMessage(): string {
  return escapeMarkdown('Has alcanzado el límite de análisis de menú (5 por hora). Inténtalo de nuevo más tarde.');
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
    const entry = state?.searchResults?.[uuid];

    // Backward compat: old-format entries are plain strings (name only).
    const name = typeof entry === 'string' ? entry : entry?.name;
    const chainSlug = typeof entry === 'object' ? entry?.chainSlug : undefined;

    if (name) {
      const selected: { id: string; name: string; chainSlug?: string } = { id: uuid, name };
      if (chainSlug) selected.chainSlug = chainSlug;

      await setState(redis, chatId, {
        ...state,
        selectedRestaurant: selected,
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

      const selected: { id: string; name: string; chainSlug?: string } = { id: created.id, name: created.name };
      if (created.chainSlug) selected.chainSlug = created.chainSlug;

      await setState(redis, chatId, {
        ...state,
        selectedRestaurant: selected,
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
  // upload_menu — analyze menu from photo (F034)
  // -------------------------------------------------------------------------

  if (data === 'upload_menu') {
    await safeAnswerCallback(bot, query.id);

    // End-to-end ALLOWED_CHAT_IDS guard
    if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;

    const state = await getState(redis, chatId);

    if (!state?.pendingPhotoFileId) {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('La foto ha expirado. Envía la foto de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Per-user rate limit check (BEFORE download to avoid bandwidth waste)
    const limited = await isRateLimited(redis, chatId);
    if (limited) {
      await bot.sendMessage(chatId, formatRateLimitMessage(), { parse_mode: 'MarkdownV2' });
      return;
    }

    // Download the file from Telegram
    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadTelegramFile(bot, state.pendingPhotoFileId);
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_menu: file download failed');
      await bot.sendMessage(
        chatId,
        escapeMarkdown('Error al descargar el archivo. Inténtalo de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Detect MIME from magic bytes
    const detected = detectMimeType(fileBuffer);
    const { mimeType, filename } = detected ?? { mimeType: 'image/jpeg', filename: 'photo.jpg' };

    // Inform user that processing has started
    await bot.sendMessage(chatId, 'Analizando menú…');

    // Call the analyze endpoint and clear pendingPhotoFileId
    try {
      const result = await apiClient.analyzeMenu({ fileBuffer, filename, mimeType, mode: 'auto' });

      // Clear pendingPhotoFileId after API attempt
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined });

      await bot.sendMessage(chatId, formatMenuAnalysisResult(result), { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_menu: analyzeMenu failed');

      // Clear pendingPhotoFileId on API-attempt path (even on failure)
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined });

      await bot.sendMessage(chatId, formatAnalyzeError(err), { parse_mode: 'MarkdownV2' });
    }

    return;
  }

  // -------------------------------------------------------------------------
  // upload_dish — identify dish from photo (F034)
  // -------------------------------------------------------------------------

  if (data === 'upload_dish') {
    await safeAnswerCallback(bot, query.id);

    // End-to-end ALLOWED_CHAT_IDS guard
    if (!config.ALLOWED_CHAT_IDS.includes(chatId)) return;

    const state = await getState(redis, chatId);

    if (!state?.pendingPhotoFileId) {
      await bot.sendMessage(
        chatId,
        escapeMarkdown('La foto ha expirado. Envía la foto de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Per-user rate limit check (BEFORE download to avoid bandwidth waste)
    const limited = await isRateLimited(redis, chatId);
    if (limited) {
      await bot.sendMessage(chatId, formatRateLimitMessage(), { parse_mode: 'MarkdownV2' });
      return;
    }

    // Download the file from Telegram
    let fileBuffer: Buffer;
    try {
      fileBuffer = await downloadTelegramFile(bot, state.pendingPhotoFileId);
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_dish: file download failed');
      await bot.sendMessage(
        chatId,
        escapeMarkdown('Error al descargar el archivo. Inténtalo de nuevo.'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Detect MIME from magic bytes
    const detected = detectMimeType(fileBuffer);
    const { mimeType, filename } = detected ?? { mimeType: 'image/jpeg', filename: 'photo.jpg' };

    // Inform user that processing has started
    await bot.sendMessage(chatId, 'Identificando plato…');

    // Call the analyze endpoint (identify mode) and clear pendingPhotoFileId
    try {
      const result = await apiClient.analyzeMenu({ fileBuffer, filename, mimeType, mode: 'identify' });

      // Clear pendingPhotoFileId after API attempt
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined });

      await bot.sendMessage(chatId, formatDishIdentifyResult(result), { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.warn({ err, chatId }, 'upload_dish: analyzeMenu failed');

      // Clear pendingPhotoFileId on API-attempt path (even on failure)
      await setState(redis, chatId, { ...state, pendingPhotoFileId: undefined });

      await bot.sendMessage(chatId, formatAnalyzeError(err), { parse_mode: 'MarkdownV2' });
    }

    return;
  }

  // -------------------------------------------------------------------------
  // Unknown callback_data — silently dismiss spinner
  // -------------------------------------------------------------------------

  await safeAnswerCallback(bot, query.id);
}
