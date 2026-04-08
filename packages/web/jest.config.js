const nextJest = require('next/jest');
const path = require('path');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@foodxplorer/shared$': '<rootDir>/../../shared/src/index.ts',
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
