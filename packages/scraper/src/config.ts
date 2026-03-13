// Environment configuration for the scraper process.
//
// All environment variables are validated with Zod at startup. If any required
// variable is missing or malformed, the process exits with a descriptive message.
//
// Note: ScraperEnvSchema (process env) is distinct from ScraperConfigSchema
// (per-chain crawler settings defined in base/types.ts).
//
// Usage:
//   import { config } from './config.js';
//   config.DATABASE_URL  // typed as string

import { z } from 'zod';

export const ScraperEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  SCRAPER_HEADLESS: z.coerce.boolean().default(true),
  SCRAPER_CHAIN: z.string().optional(),
  // Chain-specific env vars — optional at env-schema level; required at runtime
  // when the scraper actually runs (enforced in chain config via non-null assertion).
  MCDONALDS_ES_RESTAURANT_ID: z.string().uuid().optional(),
  MCDONALDS_ES_SOURCE_ID: z.string().uuid().optional(),
});

export type Config = z.infer<typeof ScraperEnvSchema>;

/**
 * Parse and validate an environment object.
 * On failure, prints a descriptive message and calls process.exit(1).
 *
 * Exported as a named function so tests can call it without mutating
 * process.env or triggering the module-level singleton.
 */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = ScraperEnvSchema.safeParse(env);

  if (!result.success) {
    console.error(
      `[scraper:config] Invalid environment:\n${result.error.message}`,
    );
    process.exit(1);
  }

  return result.data;
}

/**
 * Singleton config parsed from process.env at module load time.
 * This is the value imported by all runtime code.
 */
export const config: Config = parseConfig(process.env);
