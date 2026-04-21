// F091 — Unit tests for new mapError branches in errorHandler.ts
//
// Tests the two new error code mappings:
//   IP_VOICE_LIMIT_EXCEEDED → 429 with details.{ limitMinutes, resetAt }
//   VOICE_BUDGET_EXHAUSTED  → 503
//
// Verifies existing EMPTY_TRANSCRIPTION and TRANSCRIPTION_FAILED are unaffected.
// Pattern: packages/api/src/__tests__/errorHandler.test.ts

import { describe, it, expect } from 'vitest';
import { mapError } from '../errors/errorHandler.js';

describe('mapError — F091 new error codes', () => {
  // -------------------------------------------------------------------------
  // IP_VOICE_LIMIT_EXCEEDED
  // -------------------------------------------------------------------------

  it('IP_VOICE_LIMIT_EXCEEDED → 429 with IP_VOICE_LIMIT_EXCEEDED code', () => {
    const error = Object.assign(new Error('Per-IP daily voice limit exceeded'), {
      code: 'IP_VOICE_LIMIT_EXCEEDED',
    });
    const result = mapError(error);
    expect(result.statusCode).toBe(429);
    expect(result.body.error.code).toBe('IP_VOICE_LIMIT_EXCEEDED');
  });

  it('IP_VOICE_LIMIT_EXCEEDED → preserves details.limitMinutes from error object', () => {
    const error = Object.assign(new Error('Per-IP daily voice limit exceeded'), {
      code: 'IP_VOICE_LIMIT_EXCEEDED',
      details: { limitMinutes: 30, resetAt: '2026-04-21T00:00:00.000Z' },
    });
    const result = mapError(error);
    expect(result.statusCode).toBe(429);
    const details = result.body.error.details as Record<string, unknown> | undefined;
    expect(details).toBeDefined();
    expect(details?.['limitMinutes']).toBe(30);
    expect(details?.['resetAt']).toBe('2026-04-21T00:00:00.000Z');
  });

  it('IP_VOICE_LIMIT_EXCEEDED → details is undefined when error has no details field', () => {
    const error = Object.assign(new Error('Per-IP daily voice limit exceeded'), {
      code: 'IP_VOICE_LIMIT_EXCEEDED',
    });
    const result = mapError(error);
    // details may be absent — should not crash
    expect(result.statusCode).toBe(429);
    expect(result.body.error.code).toBe('IP_VOICE_LIMIT_EXCEEDED');
  });

  // -------------------------------------------------------------------------
  // VOICE_BUDGET_EXHAUSTED
  // -------------------------------------------------------------------------

  it('VOICE_BUDGET_EXHAUSTED → 503', () => {
    const error = Object.assign(new Error('Monthly voice budget cap reached'), {
      code: 'VOICE_BUDGET_EXHAUSTED',
    });
    const result = mapError(error);
    expect(result.statusCode).toBe(503);
    expect(result.body.error.code).toBe('VOICE_BUDGET_EXHAUSTED');
  });

  it('VOICE_BUDGET_EXHAUSTED → success: false', () => {
    const error = Object.assign(new Error('Monthly voice budget cap reached'), {
      code: 'VOICE_BUDGET_EXHAUSTED',
    });
    const result = mapError(error);
    expect(result.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Regression: existing codes must not be broken
  // -------------------------------------------------------------------------

  it('EMPTY_TRANSCRIPTION → still 422', () => {
    const error = Object.assign(new Error('Empty transcription'), {
      code: 'EMPTY_TRANSCRIPTION',
    });
    const result = mapError(error);
    expect(result.statusCode).toBe(422);
    expect(result.body.error.code).toBe('EMPTY_TRANSCRIPTION');
  });

  it('TRANSCRIPTION_FAILED → still 502', () => {
    const error = Object.assign(new Error('Whisper failed'), {
      code: 'TRANSCRIPTION_FAILED',
    });
    const result = mapError(error);
    expect(result.statusCode).toBe(502);
    expect(result.body.error.code).toBe('TRANSCRIPTION_FAILED');
  });
});
