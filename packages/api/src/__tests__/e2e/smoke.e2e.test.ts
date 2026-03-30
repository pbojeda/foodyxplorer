// F066 — E2E Smoke Tests
//
// Starts a real HTTP server (app.listen on port 0) and makes real fetch()
// requests. No mocks — real Prisma, real Redis, real HTTP.
//
// Requires: Docker services running (PostgreSQL on 5433, Redis on 6380).
// Run with: npm run test:e2e -w @foodxplorer/api

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

let app: FastifyInstance;
let baseUrl: string;

const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] ?? '';

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: { message: string; code: string };
}

describe('E2E Smoke Tests', () => {
  beforeAll(async () => {
    if (!ADMIN_API_KEY) throw new Error('ADMIN_API_KEY not set in E2E env — check vitest.config.e2e.ts');
    app = await buildApp();
    await app.listen({ port: 0 });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 15_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // --- Test 1: Server starts ---
  it('server starts and binds to a port', () => {
    const addr = app.server.address() as AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  // --- Test 2: GET /health ---
  it('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  // --- Test 3: GET /estimate with valid query ---
  it('GET /estimate?query=big+mac returns 200 with envelope', async () => {
    const res = await fetch(`${baseUrl}/estimate?query=big+mac`);
    expect(res.status).toBe(200);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    // result may be null if test DB is not seeded — that's valid (still 200)
  });

  // --- Test 4: GET /estimate without query → 400 ---
  it('GET /estimate without query returns 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/estimate`);
    expect(res.status).toBe(400);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  // --- Test 5: GET /estimate with invalid API key → 401 ---
  it('GET /estimate with invalid API key returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/estimate?query=test`, {
      headers: { 'x-api-key': 'fxp_invalid_key_not_in_db_00000000' },
    });
    expect(res.status).toBe(401);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  // --- Test 6: GET /chains ---
  it('GET /chains?isActive=true returns 200 with array', async () => {
    const res = await fetch(`${baseUrl}/chains?isActive=true`);
    expect(res.status).toBe(200);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // --- Test 7: GET /quality/report with admin key → 200 ---
  it('GET /quality/report with admin key returns 200', async () => {
    const res = await fetch(`${baseUrl}/quality/report`, {
      headers: { 'x-api-key': ADMIN_API_KEY },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  // --- Test 8: GET /quality/report without admin key → 401 ---
  it('GET /quality/report without admin key returns 401', async () => {
    const res = await fetch(`${baseUrl}/quality/report`);
    expect(res.status).toBe(401);

    const body = await res.json() as ApiResponse;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  // --- Test 9: CORS preflight ---
  it('OPTIONS /estimate returns CORS headers', async () => {
    const res = await fetch(`${baseUrl}/estimate`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull();
  });

  // --- Test 10: Rate limit headers ---
  it('GET /estimate includes rate limit headers', async () => {
    const res = await fetch(`${baseUrl}/estimate?query=test`);

    const limit = Number(res.headers.get('x-ratelimit-limit'));
    expect(limit).toBeGreaterThan(0);
    expect(res.headers.get('x-ratelimit-remaining')).not.toBeNull();
  });
});
