/**
 * BUG-PROD-008-FU1 — Tests for serializeOpenAIError().
 *
 * Proves that OpenAI SDK errors (with non-enumerable properties) are
 * serialized into plain objects that pino can log correctly.
 */

import { describe, it, expect } from 'vitest';
import { serializeOpenAIError } from '../openaiClient.js';

describe('serializeOpenAIError', () => {
  it('AC3: extracts non-enumerable properties from OpenAI-style APIError', () => {
    // Simulate an OpenAI SDK APIError — properties are non-enumerable
    const error = new Error('Invalid API key');
    Object.defineProperty(error, 'status', { value: 401, enumerable: false });
    Object.defineProperty(error, 'code', { value: 'invalid_api_key', enumerable: false });
    Object.defineProperty(error, 'type', { value: 'authentication_error', enumerable: false });

    // Verify JSON.stringify produces {} (the bug we're fixing)
    expect(JSON.stringify(error)).toBe('{}');

    // Our serializer must extract the real fields
    const serialized = serializeOpenAIError(error);
    expect(serialized).toEqual({
      message: 'Invalid API key',
      name: 'Error',
      status: 401,
      code: 'invalid_api_key',
      type: 'authentication_error',
    });
  });

  it('AC4: handles plain Error objects (no custom properties)', () => {
    const error = new Error('Something went wrong');

    const serialized = serializeOpenAIError(error);
    expect(serialized).toEqual({
      message: 'Something went wrong',
      name: 'Error',
    });
    // Should NOT have status/code/type keys
    expect(serialized).not.toHaveProperty('status');
    expect(serialized).not.toHaveProperty('code');
    expect(serialized).not.toHaveProperty('type');
  });

  it('AC5: handles non-Error values gracefully', () => {
    expect(serializeOpenAIError('string error')).toEqual({ raw: 'string error' });
    expect(serializeOpenAIError(null)).toEqual({ raw: 'null' });
    expect(serializeOpenAIError(undefined)).toEqual({ raw: 'undefined' });
    expect(serializeOpenAIError(42)).toEqual({ raw: '42' });
  });
});
