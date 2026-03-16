// McDonald's Spain static scraper configuration.
//
// Lazy-evaluated via getMcdonaldsEsConfig() to avoid top-level parse() that
// crashes when MCDONALDS_ES_RESTAURANT_ID / MCDONALDS_ES_SOURCE_ID env vars
// are not set (e.g. when @foodxplorer/scraper is imported transitively by
// packages/api tests that only need normalize utilities).

import type { ScraperConfig } from '../../base/types.js';
import { ScraperConfigSchema } from '../../base/types.js';

let _config: ScraperConfig | undefined;

export function getMcdonaldsEsConfig(): ScraperConfig {
  if (_config === undefined) {
    _config = ScraperConfigSchema.parse({
      chainSlug:    'mcdonalds-es',
      restaurantId: process.env['MCDONALDS_ES_RESTAURANT_ID']!,
      sourceId:     process.env['MCDONALDS_ES_SOURCE_ID']!,
      baseUrl:      'https://www.mcdonalds.com',
      startUrls:    ['https://www.mcdonalds.com/es/es-es/menu.html'],
      rateLimit: {
        requestsPerMinute: 8,
        concurrency: 1,
      },
      retryPolicy: {
        maxRetries: 3,
        backoffMs: 2000,
        backoffMultiplier: 2,
      },
      selectors: {
        productList:    '.cmp-product-list__item a',
        productName:    'h1.cmp-product-details-main__heading',
        description:    '.cmp-product-details-main__description',
        servingSize:    '.cmp-nutrition-summary__serving',
        price:          '.cmp-product-details-main__price',
        nutritionTable: '.cmp-nutrition-summary__table tr',
        cookieConsent:  '[data-testid="cookie-consent-accept"]',
        jsonLd:         'script[type="application/ld+json"]',
      },
      headless: true,
      locale:   'es-ES',
    });
  }
  return _config;
}

/** @deprecated Use getMcdonaldsEsConfig() instead. Kept for backward compat. */
export const MCDONALDS_ES_CONFIG = new Proxy({} as ScraperConfig, {
  get(_target, prop) {
    return getMcdonaldsEsConfig()[prop as keyof ScraperConfig];
  },
});
