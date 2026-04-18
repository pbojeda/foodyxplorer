// Vitest configuration for integration tests (*.integration.test.ts).
//
// These tests require a real PostgreSQL test DB and are excluded from the
// default vitest.config.ts run to avoid accidental DB access in CI unit runs.
//
// Run with:
//   npx vitest run --config vitest.config.integration.ts
// Or a specific file:
//   npx vitest run --config vitest.config.integration.ts src/__tests__/f-ux-b.postMigration.integration.test.ts

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
    include: ['src/__tests__/*.integration.test.ts'],
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
