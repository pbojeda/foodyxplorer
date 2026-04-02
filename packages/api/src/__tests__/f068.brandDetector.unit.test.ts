// F068 — Brand Detector Unit Tests
//
// Tests for detectExplicitBrand() — pure function, no DB required.

import { describe, it, expect } from 'vitest';
import { detectExplicitBrand } from '../estimation/brandDetector.js';

const CHAIN_SLUGS = [
  'mcdonalds-es',
  'burger-king-es',
  'kfc-es',
  'telepizza-es',
  'subway-es',
  'dominos-es',
  'five-guys-es',
  'pans-and-company-es',
];

describe('detectExplicitBrand', () => {
  // -----------------------------------------------------------------------
  // Supermarket brands
  // -----------------------------------------------------------------------

  describe('supermarket brands', () => {
    it('detects "hacendado" in query', () => {
      const result = detectExplicitBrand('tortilla hacendado', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('hacendado');
    });

    it('detects "mercadona" in query', () => {
      const result = detectExplicitBrand('pizza mercadona', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('mercadona');
    });

    it('detects "de mercadona" pattern', () => {
      const result = detectExplicitBrand('tortilla de mercadona', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
    });

    it('detects "carrefour" in query', () => {
      const result = detectExplicitBrand('yogur carrefour', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('carrefour');
    });

    it('detects "lidl" in query', () => {
      const result = detectExplicitBrand('pan lidl', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('lidl');
    });

    it('detects "eroski" in query', () => {
      const result = detectExplicitBrand('leche eroski', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('eroski');
    });

    it('is case-insensitive', () => {
      const result = detectExplicitBrand('Tortilla HACENDADO', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('hacendado');
    });
  });

  // -----------------------------------------------------------------------
  // Chain slugs
  // -----------------------------------------------------------------------

  describe('chain slug detection', () => {
    it('detects "mcdonalds" from chain slug', () => {
      const result = detectExplicitBrand('big mac mcdonalds', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('mcdonalds-es');
    });

    it('detects "burger king" with spaces', () => {
      const result = detectExplicitBrand('whopper burger king', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('burger-king-es');
    });

    it('detects "kfc" from chain slug', () => {
      const result = detectExplicitBrand('pollo kfc', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('kfc-es');
    });

    it('detects "telepizza" from chain slug', () => {
      const result = detectExplicitBrand('pizza telepizza', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('telepizza-es');
    });

    it('detects "subway" from chain slug', () => {
      const result = detectExplicitBrand('sub subway', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('subway-es');
    });
  });

  // -----------------------------------------------------------------------
  // No brand (generic queries)
  // -----------------------------------------------------------------------

  describe('generic queries — no brand', () => {
    it('returns false for generic dish query', () => {
      const result = detectExplicitBrand('tortilla de patatas', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
      expect(result.detectedBrand).toBeUndefined();
    });

    it('returns false for simple food query', () => {
      const result = detectExplicitBrand('arroz blanco', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });

    it('returns false for recipe-style query', () => {
      const result = detectExplicitBrand('lentejas con chorizo', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });

    it('returns false for empty chain slugs list', () => {
      const result = detectExplicitBrand('big mac mcdonalds', []);
      // Only chain slug brands would match here, and list is empty
      // But "mcdonalds" is not in supermarket list, so should be false
      expect(result.hasExplicitBrand).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // False positive prevention
  // -----------------------------------------------------------------------

  describe('false positive prevention', () => {
    it('does NOT match "dia" in "diablo"', () => {
      const result = detectExplicitBrand('salsa diablo', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });

    it('does NOT match "dia" in "media"', () => {
      const result = detectExplicitBrand('media ración de tortilla', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });

    it('does NOT match "aldi" in "ribaldi"', () => {
      const result = detectExplicitBrand('pasta ribaldi', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });

    it('DOES match "dia" as standalone word', () => {
      const result = detectExplicitBrand('yogur dia', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
      expect(result.detectedBrand).toBe('dia');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles leading/trailing whitespace', () => {
      const result = detectExplicitBrand('  tortilla hacendado  ', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
    });

    it('handles mixed case brands', () => {
      const result = detectExplicitBrand('Pizza TELEPIZZA grande', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
    });

    it('handles brand at start of query', () => {
      const result = detectExplicitBrand('hacendado tortilla', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
    });

    it('handles brand as only word', () => {
      const result = detectExplicitBrand('hacendado', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(true);
    });

    it('handles empty query', () => {
      const result = detectExplicitBrand('', CHAIN_SLUGS);
      expect(result.hasExplicitBrand).toBe(false);
    });
  });
});
