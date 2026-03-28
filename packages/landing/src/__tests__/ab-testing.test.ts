import { resolveVariant } from '@/lib/ab-testing';

describe('resolveVariant', () => {
  it('returns "a" when both are undefined (default fallback)', () => {
    expect(resolveVariant(undefined, undefined)).toBe('a');
  });

  it('returns "c" when searchParam is "c" and cookie is "a" (URL wins)', () => {
    expect(resolveVariant('c', 'a')).toBe('c');
  });

  it('returns "a" when searchParam is "a" and cookie is "c" (URL wins)', () => {
    expect(resolveVariant('a', 'c')).toBe('a');
  });

  it('returns "a" when searchParam is "d" (variant D removed — ADR-012)', () => {
    expect(resolveVariant('d', undefined)).toBe('a');
  });

  it('returns "a" when cookie is "d" (variant D removed — ADR-012)', () => {
    expect(resolveVariant(undefined, 'd')).toBe('a');
  });

  it('returns "f" when searchParam is "f"', () => {
    expect(resolveVariant('f', undefined)).toBe('f');
  });

  it('returns cookie value "c" when searchParam is undefined and cookie is "c"', () => {
    expect(resolveVariant(undefined, 'c')).toBe('c');
  });

  it('returns cookie value "a" when searchParam is undefined and cookie is "a"', () => {
    expect(resolveVariant(undefined, 'a')).toBe('a');
  });

  it('falls back to "a" for invalid searchParam "b" (no longer valid)', () => {
    expect(resolveVariant('b', undefined)).toBe('a');
  });

  it('falls back to "a" for invalid searchParam ""', () => {
    expect(resolveVariant('', undefined)).toBe('a');
  });

  it('falls back to "a" for invalid searchParam "B" (case-sensitive)', () => {
    expect(resolveVariant('B', undefined)).toBe('a');
  });

  it('uses cookie when searchParam is invalid', () => {
    expect(resolveVariant('invalid', 'c')).toBe('c');
  });

  it('falls back to "a" when both searchParam and cookie are invalid', () => {
    expect(resolveVariant('invalid', 'also-invalid')).toBe('a');
  });
});
