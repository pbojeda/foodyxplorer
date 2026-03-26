// Unit tests for F031 ALLOWED_CHAT_IDS addition to config.ts.
//
// Tests the ALLOWED_CHAT_IDS Zod transform via parseConfig(env).
// Pattern mirrors config.test.ts exactly — same exitSpy setup, same beforeAll
// dynamic import, same VALID_BOT_ENV base fixture.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { BotConfig } from '../config.js';

// process.exit spy — installed before config is imported
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
  (_code?: string | number | null | undefined): never => {
    throw new Error('process.exit called');
  },
);

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

describe('parseConfig — ALLOWED_CHAT_IDS', () => {
  beforeEach(() => {
    exitSpy.mockClear();
  });

  it('defaults ALLOWED_CHAT_IDS to [] when the env var is absent', () => {
    const config = parseConfig({ ...VALID_BOT_ENV });
    expect(config.ALLOWED_CHAT_IDS).toEqual([]);
  });

  it('parses ALLOWED_CHAT_IDS to [] when set to empty string', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, ALLOWED_CHAT_IDS: '' });
    expect(config.ALLOWED_CHAT_IDS).toEqual([]);
  });

  it('parses comma-separated IDs to number[]', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, ALLOWED_CHAT_IDS: '123456789,987654321' });
    expect(config.ALLOWED_CHAT_IDS).toEqual([123456789, 987654321]);
  });

  it('trims spaces around commas', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, ALLOWED_CHAT_IDS: '123, 456' });
    expect(config.ALLOWED_CHAT_IDS).toEqual([123, 456]);
  });

  it('filters out non-numeric entries (NaN after parseInt)', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, ALLOWED_CHAT_IDS: 'abc,123' });
    expect(config.ALLOWED_CHAT_IDS).toEqual([123]);
  });

  it('does NOT call process.exit(1) when ALLOWED_CHAT_IDS is missing (it is optional)', () => {
    const { ...rest } = VALID_BOT_ENV;
    expect(() => parseConfig(rest)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('parses a single chat ID correctly', () => {
    const config = parseConfig({ ...VALID_BOT_ENV, ALLOWED_CHAT_IDS: '42' });
    expect(config.ALLOWED_CHAT_IDS).toEqual([42]);
  });
});
