// Unit tests for assertNotSsrf (ssrfGuard.ts)
//
// Pure function — no mocks, no DB. Tests extracted from url.ts inline guard.

import { describe, it, expect } from 'vitest';
import { assertNotSsrf } from '../../lib/ssrfGuard.js';

describe('assertNotSsrf', () => {
  // ---------------------------------------------------------------------------
  // Should pass (no throw)
  // ---------------------------------------------------------------------------

  it('1. http://example.com — passes without throwing', () => {
    expect(() => assertNotSsrf('http://example.com')).not.toThrow();
  });

  it('2. https://example.com — passes without throwing', () => {
    expect(() => assertNotSsrf('https://example.com')).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Should throw INVALID_URL — bad scheme
  // ---------------------------------------------------------------------------

  it('3. ftp://example.com — throws INVALID_URL (non-http/https scheme)', () => {
    expect(() => assertNotSsrf('ftp://example.com')).toThrow();
    try {
      assertNotSsrf('ftp://example.com');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  // ---------------------------------------------------------------------------
  // Should throw INVALID_URL — private / loopback addresses
  // ---------------------------------------------------------------------------

  it('4. http://localhost/ — throws INVALID_URL', () => {
    try {
      assertNotSsrf('http://localhost/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('5. http://127.0.0.1/ — throws INVALID_URL', () => {
    try {
      assertNotSsrf('http://127.0.0.1/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('6. http://192.168.1.1/ — throws INVALID_URL', () => {
    try {
      assertNotSsrf('http://192.168.1.1/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('7. http://10.0.0.1/ — throws INVALID_URL', () => {
    try {
      assertNotSsrf('http://10.0.0.1/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('8. http://172.16.0.1/ — throws INVALID_URL', () => {
    try {
      assertNotSsrf('http://172.16.0.1/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('9. http://169.254.169.254/ — throws INVALID_URL (AWS metadata endpoint)', () => {
    try {
      assertNotSsrf('http://169.254.169.254/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('10. http://[::1]/ — throws INVALID_URL (IPv6 loopback)', () => {
    try {
      assertNotSsrf('http://[::1]/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('11. http://[::ffff:127.0.0.1]/ — throws INVALID_URL (IPv4-mapped IPv6)', () => {
    try {
      assertNotSsrf('http://[::ffff:127.0.0.1]/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  // ---------------------------------------------------------------------------
  // Should throw INVALID_URL — numeric IP bypass
  // ---------------------------------------------------------------------------

  it('12. http://2130706433/ — throws INVALID_URL (decimal IP bypass for 127.0.0.1)', () => {
    try {
      assertNotSsrf('http://2130706433/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });

  it('13. http://0x7f000001/ — throws INVALID_URL (hex IP bypass for 127.0.0.1)', () => {
    try {
      assertNotSsrf('http://0x7f000001/');
      throw new Error('Expected to throw');
    } catch (err) {
      const e = err as Record<string, unknown>;
      expect(e['code']).toBe('INVALID_URL');
    }
  });
});
