// Chain scraper registry.
//
// Maps chainSlug strings to { config, ScraperClass } entries. Each chain
// scraper (F008–F017) adds its entry here.
//
// The runner (runner.ts) looks up the requested chain by slug and instantiates
// the appropriate scraper class using the stored constructor reference.

import type { ScraperConfig } from './base/types.js';
import type { BaseScraper } from './base/BaseScraper.js';
import { McDonaldsEsScraper } from './chains/mcdonalds-es/McDonaldsEsScraper.js';

/**
 * Concrete scraper constructor type — a class that extends BaseScraper and
 * can be instantiated with a ScraperConfig. TypeScript requires a concrete
 * (non-abstract) constructor to call `new`. The type parameter is kept
 * compatible with BaseScraper via the return type.
 */
export type ConcreteScraperConstructor = new (config: ScraperConfig) => BaseScraper;

/** Maps chainSlug → { config, ScraperClass } for all registered chain scrapers. */
export type ScraperRegistry = Record<string, {
  config: ScraperConfig;
  ScraperClass: ConcreteScraperConstructor;
}>;

/**
 * Static registry of all registered chain scrapers.
 * F009–F017 will each add an entry to this map.
 */
export const registry: ScraperRegistry = {
  'mcdonalds-es': {
    config: McDonaldsEsScraper.CONFIG,
    ScraperClass: McDonaldsEsScraper,
  },
};
