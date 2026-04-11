// Unit tests for registerCors — F090 additions:
// 1. Development origin allowlist includes localhost:3002
// 2. Both development and production registrations include exposedHeaders: ['X-Actor-Id']
//
// Uses Vitest (same runner as all API tests).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp() {
  const registered: Array<{ plugin: unknown; options: unknown }> = [];
  const app = {
    register: vi.fn().mockImplementation(async (_plugin: unknown, options: unknown) => {
      registered.push({ plugin: _plugin, options });
    }),
    log: { warn: vi.fn() },
    _registered: registered,
  } as unknown as FastifyInstance & { _registered: typeof registered };
  return app;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'development',
    PORT: 3001,
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://localhost:6379',
    OPENAI_API_KEY: 'sk-test',
    ADMIN_API_KEY: 'admin-test',
    ...overrides,
  } as Config;
}

// Mock @fastify/cors so we can inspect registration calls without the real plugin
vi.mock('@fastify/cors', () => ({
  default: Symbol('cors-plugin'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerCors — F090 additions', () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    app = makeApp();
  });

  describe('development mode', () => {
    it('includes http://localhost:3002 in origin allowlist', async () => {
      const { registerCors } = await import('../plugins/cors.js');
      await registerCors(app as unknown as FastifyInstance, makeConfig({ NODE_ENV: 'development' }));

      expect(app.register).toHaveBeenCalledOnce();
      const options = app._registered[0]?.options as Record<string, unknown>;
      expect(options.origin).toContain('http://localhost:3002');
    });

    it('includes exposedHeaders: [X-Actor-Id]', async () => {
      const { registerCors } = await import('../plugins/cors.js');
      await registerCors(app as unknown as FastifyInstance, makeConfig({ NODE_ENV: 'development' }));

      const options = app._registered[0]?.options as Record<string, unknown>;
      expect(options.exposedHeaders).toEqual(['X-Actor-Id']);
    });
  });

  describe('production mode', () => {
    it('allows all origins (origin: true)', async () => {
      const { registerCors } = await import('../plugins/cors.js');
      await registerCors(app as unknown as FastifyInstance, makeConfig({ NODE_ENV: 'production' }));

      const options = app._registered[0]?.options as Record<string, unknown>;
      expect(options.origin).toBe(true);
    });

    it('includes exposedHeaders: [X-Actor-Id]', async () => {
      const { registerCors } = await import('../plugins/cors.js');
      await registerCors(app as unknown as FastifyInstance, makeConfig({ NODE_ENV: 'production' }));

      const options = app._registered[0]?.options as Record<string, unknown>;
      expect(options.exposedHeaders).toEqual(['X-Actor-Id']);
    });
  });

  describe('test mode', () => {
    it('does not register cors plugin', async () => {
      const { registerCors } = await import('../plugins/cors.js');
      await registerCors(app as unknown as FastifyInstance, makeConfig({ NODE_ENV: 'test' }));

      expect(app.register).not.toHaveBeenCalled();
    });
  });
});
