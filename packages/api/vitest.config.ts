// Vitest configuration for @foodxplorer/api
//
// Tests are run sequentially (fileParallelism: false) because the integration
// tests share a single PostgreSQL test database. Running test files in parallel
// causes race conditions: the afterAll teardown in one file can truncate data
// created by the beforeAll in another file.
//
// env: Provides baseline environment variables needed at module-load time.
// config.ts parses process.env when imported; these defaults ensure that
// importing config.ts (via app.ts) does not exit in the test environment.
// Integration tests that need different URLs override them in the test file.

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
