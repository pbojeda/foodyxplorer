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

  it('AC8: redacts OpenAI API keys from error messages', () => {
    // Reproduce the exact error pattern from BUG-PROD-008-FU1 prod logs
    const error = new Error(
      'Headers.append: "Bearer sk-proj-a45mBOZAaQu0gJAYujHWXtklOJSykXkjCiXW3ZKS0kXjBnxumrO3LJYJC8' +
      'fAVcANVE1tQFxff-T3BlbkFJWwLc2xRwCKhC6lR4SdVjYa_CLXs-D\\n  jA0ZsZl2RXLA35BPkP4zH7lkZFs2_0z0q3B1r74Lfys8A"' +
      ' is an invalid header value.',
    );

    const serialized = serializeOpenAIError(error);
    // Key must be redacted
    expect(serialized['message']).not.toContain('sk-proj-');
    expect(serialized['message']).toContain('sk-***REDACTED***');
    // Rest of the message should be preserved
    expect(serialized['message']).toContain('is an invalid header value');
  });

  it('AC9: redacts multiple key formats (sk-proj-, sk-, key_)', () => {
    const error = new Error(
      'Key sk-abcdef123456 failed. Also key_test_789xyz is bad. And sk-proj-longKeyHere too.',
    );

    const serialized = serializeOpenAIError(error);
    expect(serialized['message']).not.toContain('sk-abcdef123456');
    expect(serialized['message']).not.toContain('key_test_789xyz');
    expect(serialized['message']).not.toContain('sk-proj-longKeyHere');
    expect(serialized['message']).toContain('sk-***REDACTED***');
  });

  it('AC10: does not alter messages without secrets', () => {
    const error = new Error('Connection timeout after 5000ms');
    const serialized = serializeOpenAIError(error);
    expect(serialized['message']).toBe('Connection timeout after 5000ms');
  });

  it('AC11: redacts secrets in raw non-Error values too', () => {
    const serialized = serializeOpenAIError('Bearer sk-proj-secretKey123 is invalid');
    expect(serialized['raw']).not.toContain('sk-proj-secretKey123');
    expect(serialized['raw']).toContain('sk-***REDACTED***');
  });
});
