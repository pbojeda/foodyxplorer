// Unit tests for config.ts — EnvSchema and parseConfig
//
// Tests the parseConfig(env) named export without mutating process.env.
// process.exit is mocked to prevent actual process termination.
//
// vitest.config.ts sets DATABASE_URL and NODE_ENV for the test environment,
// so the module-level singleton (parseConfig(process.env)) succeeds on import.
// The spy is installed before the dynamic import as a safety net.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Install spy before importing config (spy covers module-level singleton call)
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
  throw new Error('process.exit called');
});

// Dynamic import after spy is set up
const { parseConfig } = await import('../config.js');

const VALID_ENV = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
  LOG_LEVEL: 'info',
} satisfies NodeJS.ProcessEnv;

describe('parseConfig', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('parses a valid complete env object', () => {
    const config = parseConfig({ ...VALID_ENV });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/mydb');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string to number', () => {
    const config = parseConfig({ ...VALID_ENV, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('defaults PORT to 3001 when absent', () => {
    const { PORT: _omit, ...rest } = VALID_ENV;
    const config = parseConfig(rest);
    expect(config.PORT).toBe(3001);
  });

  it('defaults NODE_ENV to "development" when absent', () => {
    const { NODE_ENV: _omit, ...rest } = VALID_ENV;
    const config = parseConfig(rest);
    expect(config.NODE_ENV).toBe('development');
  });

  it('defaults LOG_LEVEL to "info" when absent', () => {
    const { LOG_LEVEL: _omit, ...rest } = VALID_ENV;
    const config = parseConfig(rest);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('accepts "test" as a valid NODE_ENV', () => {
    const config = parseConfig({ ...VALID_ENV, NODE_ENV: 'test' });
    expect(config.NODE_ENV).toBe('test');
  });

  it('accepts "production" as a valid NODE_ENV', () => {
    const config = parseConfig({ ...VALID_ENV, NODE_ENV: 'production' });
    expect(config.NODE_ENV).toBe('production');
  });

  it('accepts all valid LOG_LEVEL values', () => {
    const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
    for (const level of levels) {
      const config = parseConfig({ ...VALID_ENV, LOG_LEVEL: level });
      expect(config.LOG_LEVEL).toBe(level);
    }
  });

  it('calls process.exit(1) when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_ENV;

    expect(() => parseConfig(rest)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when PORT cannot be coerced to a number', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: 'abc' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when PORT is below minimum (0)', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '0' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when PORT exceeds maximum (65536)', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '65536' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts DATABASE_URL_TEST as an optional field', () => {
    const config = parseConfig({
      ...VALID_ENV,
      DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5432/testdb',
    });
    expect(config.DATABASE_URL_TEST).toBe('postgresql://user:pass@localhost:5432/testdb');
  });

  it('allows DATABASE_URL_TEST to be absent', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.DATABASE_URL_TEST).toBeUndefined();
  });
});
