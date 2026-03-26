import { resolveVariant } from '@/lib/ab-testing';

describe('resolveVariant', () => {
  it('returns "a" when both are undefined and injected random returns 0.3 (< 0.5)', () => {
    expect(resolveVariant(undefined, undefined, () => 0.3)).toBe('a');
  });

  it('returns "b" when both are undefined and injected random returns 0.7 (>= 0.5)', () => {
    expect(resolveVariant(undefined, undefined, () => 0.7)).toBe('b');
  });

  it('returns "b" when searchParam is "b" and cookie is "a" (URL wins)', () => {
    expect(resolveVariant('b', 'a')).toBe('b');
  });

  it('returns "a" when searchParam is "a" and cookie is "b" (URL wins)', () => {
    expect(resolveVariant('a', 'b')).toBe('a');
  });

  it('returns cookie value "b" when searchParam is undefined and cookie is "b"', () => {
    expect(resolveVariant(undefined, 'b')).toBe('b');
  });

  it('returns cookie value "a" when searchParam is undefined and cookie is "a"', () => {
    expect(resolveVariant(undefined, 'a')).toBe('a');
  });

  it('falls back to random for invalid searchParam "c"', () => {
    expect(resolveVariant('c', undefined, () => 0.3)).toBe('a');
    expect(resolveVariant('c', undefined, () => 0.7)).toBe('b');
  });

  it('falls back to random for invalid searchParam ""', () => {
    expect(resolveVariant('', undefined, () => 0.3)).toBe('a');
  });

  it('falls back to random for invalid searchParam "B" (case-sensitive)', () => {
    expect(resolveVariant('B', undefined, () => 0.7)).toBe('b');
  });

  it('uses cookie when searchParam is invalid', () => {
    expect(resolveVariant('invalid', 'b')).toBe('b');
  });
});
