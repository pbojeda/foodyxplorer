// Unit tests for chain-pdf-registry.ts
//
// Pure in-memory validation — no DB, no network.
// Validates all 4 registry entries through ChainPdfConfigSchema,
// asserts no duplicate slugs/IDs, and cross-references CHAIN_SEED_IDS.

import { describe, it, expect } from 'vitest';
import { ChainPdfConfigSchema, CHAIN_PDF_REGISTRY } from '../../../config/chains/chain-pdf-registry.js';
import { CHAIN_SEED_IDS } from '../../../config/chains/chain-seed-ids.js';

describe('CHAIN_PDF_REGISTRY', () => {
  it('has exactly 4 entries', () => {
    expect(CHAIN_PDF_REGISTRY).toHaveLength(4);
  });

  it('each entry parses through ChainPdfConfigSchema without errors', () => {
    for (const entry of CHAIN_PDF_REGISTRY) {
      expect(() => ChainPdfConfigSchema.parse(entry)).not.toThrow();
    }
  });

  it('has no duplicate chainSlug values', () => {
    const slugs = CHAIN_PDF_REGISTRY.map((c) => c.chainSlug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it('has no duplicate restaurantId values', () => {
    const ids = CHAIN_PDF_REGISTRY.map((c) => c.restaurantId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has no duplicate sourceId values', () => {
    const ids = CHAIN_PDF_REGISTRY.map((c) => c.sourceId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all pdfUrl values start with https://', () => {
    for (const entry of CHAIN_PDF_REGISTRY) {
      expect(entry.pdfUrl).toMatch(/^https:\/\//);
    }
  });

  it('all chainSlug values match ^[a-z0-9-]+$', () => {
    const pattern = /^[a-z0-9-]+$/;
    for (const entry of CHAIN_PDF_REGISTRY) {
      expect(pattern.test(entry.chainSlug)).toBe(true);
    }
  });

  it('countryCode is ES for all 4 initial entries', () => {
    for (const entry of CHAIN_PDF_REGISTRY) {
      expect(entry.countryCode).toBe('ES');
    }
  });

  it('all enabled entries have non-empty pdfUrl', () => {
    for (const entry of CHAIN_PDF_REGISTRY) {
      if (entry.enabled) {
        expect(entry.pdfUrl.length).toBeGreaterThan(0);
      }
    }
  });

  it('burger-king-es restaurantId matches CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'burger-king-es');
    expect(entry).toBeDefined();
    expect(entry?.restaurantId).toBe(CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID);
  });

  it('burger-king-es sourceId matches CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'burger-king-es');
    expect(entry?.sourceId).toBe(CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID);
  });

  it('kfc-es restaurantId matches CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'kfc-es');
    expect(entry).toBeDefined();
    expect(entry?.restaurantId).toBe(CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID);
  });

  it('kfc-es sourceId matches CHAIN_SEED_IDS.KFC_ES.SOURCE_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'kfc-es');
    expect(entry?.sourceId).toBe(CHAIN_SEED_IDS.KFC_ES.SOURCE_ID);
  });

  it('telepizza-es restaurantId matches CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'telepizza-es');
    expect(entry).toBeDefined();
    expect(entry?.restaurantId).toBe(CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID);
  });

  it('telepizza-es sourceId matches CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'telepizza-es');
    expect(entry?.sourceId).toBe(CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID);
  });

  it('five-guys-es restaurantId matches CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'five-guys-es');
    expect(entry).toBeDefined();
    expect(entry?.restaurantId).toBe(CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID);
  });

  it('five-guys-es sourceId matches CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID', () => {
    const entry = CHAIN_PDF_REGISTRY.find((c) => c.chainSlug === 'five-guys-es');
    expect(entry?.sourceId).toBe(CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID);
  });
});
