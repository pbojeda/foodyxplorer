// BUG-AUDIT-C4 — Tests for POST endpoints with missing/invalid JSON body.
//
// Verifies that POST with no body or malformed JSON returns 400 VALIDATION_ERROR
// instead of 500 INTERNAL_ERROR.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mapError } from '../errors/errorHandler.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../errors/errorHandler.js';

// ---------------------------------------------------------------------------
// Minimal app with POST route that requires JSON body
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);

  // Register a simple POST route that accesses request.body
  app.post('/test-post', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || !body['text']) {
      throw Object.assign(new Error('body/text Required'), { code: 'VALIDATION_ERROR' });
    }
    return reply.send({ success: true, data: body });
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// C4: POST with missing or invalid body
// ---------------------------------------------------------------------------

describe('C4: POST with no body returns 400 (not 500)', () => {
  it('no body at all returns 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-post',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalid JSON returns 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-post',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid',
    });

    const responseBody = JSON.parse(res.payload);
    expect(res.statusCode).toBe(400);
    expect(responseBody.success).toBe(false);
    expect(responseBody.error.code).toBe('VALIDATION_ERROR');
  });

  it('valid JSON body works normally', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-post',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'hello' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
  });

  it('empty JSON object {} reaches route handler (not 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-post',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    // Route handler throws VALIDATION_ERROR for missing text field
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// mapError unit test: non-JSON SyntaxError falls through to 500
// ---------------------------------------------------------------------------

describe('mapError: non-JSON SyntaxError → 500', () => {
  it('SyntaxError without statusCode or JSON message → 500 INTERNAL_ERROR', () => {
    const err = new SyntaxError('unexpected token');
    const result = mapError(err);
    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });
});
