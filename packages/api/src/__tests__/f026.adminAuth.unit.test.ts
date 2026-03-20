// Unit tests for plugins/adminAuth.ts — validateAdminKey pure function
//
// Tests the function in isolation: no Fastify server, no buildApp.
// All tests are pure function calls.

import { describe, it, expect } from 'vitest';
import { validateAdminKey } from '../plugins/adminAuth.js';

const VALID_ADMIN_KEY = 'a'.repeat(32); // 32-char key (meets min(32))

describe('validateAdminKey', () => {
  describe('correct key', () => {
    it('does not throw when headerValue matches adminApiKey', () => {
      expect(() => validateAdminKey(VALID_ADMIN_KEY, VALID_ADMIN_KEY)).not.toThrow();
    });

    it('accepts any key >= 32 chars that matches', () => {
      const key64 = 'b'.repeat(64);
      expect(() => validateAdminKey(key64, key64)).not.toThrow();
    });
  });

  describe('wrong key', () => {
    it('throws with code UNAUTHORIZED when header does not match adminApiKey', () => {
      const wrongKey = 'z'.repeat(32);
      let thrown: unknown;

      try {
        validateAdminKey(wrongKey, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeDefined();
      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
    });

    it('throws with message "Admin API key required" on mismatch', () => {
      const wrongKey = 'x'.repeat(32);
      let thrown: unknown;

      try {
        validateAdminKey(wrongKey, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as Error).message).toBe('Admin API key required');
    });
  });

  describe('missing / undefined header', () => {
    it('throws UNAUTHORIZED when headerValue is undefined', () => {
      let thrown: unknown;

      try {
        validateAdminKey(undefined, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
    });

    it('throws UNAUTHORIZED when headerValue is empty string', () => {
      let thrown: unknown;

      try {
        validateAdminKey('', VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
    });
  });

  describe('timing-safe comparison', () => {
    it('works when provided key is shorter than adminApiKey (different raw lengths)', () => {
      const shortKey = 'a'.repeat(16); // shorter than the admin key
      let thrown: unknown;

      try {
        validateAdminKey(shortKey, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      // Should throw UNAUTHORIZED (not a length error or Buffer size mismatch)
      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
    });

    it('works when provided key is longer than adminApiKey', () => {
      const longKey = 'a'.repeat(64);
      let thrown: unknown;

      try {
        validateAdminKey(longKey, VALID_ADMIN_KEY);
      } catch (e) {
        thrown = e;
      }

      expect((thrown as { code?: string }).code).toBe('UNAUTHORIZED');
    });
  });
});
