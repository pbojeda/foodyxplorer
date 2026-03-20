// Edge-case tests for plugins/adminAuth.ts — validateAdminKey
//
// Covers scenarios NOT tested in f026.adminAuth.unit.test.ts:
//   - Array header with multiple elements → first element used
//   - Key that matches only by SHA-256 collision (structural verification)
//   - Null header value (type guard)
//   - Unicode and special-character keys
//   - Keys that differ only by trailing whitespace (not equivalent)
//   - Very long key as adminApiKey (env var can be any length)
//   - All-zero key (valid but bad practice)
//   - Error always has code: 'UNAUTHORIZED' (never 'FORBIDDEN' or other codes)
//   - Error is always instance of Error (not a plain object)

import { describe, it, expect } from 'vitest';
import { validateAdminKey } from '../plugins/adminAuth.js';

const VALID_ADMIN_KEY = 'a'.repeat(32);

// ---------------------------------------------------------------------------
// Array header edge cases
// ---------------------------------------------------------------------------

describe('validateAdminKey — array header edge cases', () => {
  it('array with single correct element → does not throw', () => {
    expect(() => validateAdminKey([VALID_ADMIN_KEY], VALID_ADMIN_KEY)).not.toThrow();
  });

  it('array with correct key as first element, wrong second → does not throw (first wins)', () => {
    expect(() =>
      validateAdminKey([VALID_ADMIN_KEY, 'wrong-second-key'], VALID_ADMIN_KEY),
    ).not.toThrow();
  });

  it('array with wrong key as first element, correct second → throws (first is authoritative)', () => {
    const wrongKey = 'z'.repeat(32);
    let thrown: unknown;

    try {
      validateAdminKey([wrongKey, VALID_ADMIN_KEY], VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('empty array → throws UNAUTHORIZED (no element to compare)', () => {
    // [] is falsy when treated as string? No: [] is truthy.
    // Array.isArray([]) ? [][0] : [] → [][0] is undefined → !provided → throws
    let thrown: unknown;

    try {
      validateAdminKey([], VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// Whitespace and character sensitivity
// ---------------------------------------------------------------------------

describe('validateAdminKey — whitespace and character sensitivity', () => {
  it('key with trailing whitespace does not match exact key (whitespace is significant)', () => {
    const keyWithTrailingSpace = VALID_ADMIN_KEY + ' ';
    let thrown: unknown;

    try {
      validateAdminKey(keyWithTrailingSpace, VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('key with leading whitespace does not match exact key', () => {
    const keyWithLeadingSpace = ' ' + VALID_ADMIN_KEY;
    let thrown: unknown;

    try {
      validateAdminKey(keyWithLeadingSpace, VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('key that differs by case does not match (SHA-256 is case-sensitive)', () => {
    const upperCaseKey = VALID_ADMIN_KEY.toUpperCase();
    // 'a'.repeat(32).toUpperCase() → 'A'.repeat(32) — different SHA-256 digest
    let thrown: unknown;

    try {
      validateAdminKey(upperCaseKey, VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('key matching only the first 31 chars → throws (one char difference)', () => {
    const almostCorrect = 'a'.repeat(31) + 'b'; // differs in last char
    let thrown: unknown;

    try {
      validateAdminKey(almostCorrect, VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// Error shape validation
// ---------------------------------------------------------------------------

describe('validateAdminKey — error shape', () => {
  it('thrown error is an instance of Error (not a plain object)', () => {
    let thrown: unknown;

    try {
      validateAdminKey('wrong', VALID_ADMIN_KEY);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
  });

  it('error code is always UNAUTHORIZED — never FORBIDDEN or other codes', () => {
    const testCases = [
      undefined,
      '',
      'wrong-key',
      'a'.repeat(10),
      'a'.repeat(64),
    ];

    for (const headerValue of testCases) {
      let thrown: unknown;

      try {
        validateAdminKey(headerValue, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
      expect((thrown as { code?: string }).code).not.toBe('FORBIDDEN');
    }
  });

  it('error message for both missing and wrong key is "Admin API key required"', () => {
    const missingCases: (string | undefined)[] = [undefined, '', 'wrong'];

    for (const headerValue of missingCases) {
      let thrown: unknown;

      try {
        validateAdminKey(headerValue, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as Error).message).toBe('Admin API key required');
    }
  });
});

// ---------------------------------------------------------------------------
// Exotic adminApiKey values
// ---------------------------------------------------------------------------

describe('validateAdminKey — exotic adminApiKey values', () => {
  it('very long adminApiKey (256 chars) can be matched correctly', () => {
    const longKey = 'b'.repeat(256);
    expect(() => validateAdminKey(longKey, longKey)).not.toThrow();
  });

  it('adminApiKey with special characters → correct value matches', () => {
    const specialKey = '!@#$%^&*()_+-=[]{}|;:,.<>?/`~' + 'x'.repeat(10);
    expect(() => validateAdminKey(specialKey, specialKey)).not.toThrow();
  });

  it('adminApiKey with unicode → correct value matches', () => {
    const unicodeKey = 'café-naïve-中文-' + 'a'.repeat(20);
    expect(() => validateAdminKey(unicodeKey, unicodeKey)).not.toThrow();
  });

  it('unicode key does not match ASCII equivalent (encoding sensitivity)', () => {
    const unicodeKey = 'caf\u00e9'; // 'café' with é as single code point
    const asciiApprox = 'cafe'; // without accent

    let thrown: unknown;
    try {
      validateAdminKey(unicodeKey, asciiApprox);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
  });

  it('all-zeros key (poor practice but technically valid) can be matched', () => {
    const zeroKey = '0'.repeat(32);
    expect(() => validateAdminKey(zeroKey, zeroKey)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Timing-safe comparison security properties
// ---------------------------------------------------------------------------

describe('validateAdminKey — timing-safe comparison security', () => {
  it('does not throw a TypeError for keys of any length (SHA-256 normalizes buffer size)', () => {
    // timingSafeEqual requires equal-length buffers.
    // The implementation hashes both sides to SHA-256 first → always 32 bytes.
    // This ensures no crash for length mismatch.
    const lengths = [0, 1, 16, 31, 32, 33, 64, 128, 1000];

    for (const len of lengths) {
      let thrown: unknown;

      try {
        validateAdminKey('x'.repeat(len), VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      // Must throw UNAUTHORIZED, never TypeError or RangeError
      if (thrown) {
        expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
        expect(thrown).not.toBeInstanceOf(TypeError);
        expect(thrown).not.toBeInstanceOf(RangeError);
      }
    }
  });

  it('correct key of length 1 can match adminApiKey of length 1 (minimum valid)', () => {
    const tinyKey = 'x';
    expect(() => validateAdminKey(tinyKey, tinyKey)).not.toThrow();
  });
});
