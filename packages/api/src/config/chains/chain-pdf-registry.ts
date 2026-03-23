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
// Registry — 11 entries: BK, KFC, Telepizza, Five Guys, Subway, Pans & Company,
//                        Popeyes, Papa John's, Pizza Hut, Starbucks, Tim Hortons (Spain)
// ---------------------------------------------------------------------------

export const CHAIN_PDF_REGISTRY: ChainPdfConfig[] = [
  {
    chainSlug:       'burger-king-es',
    name:            'Burger King Spain',
    countryCode:     'ES',
    pdfUrl:          'https://eu-west-3-146514239214-prod-bk-fz.s3.eu-west-3.amazonaws.com/en-ES/2025/Nutritional+Information/MANTEL+NUTRICIONAL+ESP+ING+DIC2025.pdf',
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
    pdfUrl:          'https://images.telepizza.com/vol/es/images/docs/nutricion.pdf',
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
    pdfUrl:          'https://fiveguys.es/app/uploads/sites/6/2024/10/FGES-Nutritional_SPANISH_221024.pdf',
    restaurantId:    CHAIN_SEED_IDS.FIVE_GUYS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.FIVE_GUYS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Oct 2024 nutritional-only PDF. Multi-line header format requires chain-specific preprocessor.',
  },
  {
    chainSlug:       'subway-es',
    name:            'Subway Spain',
    countryCode:     'ES',
    pdfUrl:          'https://subwayspain.com/images/pdfs/nutricional/MED_Spain_Nutritional_Information_C4_2025_FINAL.pdf',
    restaurantId:    CHAIN_SEED_IDS.SUBWAY_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.SUBWAY_ES.SOURCE_ID,
    updateFrequency: 'quarterly',
    enabled:         false,
    notes:           'Disabled — PDF format changed (fixed-column table with categories). Needs custom preprocessor. Re-enable after Phase 2 development.',
  },
  {
    chainSlug:       'pans-and-company-es',
    name:            'Pans & Company Spain',
    countryCode:     'ES',
    pdfUrl:          'https://www.vivabem.pt/tabelas/tabela_pans_company.pdf',
    restaurantId:    CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.PANS_AND_COMPANY_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         false,
    notes:           'Disabled — original PDF URL (vivabem.pt) is 404. Only allergen PDF available at pansandcompany.com. No consolidated nutritional PDF found. Re-enable when a nutritional PDF is located.',
  },
  {
    chainSlug:       'popeyes-es',
    name:            'Popeyes Spain',
    countryCode:     'ES',
    pdfUrl:          'https://popeyes-prod.s3.eu-west-1.amazonaws.com/Nutricional_alergenos_Ed_00_Octubre_2021.pdf',
    restaurantId:    CHAIN_SEED_IDS.POPEYES_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.POPEYES_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'PDF from October 2021 — may be outdated. Only version publicly available. S3 hosted.',
  },
  {
    chainSlug:       'papa-johns-es',
    name:            "Papa John's Spain",
    countryCode:     'ES',
    pdfUrl:          'https://cdn.new.papajohns.es/Alergenos+Espa%C3%B1a/Inf_NutricionalEspa%C3%B1a+Ed+27.pdf',
    restaurantId:    CHAIN_SEED_IDS.PAPA_JOHNS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.PAPA_JOHNS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'CDN URL, edition 27. URL may change with new editions.',
  },
  {
    chainSlug:       'pizza-hut-es',
    name:            'Pizza Hut Spain',
    countryCode:     'ES',
    pdfUrl:          'https://s4d-mth-prd-01-ph-es-ecom-cms-cdne.azureedge.net/ecom-cms/assets/nutricion_ph26_89a1ae2af8.pdf',
    restaurantId:    CHAIN_SEED_IDS.PIZZA_HUT_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.PIZZA_HUT_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Azure CDN. URL contains hash — may change on content update.',
  },
  {
    chainSlug:       'starbucks-es',
    name:            'Starbucks Spain',
    countryCode:     'ES',
    pdfUrl:          'https://www.starbucks.es/sites/starbucks-es-pwa/files/2025-03/250306%20FOOD%20Info%20nutricional%20x%20100g%20%20Spring%20-ESP%20V1.pdf',
    restaurantId:    CHAIN_SEED_IDS.STARBUCKS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.STARBUCKS_ES.SOURCE_ID,
    updateFrequency: 'quarterly',
    enabled:         true,
    notes:           'Spring 2025 food nutritional info per 100g. Server rejects HEAD requests (405). Seasonal updates expected.',
  },
  {
    chainSlug:       'tim-hortons-es',
    name:            'Tim Hortons Spain',
    countryCode:     'ES',
    pdfUrl:          'https://www.tim-hortons.es/docs/Nutricionales.TH.ES.pdf',
    restaurantId:    CHAIN_SEED_IDS.TIM_HORTONS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.TIM_HORTONS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           'Static URL on official site. Relatively new chain in Spain.',
  },
];
