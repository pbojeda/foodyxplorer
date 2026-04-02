// Vitest configuration for E2E smoke tests (F066).
//
// Uses NODE_ENV=development (NOT test) so that CORS and rate-limit plugins
// register — these are no-ops when NODE_ENV=test.
//
// Runs against the same test DB and Redis as unit tests, but starts a real
// HTTP server (app.listen) instead of using app.inject().

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@foodxplorer/shared': resolve(__dirname, '../shared/src'),
      '@foodxplorer/scraper': resolve(__dirname, '../scraper/src'),
    },
  },
  test: {
    include: ['src/__tests__/e2e/**/*.e2e.test.ts'],
    env: {
      NODE_ENV: 'development',
      DATABASE_URL:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      DATABASE_URL_TEST:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      PORT: '3099',
      LOG_LEVEL: 'error',
      REDIS_URL: 'redis://localhost:6380',
      ADMIN_API_KEY: 'test-admin-key-for-e2e-smoke-00001',
    },
  },
});
