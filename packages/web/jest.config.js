const nextJest = require('next/jest');
const path = require('path');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Strip `.js` extension from relative imports — shared package uses .js in
    // its source for ESM compliance with Node16, but Jest with moduleResolution
    // "bundler" must map them back to the actual .ts source files at test time.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@foodxplorer/shared$': path.resolve(__dirname, '../shared/src/index.ts'),
  },
  // Ensure Jest resolves from web's node_modules first (avoids workspace hoisting issues)
  moduleDirectories: ['node_modules', path.resolve(__dirname, 'node_modules')],
  testMatch: [
    '**/__tests__/**/*.test.{ts,tsx}',
    '**/*.test.{ts,tsx}',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/layout.tsx',
  ],
};

module.exports = createJestConfig(customJestConfig);
