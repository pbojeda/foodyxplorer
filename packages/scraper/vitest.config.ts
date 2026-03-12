// Vitest configuration for @foodxplorer/scraper
//
// Tests are run sequentially (fileParallelism: false) for consistency.
// Unit tests do not hit the database, but config.ts parses DATABASE_URL at
// module load time so the test runner needs a valid-format URL in env.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      DATABASE_URL_TEST:
        'postgresql://foodxplorer:foodxplorer@localhost:5433/foodxplorer_test',
      LOG_LEVEL: 'info',
      SCRAPER_HEADLESS: 'true',
    },
  },
});
