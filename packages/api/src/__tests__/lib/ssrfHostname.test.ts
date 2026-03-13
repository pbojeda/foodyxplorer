// Unit tests for SSRF hostname normalization behaviour.
//
// These tests document how Node.js WHATWG URL normalizes hostnames for
// adversarial inputs and verify that the production SSRF guards catch them.
//
// Key finding: Node.js normalizes IPv4-mapped IPv6 to hex notation:
//   [::ffff:127.0.0.1] → hostname "[::ffff:7f00:1]"
//   [::ffff:192.168.1.1] → hostname "[::ffff:c0a8:101]"
//
// The SSRF fix uses two guards:
//   1. SSRF_BLOCKED — regex for IPv4 private ranges, localhost, 0.0.0.0, ::1, fe80::
//   2. SSRF_BLOCKED_IPV4_MAPPED — blocks all ::ffff: prefix addresses

import { describe, it, expect } from 'vitest';

// Replicate the exact SSRF guards from the production code (post-fix)
const SSRF_BLOCKED =
  /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?fe80:.*)$/i;

const SSRF_BLOCKED_IPV4_MAPPED = /^\[?::ffff:/i;

function isBlocked(hostname: string): boolean {
  return SSRF_BLOCKED.test(hostname) || SSRF_BLOCKED_IPV4_MAPPED.test(hostname);
}

describe('Node.js URL hostname normalization', () => {
  it('[::ffff:127.0.0.1] normalizes to "[::ffff:7f00:1]" — NOT dotted decimal', () => {
    const parsed = new URL('http://[::ffff:127.0.0.1]/menu');
    expect(parsed.hostname).toBe('[::ffff:7f00:1]');
  });

  it('[::ffff:192.168.1.1] normalizes to "[::ffff:c0a8:101]"', () => {
    const parsed = new URL('http://[::ffff:192.168.1.1]/menu');
    expect(parsed.hostname).toBe('[::ffff:c0a8:101]');
  });

  it('[::1] keeps brackets in hostname: "[::1]"', () => {
    const parsed = new URL('http://[::1]/menu');
    expect(parsed.hostname).toBe('[::1]');
  });

  it('decimal 2130706433 normalizes to 127.0.0.1', () => {
    const parsed = new URL('http://2130706433/menu');
    expect(parsed.hostname).toBe('127.0.0.1');
  });
});

describe('SSRF guard coverage', () => {
  it('[::ffff:7f00:1] (= [::ffff:127.0.0.1] normalized) is blocked by SSRF_BLOCKED_IPV4_MAPPED', () => {
    expect(isBlocked('[::ffff:7f00:1]')).toBe(true);
  });

  it('[::ffff:c0a8:101] (= [::ffff:192.168.1.1] normalized) is blocked by SSRF_BLOCKED_IPV4_MAPPED', () => {
    expect(isBlocked('[::ffff:c0a8:101]')).toBe(true);
  });

  it('[::1] is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('[::1]')).toBe(true);
  });

  it('localhost is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('localhost')).toBe(true);
  });

  it('127.0.0.1 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('127.0.0.1')).toBe(true);
  });

  it('0.0.0.0 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('0.0.0.0')).toBe(true);
  });

  it('10.0.0.1 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('10.0.0.1')).toBe(true);
  });

  it('172.16.0.1 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('172.16.0.1')).toBe(true);
  });

  it('172.31.255.255 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('172.31.255.255')).toBe(true);
  });

  it('192.168.1.1 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('192.168.1.1')).toBe(true);
  });

  it('169.254.169.254 is blocked by SSRF_BLOCKED', () => {
    expect(isBlocked('169.254.169.254')).toBe(true);
  });

  it('172.32.0.1 (outside RFC1918 172.16/12 range) is NOT blocked', () => {
    expect(isBlocked('172.32.0.1')).toBe(false);
  });

  it('example.com is NOT blocked', () => {
    expect(isBlocked('example.com')).toBe(false);
  });

  it('8.8.8.8 (public DNS) is NOT blocked', () => {
    expect(isBlocked('8.8.8.8')).toBe(false);
  });
});
