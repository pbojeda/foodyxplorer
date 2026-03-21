// Unit tests for config.ts — BotEnvSchema and parseConfig
//
// Tests the parseConfig(env) named export without mutating process.env.
// process.exit is mocked to prevent actual process termination.
//
// vitest.config.ts provides the six BotEnvSchema defaults so the module-level
// singleton (parseConfig(process.env)) does not exit when config.ts is imported.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { BotConfig } from '../config.js';

// process.exit spy — installed before config is imported so it covers the
// module-level singleton call in config.ts (line: export const config = parseConfig(process.env))
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
  (_code?: string | number | null | undefined): never => {
    throw new Error('process.exit called');
  },
);

// parseConfig is loaded via beforeAll to give the spy time to set up first.
let parseConfig: (env: NodeJS.ProcessEnv) => BotConfig;

beforeAll(async () => {
  const mod = await import('../config.js');
  parseConfig = mod.parseConfig;
});

const VALID_BOT_ENV = {
  TELEGRAM_BOT_TOKEN: 'test-token-123',
  API_BASE_URL: 'http://localhost:3001',
  BOT_API_KEY: 'test-bot-api-key',
  BOT_VERSION: '0.1.0',
  LOG_LEVEL: 'info',
  NODE_ENV: 'development',
} satisfies NodeJS.ProcessEnv;

describe('parseConfig', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('parses a valid complete env object', () => {
    const config = parseConfig({ ...VALID_BOT_ENV });

    expect(config.TELEGRAM_BOT_TOKEN).toBe('test-token-123');
    expect(config.API_BASE_URL).toBe('http://localhost:3001');
    expect(config.BOT_API_KEY).toBe('test-bot-api-key');
    expect(config.BOT_VERSION).toBe('0.1.0');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
  });

  it('defaults API_BASE_URL to "http://localhost:3001" when absent', () => {
    const { API_BASE_URL: _omit, ...rest } = VALID_BOT_ENV;
    const config = parseConfig(rest);
    expect(config.API_BASE_URL).toBe('http://localhost:3001');
  });

  it('defaults BOT_VERSION to "0.1.0" when absent', () => {
    const { BOT_VERSION: _omit, ...rest } = VALID_BOT_ENV;
    const config = parseConfig(rest);
    expect(config.BOT_VERSION).toBe('0.1.0');
  });

  it('defaults LOG_LEVEL to "info" when absent', () => {
    const { LOG_LEVEL: _omit, ...rest } = VALID_BOT_ENV;
    const config = parseConfig(rest);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('defaults NODE_ENV to "development" when absent', () => {
    const { NODE_ENV: _omit, ...rest } = VALID_BOT_ENV;
    const config = parseConfig(rest);
    expect(config.NODE_ENV).toBe('development');
  });

  it('accepts all valid LOG_LEVEL values', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) {
      const config = parseConfig({ ...VALID_BOT_ENV, LOG_LEVEL: level });
      expect(config.LOG_LEVEL).toBe(level);
    }
  });

  it('calls process.exit(1) when LOG_LEVEL is invalid', () => {
    expect(() => parseConfig({ ...VALID_BOT_ENV, LOG_LEVEL: 'verbose' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when TELEGRAM_BOT_TOKEN is missing', () => {
    const { TELEGRAM_BOT_TOKEN: _omit, ...rest } = VALID_BOT_ENV;
    expect(() => parseConfig(rest)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when TELEGRAM_BOT_TOKEN is empty string', () => {
    expect(() => parseConfig({ ...VALID_BOT_ENV, TELEGRAM_BOT_TOKEN: '' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when BOT_API_KEY is missing', () => {
    const { BOT_API_KEY: _omit, ...rest } = VALID_BOT_ENV;
    expect(() => parseConfig(rest)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when BOT_API_KEY is empty string', () => {
    expect(() => parseConfig({ ...VALID_BOT_ENV, BOT_API_KEY: '' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when API_BASE_URL is not a valid URL', () => {
    expect(() => parseConfig({ ...VALID_BOT_ENV, API_BASE_URL: 'not-a-url' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when NODE_ENV is invalid', () => {
    expect(() => parseConfig({ ...VALID_BOT_ENV, NODE_ENV: 'staging' })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts "test" as a valid NODE_ENV', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, NODE_ENV: 'test' });
    expect(config.NODE_ENV).toBe('test');
  });

  it('accepts "production" as a valid NODE_ENV', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, NODE_ENV: 'production' });
    expect(config.NODE_ENV).toBe('production');
  });
});
