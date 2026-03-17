// Unit tests for config.ts — EnvSchema and parseConfig
//
// Tests the parseConfig(env) named export without mutating process.env.
// process.exit is mocked to prevent actual process termination.
//
// vitest.config.ts provides DATABASE_URL and NODE_ENV so the module-level
// singleton (parseConfig(process.env)) does not exit when config.ts is imported.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Config } from '../config.js';

// process.exit spy — installed before config is imported so it covers the
// module-level singleton call in config.ts (line: export const config = parseConfig(process.env))
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
  (_code?: string | number | null | undefined): never => {
    throw new Error('process.exit called');
  },
);

// parseConfig is loaded via beforeAll to give the spy time to set up first.
// (Cannot use top-level await in CommonJS modules per tsconfig module:Node16)
let parseConfig: (env: NodeJS.ProcessEnv) => Config;

beforeAll(async () => {
  const mod = await import('../config.js');
  parseConfig = mod.parseConfig;
});

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

  it('defaults REDIS_URL to "redis://localhost:6380" when absent', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.REDIS_URL).toBe('redis://localhost:6380');
  });

  it('accepts any non-empty string for REDIS_URL', () => {
    const config = parseConfig({ ...VALID_ENV, REDIS_URL: 'redis://my-redis:6379' });
    expect(config.REDIS_URL).toBe('redis://my-redis:6379');
  });

  it('calls process.exit(1) when REDIS_URL is an empty string', () => {
    expect(() => parseConfig({ ...VALID_ENV, REDIS_URL: '' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('OpenAI config vars', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('parses successfully when OPENAI_API_KEY is absent (must not fail startup)', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it('accepts OPENAI_API_KEY when provided', () => {
    const config = parseConfig({ ...VALID_ENV, OPENAI_API_KEY: 'sk-test-key' });
    expect(config.OPENAI_API_KEY).toBe('sk-test-key');
  });

  it('defaults OPENAI_EMBEDDING_MODEL to "text-embedding-3-small"', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
  });

  it('accepts a custom OPENAI_EMBEDDING_MODEL', () => {
    const config = parseConfig({ ...VALID_ENV, OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large' });
    expect(config.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-large');
  });

  it('coerces OPENAI_EMBEDDING_BATCH_SIZE from string "50" to number 50', () => {
    const config = parseConfig({ ...VALID_ENV, OPENAI_EMBEDDING_BATCH_SIZE: '50' });
    expect(config.OPENAI_EMBEDDING_BATCH_SIZE).toBe(50);
    expect(typeof config.OPENAI_EMBEDDING_BATCH_SIZE).toBe('number');
  });

  it('defaults OPENAI_EMBEDDING_BATCH_SIZE to 100 when absent', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.OPENAI_EMBEDDING_BATCH_SIZE).toBe(100);
  });

  it('defaults OPENAI_EMBEDDING_RPM to 3000 when absent', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(config.OPENAI_EMBEDDING_RPM).toBe(3000);
  });

  it('coerces OPENAI_EMBEDDING_RPM from string "1500" to number 1500', () => {
    const config = parseConfig({ ...VALID_ENV, OPENAI_EMBEDDING_RPM: '1500' });
    expect(config.OPENAI_EMBEDDING_RPM).toBe(1500);
  });

  it('calls process.exit(1) when OPENAI_EMBEDDING_BATCH_SIZE is out of range (0)', () => {
    expect(() => parseConfig({ ...VALID_ENV, OPENAI_EMBEDDING_BATCH_SIZE: '0' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when OPENAI_EMBEDDING_BATCH_SIZE exceeds max (2049)', () => {
    expect(() => parseConfig({ ...VALID_ENV, OPENAI_EMBEDDING_BATCH_SIZE: '2049' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
