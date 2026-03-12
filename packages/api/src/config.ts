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
