// Chain scraper registry.
//
// Maps chainSlug strings to ScraperConfig objects. Empty in F007 — each
// chain scraper (F008–F017) adds its entry here.
//
// The runner (runner.ts) looks up the requested chain by slug and instantiates
// the appropriate scraper class.

import type { ScraperConfig } from './base/types.js';

/** Maps chainSlug → ScraperConfig for all registered chain scrapers. */
export type ScraperRegistry = Record<string, ScraperConfig>;

/**
 * Static registry of all registered chain scrapers.
 * F008–F017 will each add an entry to this map.
 */
export const registry: ScraperRegistry = {};
