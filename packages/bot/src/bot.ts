// Telegram bot wiring — registers all command handlers.
//
// buildBot(config, apiClient) is the factory function. It creates a
// TelegramBot instance with polling: false and wires all eight command
// handlers plus the unknown-command catch-all.
//
// Polling is started externally via bot.startPolling() in index.ts,
// keeping buildBot side-effect-free for unit tests.

import TelegramBot from 'node-telegram-bot-api';
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

const KNOWN_COMMANDS = new Set([
  'start', 'help', 'buscar', 'estimar', 'restaurantes', 'platos', 'cadenas', 'info',
]);

export function buildBot(config: BotConfig, apiClient: ApiClient): TelegramBot {
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
      logger.error({ err }, 'Unhandled command error');
      await send(msg.chat.id, escapeMarkdown('Lo siento, ha ocurrido un error inesperado.'));
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
    (msg, match) => wrapHandler(() => handleEstimar(match?.[1] ?? '', apiClient))(msg),
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
      const cmd = cmdMatch[1] ?? '';
      if (!KNOWN_COMMANDS.has(cmd)) {
        void send(
          msg.chat.id,
          escapeMarkdown('Comando no reconocido. Usa /help para ver los comandos disponibles.'),
        );
      }
    }
  });

  return bot;
}
