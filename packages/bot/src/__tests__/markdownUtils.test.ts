// Unit tests for markdownUtils.ts — escapeMarkdown(), truncate(), formatNutrient()

import { describe, it, expect } from 'vitest';
import { escapeMarkdown, truncate, formatNutrient } from '../formatters/markdownUtils.js';

describe('escapeMarkdown', () => {
  it('returns empty string unchanged', () => {
    expect(escapeMarkdown('')).toBe('');
  });

  it('returns plain text with no special chars unchanged', () => {
    expect(escapeMarkdown('hello world')).toBe('hello world');
  });

  it('escapes underscore _', () => {
    expect(escapeMarkdown('hello_world')).toBe('hello\\_world');
  });

  it('escapes asterisk *', () => {
    expect(escapeMarkdown('a*b')).toBe('a\\*b');
  });

  it('escapes open bracket [', () => {
    expect(escapeMarkdown('a[b')).toBe('a\\[b');
  });

  it('escapes close bracket ]', () => {
    expect(escapeMarkdown('a]b')).toBe('a\\]b');
  });

  it('escapes open paren (', () => {
    expect(escapeMarkdown('a(b')).toBe('a\\(b');
  });

  it('escapes close paren )', () => {
    expect(escapeMarkdown('a)b')).toBe('a\\)b');
  });

  it('escapes tilde ~', () => {
    expect(escapeMarkdown('a~b')).toBe('a\\~b');
  });

  it('escapes backtick `', () => {
    expect(escapeMarkdown('a`b')).toBe('a\\`b');
  });

  it('escapes greater than >', () => {
    expect(escapeMarkdown('a>b')).toBe('a\\>b');
  });

  it('escapes hash #', () => {
    expect(escapeMarkdown('a#b')).toBe('a\\#b');
  });

  it('escapes plus +', () => {
    expect(escapeMarkdown('a+b')).toBe('a\\+b');
  });

  it('escapes minus -', () => {
    expect(escapeMarkdown('a-b')).toBe('a\\-b');
  });

  it('escapes equals =', () => {
    expect(escapeMarkdown('a=b')).toBe('a\\=b');
  });

  it('escapes pipe |', () => {
    expect(escapeMarkdown('a|b')).toBe('a\\|b');
  });

  it('escapes open brace {', () => {
    expect(escapeMarkdown('a{b')).toBe('a\\{b');
  });

  it('escapes close brace }', () => {
    expect(escapeMarkdown('a}b')).toBe('a\\}b');
  });

  it('escapes period .', () => {
    expect(escapeMarkdown('a.b')).toBe('a\\.b');
  });

  it('escapes exclamation !', () => {
    expect(escapeMarkdown('a!b')).toBe('a\\!b');
  });

  it('escapes multiple reserved chars in one string', () => {
    expect(escapeMarkdown('*bold* and _italic_')).toBe('\\*bold\\* and \\_italic\\_');
  });

  it('leaves emoji unchanged', () => {
    expect(escapeMarkdown('🍔 burger')).toBe('🍔 burger');
  });

  it('leaves digits unchanged', () => {
    expect(escapeMarkdown('abc123')).toBe('abc123');
  });

  it('escapes a realistic dish name with parens', () => {
    expect(escapeMarkdown('Big Mac (McDonalds)')).toBe('Big Mac \\(McDonalds\\)');
  });
});

describe('truncate', () => {
  it('returns string shorter than maxLen unchanged', () => {
    expect(truncate('hello', 100)).toBe('hello');
  });

  it('returns string exactly maxLen chars unchanged', () => {
    const s = 'a'.repeat(10);
    expect(truncate(s, 10)).toBe(s);
  });

  it('truncates long string and appends lista recortada note', () => {
    const line = 'x'.repeat(20);
    const text = [line, line, line].join('\n');
    const result = truncate(text, 30);
    expect(result.length).toBeLessThanOrEqual(30 + '\n\n_Lista recortada_'.length);
    expect(result).toContain('_Lista recortada_');
  });

  it('truncates at last newline boundary before maxLen', () => {
    const text = 'line one\nline two that is very long\nline three';
    const result = truncate(text, 15);
    // Should cut at last newline before position 15
    expect(result).toContain('_Lista recortada_');
    // Should not cut mid-word of first line
    expect(result).toContain('line one');
  });
});

describe('formatNutrient', () => {
  it('formats integer kcal value', () => {
    expect(formatNutrient(563, 'kcal')).toBe('563 kcal');
  });

  it('formats decimal value with escaped period', () => {
    expect(formatNutrient(26.5, 'g')).toBe('26\\.5 g');
  });

  it('formats zero value', () => {
    expect(formatNutrient(0, 'g')).toBe('0 g');
  });

  it('formats another decimal correctly', () => {
    expect(formatNutrient(1.25, 'mg')).toBe('1\\.25 mg');
  });
});
