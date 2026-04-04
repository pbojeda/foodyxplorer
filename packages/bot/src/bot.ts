// Telegram bot wiring — registers all command handlers.
//
// buildBot(config, apiClient, redis) is the factory function. It creates a
// TelegramBot instance with polling: false and wires nine command handlers
// plus the unknown-command catch-all and the callback_query handler.
//
// Polling is started externally via bot.startPolling() in index.ts,
// keeping buildBot side-effect-free for unit tests.

import TelegramBot from 'node-telegram-bot-api';
import type { Redis } from 'ioredis';
import type { ApiClient } from './apiClient.js';
import type { BotConfig } from './config.js';
import { logger } from './logger.js';
import { escapeMarkdown } from './formatters/markdownUtils.js';
import { handleStart } from './commands/start.js';
import { handleBuscar } from './commands/buscar.js';
import { handleEstimar } from './commands/estimar.js';
import { handleRestaurantes } from './commands/restaurantes.js';
import { handlePlatos } from './commands/platos.js';
import { handleCadenas } from './commands/cadenas.js';
import { handleInfo } from './commands/info.js';
import { handleRestaurante } from './commands/restaurante.js';
import { handleReceta } from './commands/receta.js';
import { handleComparar } from './commands/comparar.js';
import { handleContexto } from './commands/contexto.js';
import { handleNaturalLanguage } from './handlers/naturalLanguage.js';
import { handleCallbackQuery } from './handlers/callbackQuery.js';
import { handlePhoto, handleDocument } from './handlers/fileUpload.js';
import { handleVoice } from './handlers/voice.js';

const KNOWN_COMMANDS = new Set([
  'start', 'help', 'buscar', 'estimar', 'restaurantes', 'platos', 'cadenas', 'info', 'restaurante', 'receta', 'comparar', 'contexto',
]);

export function buildBot(config: BotConfig, apiClient: ApiClient, redis: Redis): TelegramBot {
  const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

  /** Send a MarkdownV2-formatted message to a chat. */
  const send = async (chatId: number, text: string): Promise<void> => {
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  };

  /**
   * Wrap a command handler so that unhandled errors produce a generic
   * error message instead of crashing the bot process.
   */
  const wrapHandler = (
    handler: () => Promise<string>,
  ) => async (msg: TelegramBot.Message): Promise<void> => {
    try {
      const text = await handler();
      await send(msg.chat.id, text);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled command error');
      try {
        await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
      } catch (sendErr) {
        logger.error({ sendErr, chatId: msg.chat.id }, 'Failed to send error message');
      }
    }
  };

  // -------------------------------------------------------------------------
  // Command handlers
  // Regex patterns: anchored ^ and $, optional @botname, optional args.
  // Commands with optional args use (?:\s+(.+))? so /cmd alone still fires.
  // -------------------------------------------------------------------------

  bot.onText(/^\/start(?:@\w+)?$/, wrapHandler(() => Promise.resolve(handleStart())));

  bot.onText(/^\/help(?:@\w+)?$/, wrapHandler(() => Promise.resolve(handleStart())));

  bot.onText(
    /^\/buscar(?:@\w+)?(?:\s+(.+))?$/,
    (msg, match) => wrapHandler(() => handleBuscar(match?.[1] ?? '', apiClient))(msg),
  );

  bot.onText(
    /^\/estimar(?:@\w+)?(?:\s+(.+))?$/,
    (msg, match) => wrapHandler(() => handleEstimar(match?.[1] ?? '', msg.chat.id, redis, apiClient))(msg),
  );

  bot.onText(
    /^\/restaurantes(?:@\w+)?(?:\s+(.+))?$/,
    (msg, match) => wrapHandler(() => handleRestaurantes(match?.[1] ?? '', apiClient))(msg),
  );

  bot.onText(
    /^\/platos(?:@\w+)?(?:\s+(.+))?$/,
    (msg, match) => wrapHandler(() => handlePlatos(match?.[1] ?? '', apiClient))(msg),
  );

  bot.onText(/^\/cadenas(?:@\w+)?$/, wrapHandler(() => handleCadenas(apiClient)));

  bot.onText(/^\/info(?:@\w+)?$/, wrapHandler(() => handleInfo(config, apiClient)));

  // /restaurante is wired directly (not through wrapHandler) because it needs
  // to send inline keyboards via reply_markup — wrapHandler only supports
  // text-only Promise<string> returns.
  bot.onText(
    /^\/restaurante(?:@\w+)?(?:\s+(.+))?$/,
    async (msg, match) => {
      try {
        await handleRestaurante(match?.[1] ?? '', msg.chat.id, bot, apiClient, redis);
      } catch (err) {
        logger.error({ err, chatId: msg.chat.id }, 'Unhandled /restaurante error');
        try {
          await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
        } catch {
          // ignore send failure
        }
      }
    },
  );

  // /receta is wired directly (not through wrapHandler) because it needs
  // chatId and redis for per-user rate limiting — same pattern as /restaurante.
  bot.onText(
    /^\/receta(?:@\w+)?(?:\s+(.+))?$/s,
    async (msg, match) => {
      try {
        const text = await handleReceta(match?.[1] ?? '', msg.chat.id, apiClient, redis);
        await send(msg.chat.id, text);
      } catch (err) {
        logger.error({ err, chatId: msg.chat.id }, 'Unhandled /receta error');
        try {
          await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
        } catch {
          // ignore send failure
        }
      }
    },
  );

  // /contexto is wired directly because it needs chatId and redis.
  bot.onText(
    /^\/contexto(?:@\w+)?(?:\s+(.+))?$/,
    async (msg, match) => {
      try {
        const text = await handleContexto(match?.[1] ?? '', msg.chat.id, redis, apiClient);
        await send(msg.chat.id, text);
      } catch (err) {
        logger.error({ err, chatId: msg.chat.id }, 'Unhandled /contexto error');
        try {
          await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
        } catch {
          // ignore send failure
        }
      }
    },
  );

  bot.onText(
    /^\/comparar(?:@\w+)?(?:\s+(.+))?$/s,
    (msg, match) => wrapHandler(() => handleComparar(match?.[1] ?? '', msg.chat.id, redis, apiClient))(msg),
  );

  // -------------------------------------------------------------------------
  // Callback query handler (inline keyboard interactions)
  // -------------------------------------------------------------------------

  bot.on('callback_query', async (query) => {
    try {
      await handleCallbackQuery(query, bot, apiClient, redis, config);
    } catch (err) {
      logger.error({ err }, 'Unhandled callback_query error');
    }
  });

  bot.on('photo', async (msg) => {
    try {
      await handlePhoto(msg, bot, apiClient, redis, config);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled photo handler error');
    }
  });

  bot.on('document', async (msg) => {
    try {
      await handleDocument(msg, bot, apiClient, redis, config);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled document handler error');
    }
  });

  bot.on('voice', async (msg) => {
    try {
      await handleVoice(msg, bot, apiClient, redis, config);
    } catch (err) {
      logger.error({ err, chatId: msg.chat.id }, 'Unhandled voice handler error');
    }
  });

  // -------------------------------------------------------------------------
  // Polling error handler
  // -------------------------------------------------------------------------

  bot.on('polling_error', (err) => {
    logger.warn({ err }, 'Telegram polling error');
  });

  // -------------------------------------------------------------------------
  // Unknown command catch-all
  //
  // Using 'message' event rather than onText catch-all prevents double-fire:
  // if a catch-all onText regex matched alongside a specific handler, the user
  // would receive two messages.
  // -------------------------------------------------------------------------

  bot.on('message', (msg) => {
    const text = msg.text ?? '';
    const cmdMatch = /^\/(\w+)/.exec(text);

    if (cmdMatch) {
      // Unknown slash command
      const cmd = cmdMatch[1] ?? '';
      if (!KNOWN_COMMANDS.has(cmd)) {
        void send(
          msg.chat.id,
          escapeMarkdown('Comando no reconocido. Usa /help para ver los comandos disponibles.'),
        );
      }
      return;
    }

    // Plain text (no slash prefix) — route to NL handler
    const trimmed = text.trim();
    if (trimmed) {
      void wrapHandler(() => handleNaturalLanguage(trimmed, msg.chat.id, redis, apiClient))(msg);
    }
    // Empty text or media (no msg.text) → silently ignore
  });

  return bot;
}
