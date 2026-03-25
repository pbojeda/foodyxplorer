// Unit tests for F038 — chainLocaleRegistry
//
// Verifies CHAIN_SOURCE_LOCALE mappings and getChainSourceLocale() helper.

import { describe, it, expect } from 'vitest';
import {
  CHAIN_SOURCE_LOCALE,
  getChainSourceLocale,
} from '../ingest/chainLocaleRegistry.js';
import { CHAIN_PDF_REGISTRY } from '../config/chains/chain-pdf-registry.js';

describe('getChainSourceLocale', () => {
  it('returns "en" for known English chain burger-king-es', () => {
    expect(getChainSourceLocale('burger-king-es')).toBe('en');
  });

  it('returns "en" for known English chain kfc-es', () => {
    expect(getChainSourceLocale('kfc-es')).toBe('en');
  });

  it('returns "en" for known English chain five-guys-es', () => {
    expect(getChainSourceLocale('five-guys-es')).toBe('en');
  });

  it('returns "en" for known English chain subway-es', () => {
    expect(getChainSourceLocale('subway-es')).toBe('en');
  });

  it('returns "en" for known English chain mcdonalds-es', () => {
    expect(getChainSourceLocale('mcdonalds-es')).toBe('en');
  });

  it('returns "es" for known Spanish chain telepizza-es', () => {
    expect(getChainSourceLocale('telepizza-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain pans-and-company-es', () => {
    expect(getChainSourceLocale('pans-and-company-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain dominos-es', () => {
    expect(getChainSourceLocale('dominos-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain popeyes-es', () => {
    expect(getChainSourceLocale('popeyes-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain papa-johns-es', () => {
    expect(getChainSourceLocale('papa-johns-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain pizza-hut-es', () => {
    expect(getChainSourceLocale('pizza-hut-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain starbucks-es', () => {
    expect(getChainSourceLocale('starbucks-es')).toBe('es');
  });

  it('returns "es" for known Spanish chain tim-hortons-es', () => {
    expect(getChainSourceLocale('tim-hortons-es')).toBe('es');
  });

  it('returns "unknown" for an unknown chain slug', () => {
    expect(getChainSourceLocale('unknown-chain-xyz')).toBe('unknown');
  });

  it('returns "unknown" for undefined slug', () => {
    expect(getChainSourceLocale(undefined)).toBe('unknown');
  });
});

describe('CHAIN_SOURCE_LOCALE coverage', () => {
  it('every chain in CHAIN_PDF_REGISTRY has an entry in CHAIN_SOURCE_LOCALE', () => {
    for (const chain of CHAIN_PDF_REGISTRY) {
      expect(
        CHAIN_SOURCE_LOCALE,
        `Missing entry for chainSlug: ${chain.chainSlug}`,
      ).toHaveProperty(chain.chainSlug);
    }
  });
});
