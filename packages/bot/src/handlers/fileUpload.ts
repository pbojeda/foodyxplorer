// File upload handlers for Telegram bot (F031).
//
// Handles two Telegram message types:
//   - bot.on('photo')    → handlePhoto: shows inline keyboard for intent selection
//   - bot.on('document') → handleDocument: processes PDF or image files directly
//
// Access is restricted to ALLOWED_CHAT_IDS from config. Unlisted chat IDs
// receive no response (silent ignore — prevents information leakage).
//
// The Telegram bot token NEVER leaves this process. Files are downloaded to
// an in-process Buffer and forwarded to the API as multipart.

import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import { ApiError } from '../apiClient.js';
import type { ApiClient, IngestImageResult } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { getState, setState } from '../lib/conversationState.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UPLOAD_SOURCE_ID = '00000000-0000-0000-0000-000000000099';
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Download a file from Telegram's CDN via its file_id.
 * Calls bot.getFileLink() to resolve the HTTPS URL, then fetches the content.
 * Checks response.ok (rejects non-2xx) and validates post-download buffer size.
 * Throws on any error — callers wrap in try/catch.
 */
export async function downloadTelegramFile(bot: TelegramBot, fileId: string): Promise<Buffer> {
  const url = await bot.getFileLink(fileId);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Downloaded file exceeds size limit: ${buffer.length} bytes`);
  }

  return buffer;
}

/**
 * Build the MarkdownV2 success summary message for a completed upload.
 * All interpolated values are escaped with escapeMarkdown.
 */
export function formatUploadSuccess(result: IngestImageResult, restaurantName: string): string {
  return (
    `*✅ Ingesta completada*\n` +
    `Restaurante: ${escapeMarkdown(restaurantName)}\n` +
    `Platos encontrados: ${escapeMarkdown(String(result.dishesFound))}\n` +
    `Platos guardados: ${escapeMarkdown(String(result.dishesUpserted))}\n` +
    `Platos omitidos: ${escapeMarkdown(String(result.dishesSkipped))}`
  );
}

/**
 * Format an upload error into a user-facing MarkdownV2 string.
 * Handles CONFIG_ERROR and NO_NUTRITIONAL_DATA_FOUND specially;
 * falls back to a generic error message for all other errors.
 */
export function formatUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CONFIG_ERROR') {
      return escapeMarkdown('El bot no está configurado para subir archivos. Contacta al administrador.');
    }
    if (err.code === 'NO_NUTRITIONAL_DATA_FOUND') {
      return escapeMarkdown(
        'No se encontraron datos nutricionales en la imagen. Asegúrate de que la foto muestra una tabla nutricional legible.',
      );
    }
    return escapeMarkdown(`Error al procesar el archivo: ${err.message}. Inténtalo de nuevo.`);
  }
  return escapeMarkdown('Error al procesar el archivo. Inténtalo de nuevo.');
}

// ---------------------------------------------------------------------------
// handlePhoto
// ---------------------------------------------------------------------------

/**
 * Handle a Telegram photo message.
 *
 * Shows an inline keyboard with three options so the user can choose what
 * to do with the photo. The file is not downloaded at this point — the
 * fileId is stored in Redis and retrieved when the user presses a button.
 */
export async function handlePhoto(
  msg: TelegramBot.Message,
  bot: TelegramBot,
  _apiClient: ApiClient,
  redis: Redis,
  config: BotConfig,
): Promise<void> {
  // Guard: ALLOWED_CHAT_IDS must contain this chat ID
  if (!config.ALLOWED_CHAT_IDS.includes(msg.chat.id)) return;

  // Guard: message must have a photo array
  if (!msg.photo) return;

  const state = await getState(redis, msg.chat.id);

  // Guard: a restaurant must be selected
  if (!state?.selectedRestaurant) {
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('Primero selecciona un restaurante con /restaurante <nombre>.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Select the highest-resolution photo (last in array — Telegram sorts ascending)
  // Non-null assertion: msg.photo is guaranteed non-undefined here (guarded above)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const photos = msg.photo!;
  // Select highest-res photo (last entry — Telegram sorts ascending by size)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const photo = photos[photos.length - 1]!;

  // Pre-check file size from Telegram metadata
  if ((photo.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('El archivo supera el límite de 10 MB.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Store the fileId in Redis state — callback handler retrieves it
  await setState(redis, msg.chat.id, { ...state, pendingPhotoFileId: photo.file_id });

  // Send inline keyboard for intent selection
  await bot.sendMessage(
    msg.chat.id,
    '¿Qué quieres hacer con esta foto?',
    {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📖 Subir al catálogo', callback_data: 'upload_ingest' }],
          [{ text: '🧮 Analizar menú', callback_data: 'upload_menu' }],
          [{ text: '🍽️ Identificar plato', callback_data: 'upload_dish' }],
        ],
      },
    },
  );
}

// ---------------------------------------------------------------------------
// handleDocument
// ---------------------------------------------------------------------------

/**
 * Handle a Telegram document message (PDFs and images sent "as file").
 *
 * Accepted MIME types: application/pdf, image/jpeg, image/png.
 * PDFs are sent to POST /ingest/pdf; images are sent to POST /ingest/image.
 * No inline keyboard is shown — intent is unambiguous for documents.
 */
export async function handleDocument(
  msg: TelegramBot.Message,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
  config: BotConfig,
): Promise<void> {
  // Guard: ALLOWED_CHAT_IDS must contain this chat ID
  if (!config.ALLOWED_CHAT_IDS.includes(msg.chat.id)) return;

  // Guard: message must have a document
  if (!msg.document) return;

  const mime = msg.document.mime_type ?? '';
  const isPdf = mime === 'application/pdf';
  const isImage = mime === 'image/jpeg' || mime === 'image/png';

  // Guard: only PDF and image MIME types are supported
  if (!isPdf && !isImage) {
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('Solo se admiten archivos PDF o imágenes (JPEG/PNG).'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const state = await getState(redis, msg.chat.id);

  // Guard: a restaurant must be selected
  if (!state?.selectedRestaurant) {
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('Primero selecciona un restaurante con /restaurante <nombre>.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Pre-check file size from Telegram metadata
  if ((msg.document.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('El archivo supera el límite de 10 MB.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Inform user that processing has started (plain text — no parse_mode)
  await bot.sendMessage(msg.chat.id, 'Procesando documento…');

  // Download the file from Telegram
  let fileBuffer: Buffer;
  try {
    fileBuffer = await downloadTelegramFile(bot, msg.document.file_id);
  } catch (err) {
    logger.warn({ err, chatId: msg.chat.id }, 'Document download failed');
    await bot.sendMessage(
      msg.chat.id,
      escapeMarkdown('Error al descargar el archivo. Inténtalo de nuevo.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const { id: restaurantId, name: restaurantName, chainSlug } = state.selectedRestaurant;

  try {
    let result;

    if (isPdf) {
      const filename = msg.document.file_name ?? 'document.pdf';
      result = await apiClient.uploadPdf({
        fileBuffer,
        filename,
        restaurantId,
        sourceId: UPLOAD_SOURCE_ID,
        chainSlug,
      });
    } else {
      // Image (JPEG or PNG) sent as file
      const filename = msg.document.file_name ?? 'image.jpg';
      result = await apiClient.uploadImage({
        fileBuffer,
        filename,
        mimeType: mime,
        restaurantId,
        sourceId: UPLOAD_SOURCE_ID,
        chainSlug,
      });
    }

    await bot.sendMessage(
      msg.chat.id,
      formatUploadSuccess(result, restaurantName),
      { parse_mode: 'MarkdownV2' },
    );
  } catch (err) {
    logger.warn({ err, chatId: msg.chat.id }, 'Document upload failed');
    await bot.sendMessage(
      msg.chat.id,
      formatUploadError(err),
      { parse_mode: 'MarkdownV2' },
    );
  }
}
