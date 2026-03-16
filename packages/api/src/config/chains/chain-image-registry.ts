// Chain Image Registry — static TypeScript array of ChainImageConfig entries.
//
// Each entry maps an image-only Spanish fast-food chain to its nutritional
// image URL(s). Config is intentionally static (not a DB table or JSON file):
// compile-time type safety, no migration needed to add a new chain.
//
// Key difference from chain-pdf-registry.ts: imageUrls is an array (plural)
// because a chain may spread nutritional data across multiple images
// (e.g., one image per product category). The batch runner iterates imageUrls
// for each chain entry, calling POST /ingest/image-url once per URL.
//
// To add a new chain: append a new entry and run seed.ts to create the
// corresponding restaurant + dataSource rows with deterministic UUIDs.

import { z } from 'zod';
import { CHAIN_SEED_IDS } from './chain-seed-ids.js';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const ChainImageConfigSchema = z.object({
  chainSlug:       z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name:            z.string().min(1).max(255),
  countryCode:     z.string().length(2).regex(/^[A-Z]{2}$/),
  imageUrls:       z.array(z.string().max(2048).url().startsWith('https://')).min(1),
  restaurantId:    z.string().uuid(),
  sourceId:        z.string().uuid(),
  updateFrequency: z.enum(['static', 'monthly', 'quarterly', 'yearly', 'unknown']),
  enabled:         z.boolean(),
  notes:           z.string().optional(),
});

// ---------------------------------------------------------------------------
// TypeScript type (inferred from Zod schema)
// ---------------------------------------------------------------------------

export type ChainImageConfig = z.infer<typeof ChainImageConfigSchema>;

// ---------------------------------------------------------------------------
// Registry — 1 initial entry: Domino's Spain
// ---------------------------------------------------------------------------

export const CHAIN_IMAGE_REGISTRY: ChainImageConfig[] = [
  {
    chainSlug:       'dominos-es',
    name:            "Domino's Spain",
    countryCode:     'ES',
    imageUrls:       [
      'https://alergenos.dominospizza.es/img/tabla_nutricional.jpg',
    ],
    restaurantId:    CHAIN_SEED_IDS.DOMINOS_ES.RESTAURANT_ID,
    sourceId:        CHAIN_SEED_IDS.DOMINOS_ES.SOURCE_ID,
    updateFrequency: 'unknown',
    enabled:         true,
    notes:           "OCR-based source (JPEG images, not PDF). URL pattern: alergenos.dominospizza.es/img/. Verify URLs before each run — Domino's may update image paths.",
  },
];
