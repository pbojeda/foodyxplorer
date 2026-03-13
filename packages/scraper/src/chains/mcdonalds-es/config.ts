// McDonald's Spain static scraper configuration.
//
// Evaluated at module import time via ScraperConfigSchema.parse().
// MCDONALDS_ES_RESTAURANT_ID and MCDONALDS_ES_SOURCE_ID must be set in
// the environment before this module is imported. In tests, vitest.config.ts
// provides stub UUIDs so the parse() does not throw.

import { ScraperConfigSchema } from '../../base/types.js';

export const MCDONALDS_ES_CONFIG = ScraperConfigSchema.parse({
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
