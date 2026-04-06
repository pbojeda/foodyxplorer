/**
 * F080 — Brand Alias Unit Tests
 *
 * Tests for SUPERMARKET_BRAND_ALIASES and resolveAliases().
 */
import { describe, it, expect } from 'vitest';
import { resolveAliases, detectExplicitBrand } from '../estimation/brandDetector.js';

describe('resolveAliases', () => {
  it('resolves "mercadona" to ["hacendado", "mercadona"]', () => {
    const result = resolveAliases('mercadona');
    expect(result).toEqual(['hacendado', 'mercadona']);
  });

  it('resolves "hacendado" to ["hacendado"] (single entry — own brand)', () => {
    const result = resolveAliases('hacendado');
    expect(result).toEqual(['hacendado']);
  });

  it('resolves "lidl" to ["lidl"] (no alias map entry)', () => {
    const result = resolveAliases('lidl');
    expect(result).toEqual(['lidl']);
  });

  it('resolves unknown brand to array with just itself (passthrough)', () => {
    const result = resolveAliases('unknownbrand');
    expect(result).toEqual(['unknownbrand']);
  });

  it('resolves "carrefour" to ["carrefour"] (not in alias map)', () => {
    const result = resolveAliases('carrefour');
    expect(result).toEqual(['carrefour']);
  });
});

describe('detectExplicitBrand', () => {
  it('still returns detectedBrand="mercadona" for "tortilla mercadona"', () => {
    const result = detectExplicitBrand('tortilla mercadona', []);
    expect(result.hasExplicitBrand).toBe(true);
    expect(result.detectedBrand).toBe('mercadona');
  });

  it('still returns detectedBrand="hacendado" for "tortilla hacendado"', () => {
    const result = detectExplicitBrand('tortilla hacendado', []);
    expect(result.hasExplicitBrand).toBe(true);
    expect(result.detectedBrand).toBe('hacendado');
  });
});
