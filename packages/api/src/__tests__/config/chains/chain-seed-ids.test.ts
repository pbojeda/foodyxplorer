// Unit tests for chain-seed-ids.ts
//
// Pure in-memory validation — no DB, no network.
// Validates that SUBWAY_ES IDs exist and follow the allocation convention.

import { describe, it, expect } from 'vitest';
import { CHAIN_SEED_IDS } from '../../../config/chains/chain-seed-ids.js';

describe('CHAIN_SEED_IDS', () => {
  it('has SUBWAY_ES entry', () => {
    expect(CHAIN_SEED_IDS.SUBWAY_ES).toBeDefined();
  });

  it('SUBWAY_ES RESTAURANT_ID follows segment-6 pattern', () => {
    expect(CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID).toBe('00000000-0000-0000-0006-000000000015');
  });

  it('SUBWAY_ES SOURCE_ID follows segment-0 pattern', () => {
    expect(CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID).toBe('00000000-0000-0000-0000-000000000015');
  });

  it('SUBWAY_ES RESTAURANT_ID is a valid UUID format', () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(uuidPattern.test(CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID)).toBe(true);
  });

  it('SUBWAY_ES SOURCE_ID is a valid UUID format', () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(uuidPattern.test(CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID)).toBe(true);
  });

  it('all RESTAURANT_IDs across all chains are unique', () => {
    const ids = Object.values(CHAIN_SEED_IDS).map((c) => c.RESTAURANT_ID);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all SOURCE_IDs across all chains are unique', () => {
    const ids = Object.values(CHAIN_SEED_IDS).map((c) => c.SOURCE_ID);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
