// Environment configuration for the Telegram bot.
//
// All environment variables are validated with Zod at startup. If any required
// variable is missing or malformed, the process exits with a descriptive message.
//
// Usage:
//   import { config } from './config.js';
//   config.BOT_API_KEY  // typed as string
//
// For testing, use the exported `parseConfig(env)` function directly.

import { z } from 'zod';

export const BotEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  API_BASE_URL:       z.string().url().default('http://localhost:3001'),
  BOT_API_KEY:        z.string().min(1),
  BOT_VERSION:        z.string().default('0.1.0'),
  LOG_LEVEL:          z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_API_KEY:      z.string().min(1).optional(),
  REDIS_URL:          z.string().url().default('redis://localhost:6380'),
  /**
   * Comma-separated list of Telegram chat IDs allowed to use file upload features.
   * Empty array (default) means ALL uploads are blocked unless explicitly configured.
   * Example: ALLOWED_CHAT_IDS=123456789,987654321
   */
  ALLOWED_CHAT_IDS:   z.string().optional().transform((val) => {
    if (!val) return [];
    return val.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  }),
});

export type BotConfig = z.infer<typeof BotEnvSchema>;

/**
 * Parse and validate an environment object.
 * On failure, prints a descriptive message and calls process.exit(1).
 *
 * Exported as a named function so tests can call it without mutating
 * process.env or triggering the module-level singleton.
 */
export function parseConfig(env: NodeJS.ProcessEnv): BotConfig {
  const result = BotEnvSchema.safeParse(env);

  if (!result.success) {
    console.error(`[bot:config] Invalid environment:\n${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}

/**
 * Singleton config parsed from process.env at module load time.
 * This is the value imported by all runtime code.
 */
export const config: BotConfig = parseConfig(process.env);
