// Chain PDF Registry — static TypeScript array of ChainPdfConfig entries.
//
// Each entry maps a PDF-only Spanish fast-food chain to its nutrition PDF URL.
// Config is intentionally static (not a DB table or JSON file): compile-time
// type safety, no migration needed to add a new chain.
//
// To add a new chain: append a new entry and run seed.ts to create the
// corresponding restaurant + dataSource rows with deterministic UUIDs.

import { z } from 'zod';
import { CHAIN_SEED_IDS } from './chain-seed-ids.js';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const ChainPdfConfigSchema = z.object({
  chainSlug:       z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name:            z.string().min(1).max(255),
  countryCode:     z.string().length(2).regex(/^[A-Z]{2}$/),
  pdfUrl:          z.string().max(2048).url().startsWith('https://'),
  restaurantId:    z.string().uuid(),
  sourceId:        z.string().uuid(),
  updateFrequency: z.enum(['static', 'monthly', 'quarterly', 'yearly', 'unknown']),
  enabled:         z.boolean(),
  notes:           z.string().optional(),
});

// ---------------------------------------------------------------------------
// TypeScript type (inferred from Zod schema)
// ---------------------------------------------------------------------------

export type ChainPdfConfig = z.infer<typeof ChainPdfConfigSchema>;

// ---------------------------------------------------------------------------
// Registry — 6 entries: BK, KFC, Telepizza, Five Guys, Subway, Pans & Company (Spain)
// ---------------------------------------------------------------------------

export const CHAIN_PDF_REGISTRY: ChainPdfConfig[] = [
  {
    chainSlug:       'burger-king-es',
    name:            'Burger King Spain',
    countryCode:     'ES',
    pdfUrl:          'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2026/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+FEB2026.pdf',
    restaurantId:    CHAIN_SEED_IDS.BURGER_KING_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.BURGER_KING_ES.SOURCE_ID,
    updateFrequency: 'monthly',
    enabled:         true,
    notes:           'URL changes monthly. Pattern: /en-ES/YYYY/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+[MON][YYYY].pdf. Verify URL before each run.',
  },
  {
    chainSlug:       'kfc-es',
    name:            'KFC Spain',
    countryCode:     'ES',
    pdfUrl:          'https://static.kfc.es/pdf/contenido-nutricional.pdf',
    restaurantId:    CHAIN_SEED_IDS.KFC_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.KFC_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Static URL — stable across updates. KFC overwrites the same file path.',
  },
  {
    chainSlug:       'telepizza-es',
    name:            'Telepizza Spain',
    countryCode:     'ES',
    pdfUrl:          'https://statices.telepizza.com/static/on/demandware.static/-/Sites-TelepizzaES-Library/default/dw21878fcd/documents/nutricion.pdf',
    restaurantId:    CHAIN_SEED_IDS.TELEPIZZA_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.TELEPIZZA_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Salesforce CDN. URL may change on site rebuild. Verify if FETCH_FAILED occurs.',
  },
  {
    chainSlug:       'five-guys-es',
    name:            'Five Guys Spain',
    countryCode:     'ES',
    pdfUrl:          'https://fiveguys.es/app/uploads/sites/6/2026/02/FGES_ES_allergen-ingredients_print-SP_A4_20260303.pdf',
    restaurantId:    CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         false,
    notes:           'PDF contains allergen/ingredient list only — no calorie or macro data. Re-enable when a nutritional PDF is found. URL pattern: fiveguys.es/app/uploads/sites/6/YYYY/MM/...',
  },
  {
    chainSlug:       'subway-es',
    name:            'Subway Spain',
    countryCode:     'ES',
    pdfUrl:          'https://subwayspain.com/images/pdfs/nutricional/MED_Nutritional_Information_C4_2025_FINAL_English.pdf',
    restaurantId:    CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID,
    updateFrequency: 'quarterly',
    enabled:         true,
    notes:           'URL pattern: MED_Nutritional_Information_CX_YYYY_FINAL_English.pdf. Quarterly cycle (C1-C4). Also available in Spanish and Catalan.',
  },
  {
    chainSlug:       'pans-and-company-es',
    name:            'Pans & Company Spain',
    countryCode:     'ES',
    pdfUrl:          'https://www.vivabem.pt/tabelas/tabela_pans_company.pdf',
    restaurantId:    CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Served from Ibersol parent company portal (vivabem.pt). PDF is in Portuguese — product names are in Portuguese. Custom preprocessor (preprocessPansAndCompanyEs) required: pdf-parse separates product names from nutritional data due to the multi-column layout.',
  },
];
