// @foodxplorer/bot — Telegram bot entry point
//
// Wires config → logger → apiClient → redis → bot → starts polling.
// Graceful shutdown on SIGTERM/SIGINT: stops polling, disconnects Redis,
// flushes logs, exits 0.

import { parseConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApiClient } from './apiClient.js';
import { buildBot } from './bot.js';
import { botRedis, connectBotRedis, disconnectBotRedis } from './lib/botRedis.js';

const config = parseConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
const apiClient = createApiClient(config);

void (async () => {
  await connectBotRedis();

  const bot = buildBot(config, apiClient, botRedis);

  bot.startPolling();
  logger.info({ version: config.BOT_VERSION }, 'Bot started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await bot.stopPolling();
    await disconnectBotRedis();
    // Flush Pino transport buffers before exit to avoid lost log lines.
    // pino-pretty runs in a worker thread; flushSync drains the queue.
    const pinoStreamKey = Symbol.for('pino.stream');
    const loggerWithStream = logger as unknown as Record<symbol, { flushSync?: () => void } | undefined>;
    const stream = loggerWithStream[pinoStreamKey];
    if (stream?.flushSync) stream.flushSync();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
})();
