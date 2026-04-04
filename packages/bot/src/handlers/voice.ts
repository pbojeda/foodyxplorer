// Voice message handler for the Telegram bot (F075).
//
// handleVoice: downloads the OGG audio from Telegram's CDN, calls
//   apiClient.sendAudio() to transcribe via Whisper and process through
//   ConversationCore, then formats the response exactly like handleNaturalLanguage.
//
// Bot-side guards (applied before any I/O):
//   - Duration > 120s: immediate error, no download
//   - File size > 10MB: immediate error, no download
//
// Error handling: catches ApiError for specific user-facing messages, falls
//   back to generic message for all other errors. Never re-throws.

import type TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { downloadTelegramFile, MAX_FILE_SIZE_BYTES } from './fileUpload.js';
import { getState } from '../lib/conversationState.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';
import { formatEstimate } from '../formatters/estimateFormatter.js';
import { formatComparison } from '../formatters/comparisonFormatter.js';
import { formatContextConfirmation } from '../formatters/contextFormatter.js';

// Pre-escaped MarkdownV2 string for the >500-char prompt.
const TOO_LONG_MESSAGE =
  'Por favor, sé más específico\\. Escribe el nombre del plato directamente, por ejemplo: _big mac_';

export async function handleVoice(
  msg: TelegramBot.Message,
  bot: TelegramBot,
  apiClient: ApiClient,
  redis: Redis,
  _config: BotConfig,
): Promise<void> {
  const chatId = msg.chat.id;
  const voice = msg.voice;

  // Bot-side guard: duration > 120s
  if ((voice?.duration ?? 0) > 120) {
    await bot.sendMessage(
      chatId,
      escapeMarkdown('Los mensajes de voz deben ser de menos de 2 minutos.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Bot-side guard: file too large
  if ((voice?.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    await bot.sendMessage(
      chatId,
      escapeMarkdown('El archivo de audio es demasiado grande.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Send typing action before download + API call
  await bot.sendChatAction(chatId, 'typing');

  // Download audio from Telegram CDN
  let audioBuffer: Buffer;
  try {
    audioBuffer = await downloadTelegramFile(bot, voice!.file_id);
  } catch {
    await bot.sendMessage(
      chatId,
      escapeMarkdown('Error al descargar el audio. Inténtalo de nuevo.'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  // Read legacy chain context (fail-open, same as naturalLanguage.ts)
  const botState = await getState(redis, chatId).catch(() => null);
  const legacyChainContext = botState?.chainContext;

  try {
    const data = await apiClient.sendAudio({
      audioBuffer,
      filename: 'voice.ogg',
      mimeType: 'audio/ogg',
      duration: voice?.duration ?? 0,
      chatId,
      legacyChainContext,
    });

    // Format response — identical switch as handleNaturalLanguage
    let responseText: string;

    switch (data.intent) {
      case 'estimation': {
        if (!data.estimation) {
          responseText = 'No se encontraron datos nutricionales para esta consulta\\.';
          break;
        }

        responseText = formatEstimate(data.estimation);

        if (data.usedContextFallback && data.activeContext) {
          responseText += `\n_Contexto activo: ${escapeMarkdown(data.activeContext.chainName)}_`;
        }
        break;
      }

      case 'comparison': {
        if (!data.comparison) {
          responseText = 'No se encontraron datos de comparación\\.';
          break;
        }

        responseText = formatComparison(
          data.comparison.dishA,
          data.comparison.dishB,
          data.comparison.nutrientFocus as Parameters<typeof formatComparison>[2],
          {},
        );
        break;
      }

      case 'context_set': {
        if (data.ambiguous) {
          responseText = 'Encontré varias cadenas con ese nombre\\. Por favor, usa el slug exacto \\(por ejemplo: mcdonalds\\-es\\)\\. Usa /cadenas para ver los slugs\\.';
          break;
        }

        if (data.contextSet) {
          responseText = formatContextConfirmation(data.contextSet.chainName, data.contextSet.chainSlug);
          break;
        }

        responseText = 'Contexto procesado\\.';
        break;
      }

      case 'text_too_long':
        responseText = TOO_LONG_MESSAGE;
        break;

      default: {
        const _exhaustive: never = data.intent;
        responseText = escapeMarkdown(`Intent desconocido: ${_exhaustive}`);
        break;
      }
    }

    await bot.sendMessage(chatId, responseText, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'EMPTY_TRANSCRIPTION') {
        await bot.sendMessage(
          chatId,
          escapeMarkdown('No he podido entender el audio. ¿Puedes repetirlo o escribirlo?'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }

      if (err.code === 'TRANSCRIPTION_FAILED') {
        await bot.sendMessage(
          chatId,
          escapeMarkdown('No he podido procesar el audio. Intenta escribir el mensaje.'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }

      if (err.code === 'TIMEOUT') {
        await bot.sendMessage(
          chatId,
          escapeMarkdown('El servidor ha tardado demasiado en procesar el audio. Inténtalo de nuevo.'),
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
    }

    // Generic fallback for all other errors
    await bot.sendMessage(
      chatId,
      escapeMarkdown('Lo siento, ha ocurrido un error al procesar el audio. Inténtalo de nuevo.'),
      { parse_mode: 'MarkdownV2' },
    );
  }
}
