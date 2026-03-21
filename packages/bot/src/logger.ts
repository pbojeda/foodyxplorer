// Pino structured logger for @foodxplorer/bot.
//
// createLogger(level) is the factory used directly in tests and index.ts.
// The module-level `logger` singleton is initialized from the config singleton.

import pino from 'pino';
import { config } from './config.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Create a Pino logger instance.
 *
 * In 'development' or 'test' NODE_ENV the pino-pretty transport is used for
 * human-readable output. In production, plain JSON (default Pino output).
 */
export function createLogger(
  level: LogLevel,
  nodeEnv: string = process.env['NODE_ENV'] ?? 'development',
): pino.Logger {
  const usePretty = nodeEnv === 'development' || nodeEnv === 'test';

  if (usePretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  }

  return pino({ level });
}

/**
 * Module-level singleton logger.
 * Created from the config singleton at module load time.
 */
export const logger: pino.Logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
