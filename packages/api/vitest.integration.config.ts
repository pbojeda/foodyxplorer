// Vitest configuration for integration tests that require a live PostgreSQL database.
//
// Run with: npx vitest run -c vitest.integration.config.ts
//
// Requires DATABASE_URL_TEST pointing to a migrated test database.

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
    fileParallelism: false,
    include: [
      'src/__tests__/migration.*.test.ts',
      'src/__tests__/*.integration.test.ts',
      'src/__tests__/routes/ingest/**/*.test.ts',
      'src/__tests__/routes/quality.test.ts',
    ],
    exclude: ['node_modules/**'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      DATABASE_URL_TEST:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      PORT: '3001',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://localhost:6380',
    },
  },
});
