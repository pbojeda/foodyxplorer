// Vitest configuration for @foodxplorer/bot
//
// No database or integration tests — all tests are unit-level with mocked
// dependencies. fileParallelism can stay at default (true).
//
// test.env provides the six BotEnvSchema defaults so that config.ts does not
// call process.exit when it is imported as a module-level side-effect during tests.

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@foodxplorer/shared': resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    env: {
      TELEGRAM_BOT_TOKEN: 'test-token',
      API_BASE_URL: 'http://localhost:3001',
      BOT_API_KEY: 'test-bot-api-key',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      BOT_VERSION: '0.0.0',
    },
  },
});
