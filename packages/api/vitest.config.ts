// Vitest configuration for @foodxplorer/api
//
// Tests are run sequentially (fileParallelism: false) because the integration
// tests share a single PostgreSQL test database. Running test files in parallel
// causes race conditions: the afterAll teardown in one file can truncate data
// created by the beforeAll in another file.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
