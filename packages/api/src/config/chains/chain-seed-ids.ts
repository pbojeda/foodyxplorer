/**
 * Deterministic UUID constants for chain restaurant and dataSource rows.
 * These IDs are used in both seed.ts (to create the rows) and
 * chain-pdf-registry.ts (to reference them in config entries).
 *
 * ID allocation convention (consistent with existing seed.ts UUIDs):
 *   - restaurants: segment 6 (00000000-0000-0000-0006-xxxxxxxxxxxx)
 *   - data_sources: segment 0 (00000000-0000-0000-0000-xxxxxxxxxxxx)
 *
 * Existing seed.ts uses IDs in ranges ...0001 to ...0009 for segment 6
 * (restaurants) and ...0001 to ...0002 for segment 0 (data_sources).
 * The new IDs start at ...0010 to avoid collisions.
 */
export const CHAIN_SEED_IDS = {
  BURGER_KING_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000010',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000010',
  },
  KFC_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000011',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000011',
  },
  TELEPIZZA_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000012',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000012',
  },
  FIVE_GUYS_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000013',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000013',
  },
  DOMINOS_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000014',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000014',
  },
  SUBWAY_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000015',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000015',
  },
  PANS_AND_COMPANY_ES: {
    RESTAURANT_ID: '00000000-0000-0000-0006-000000000016',
    SOURCE_ID:     '00000000-0000-0000-0000-000000000016',
  },
} as const;
