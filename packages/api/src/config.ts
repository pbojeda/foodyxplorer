// Environment configuration for the API server.
//
// All environment variables are validated with Zod at startup. If any required
// variable is missing or malformed, the process exits with a descriptive message.
//
// Usage:
//   import { config } from './config.js';
//   config.PORT  // typed as number
//
// For testing, use the exported `parseConfig(env)` function directly.

import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),
  // OpenAI — optional at startup; validated at invocation time in the pipeline
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  OPENAI_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(100),
  OPENAI_EMBEDDING_RPM: z.coerce.number().int().min(1).default(3000),
  // Chat completions — used by Level 4 LLM Integration Layer (F024)
  // No default for OPENAI_CHAT_MODEL — L4 is only active when explicitly configured by operators.
  OPENAI_CHAT_MODEL: z.string().min(1).optional(),
  OPENAI_CHAT_MAX_TOKENS: z.coerce.number().int().min(1).max(4096).default(512),
  // Auth — F026
  // Required in production (validated at route level, not startup).
  // Optional in test/dev — when absent, admin auth hook is skipped.
  // Min 32 chars to prevent weak secrets.
  ADMIN_API_KEY: z.string().min(32).optional(),
  // Optional. When set, the seed script uses this as the deterministic seed
  // for the bot API key (HMAC-SHA256 of seed → 32-char hex key).
  BOT_API_KEY_SEED: z.string().min(1).optional(),
  // Optional. When set, the analyze route skips the 10/hour rate limit for
  // requests matching this API key ID (the bot key is a single shared key
  // across all Telegram users, so per-key limits would throttle all users).
  BOT_KEY_ID: z.string().uuid().optional(),
  // Voice budget Slack alerts (F091 AC26).
  // When set, the API fires a webhook when monthly voice spend crosses
  // 40/70/90/100 EUR thresholds. Optional — no alerts when absent.
  SLACK_WEBHOOK_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

/**
 * Parse and validate an environment object.
 * On failure, prints a descriptive message and calls process.exit(1).
 *
 * Exported as a named function so tests can call it without mutating
 * process.env or triggering the module-level singleton.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    console.error(`[config] Invalid environment:\n${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}

/**
 * Singleton config parsed from process.env at module load time.
 * This is the value imported by all runtime code.
 */
export const config: Config = parseConfig(process.env);
