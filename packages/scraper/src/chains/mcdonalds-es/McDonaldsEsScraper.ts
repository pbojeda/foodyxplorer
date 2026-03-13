// McDonald's Spain chain scraper.
//
// Extends BaseScraper with:
//   - getMenuUrls(page): discovers all product URLs from the menu index.
//   - extractDishes(page): extracts nutritional data from a single product page.
//   - persistDish(dish): delegates to persistDishUtil (shared persistence utility).
//
// Data extraction uses JSON-LD as the primary source, with HTML table fallback.

import type { Page } from 'playwright';
import { BaseScraper } from '../../base/BaseScraper.js';
import { ScraperStructureError } from '../../base/errors.js';
import type { RawDishData, NormalizedDishData, ScraperConfig } from '../../base/types.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { persistDishUtil } from '../../utils/persist.js';
import { MCDONALDS_ES_CONFIG } from './config.js';
import { parseJsonLd, isComplete } from './jsonLdParser.js';
import { extractNutritionTable } from './tableExtractor.js';

// ---------------------------------------------------------------------------
// Product URL pattern for McDonald's Spain
// ---------------------------------------------------------------------------

const PRODUCT_URL_PATTERN = /\/es\/es-es\/product\/[^/]+\.html$/;

// ---------------------------------------------------------------------------
// McDonaldsEsScraper
// ---------------------------------------------------------------------------

export class McDonaldsEsScraper extends BaseScraper {
  /** Static config — used by the registry to register this chain without instantiation. */
  static readonly CONFIG: ScraperConfig = MCDONALDS_ES_CONFIG;

  constructor(config: ScraperConfig = McDonaldsEsScraper.CONFIG) {
    super(config);
  }

  // -------------------------------------------------------------------------
  // getMenuUrls — Phase 1 of the scrape lifecycle
  // -------------------------------------------------------------------------

  /**
   * Discovers all product URLs from the McDonald's Spain menu index page.
   *
   * Waits for the product card grid, collects all matching hrefs,
   * deduplicates them, filters to product URLs only, and prepends baseUrl
   * to relative hrefs.
   *
   * @throws ScraperStructureError if the product list selector is not found
   *         within 15 seconds.
   */
  override async getMenuUrls(page: Page): Promise<string[]> {
    try {
      await page.waitForSelector('.cmp-product-list__item a', { timeout: 15_000 });
    } catch {
      throw new ScraperStructureError(
        'Product list selector not found on menu page — site structure may have changed',
      );
    }

    const hrefs = await page.$$eval(
      '.cmp-product-list__item a',
      (els) => els.map((el) => (el as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => h !== null),
    );

    // Filter to product URLs only, deduplicate, and prepend baseUrl if relative
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const href of hrefs) {
      if (!PRODUCT_URL_PATTERN.test(href) && !PRODUCT_URL_PATTERN.test(href.replace(this.config.baseUrl, ''))) {
        continue;
      }

      const absolute = href.startsWith('http') ? href : `${this.config.baseUrl}${href}`;

      if (!seen.has(absolute)) {
        seen.add(absolute);
        urls.push(absolute);
      }
    }

    return urls;
  }

  // -------------------------------------------------------------------------
  // extractDishes — Phase 2 of the scrape lifecycle
  // -------------------------------------------------------------------------

  /**
   * Extracts nutritional data from a single McDonald's Spain product page.
   *
   * Steps:
   * 1. Dismiss cookie consent banner (non-fatal).
   * 2. Extract product name (fatal if missing).
   * 3. Extract externalId from URL slug.
   * 4. Try JSON-LD extraction; fall back to HTML table if absent/incomplete.
   * 5. Extract optional fields (description, portionGrams, priceEur, category).
   * 6. Return a single-element RawDishData array.
   *
   * @throws ScraperStructureError if the product name heading is not found.
   */
  override async extractDishes(page: Page): Promise<RawDishData[]> {
    // Step 1: Cookie consent banner (non-fatal)
    try {
      await page.locator('[data-testid="cookie-consent-accept"]').click({ timeout: 3_000 });
    } catch {
      // Banner not present or click failed — continue
    }

    // Step 2: Product name (required)
    let name: string;
    try {
      const rawName = await page.$eval(
        'h1.cmp-product-details-main__heading',
        (el) => el.textContent?.trim() ?? '',
      );
      if (!rawName) {
        throw new ScraperStructureError('Product name heading is empty');
      }
      name = rawName;
    } catch (err) {
      if (err instanceof ScraperStructureError) throw err;
      throw new ScraperStructureError('Product name heading not found on page');
    }

    // Step 3: externalId from URL slug
    const slugMatch = page.url().match(/\/product\/([^/]+)\.html$/);
    const externalId = slugMatch?.[1];

    // Step 4: Nutritional data — JSON-LD first, table fallback
    let nutrients: Partial<RawDishData['nutrients']> = {};

    let ldRaw: string | null = null;
    try {
      ldRaw = await page.$eval(
        'script[type="application/ld+json"]',
        (el) => el.textContent ?? null,
      );
    } catch {
      ldRaw = null;
    }

    const jsonLdNutrients = ldRaw !== null ? parseJsonLd(ldRaw) : null;

    if (jsonLdNutrients !== null && isComplete(jsonLdNutrients)) {
      nutrients = jsonLdNutrients;
    } else {
      // Fall back to HTML table
      console.warn(
        `[McDonaldsEsScraper] JSON-LD absent or incomplete for "${name}" — falling back to HTML table`,
      );
      const tableNutrients = await extractNutritionTable(page);
      // Merge: JSON-LD values take precedence for any fields present
      nutrients = {
        ...tableNutrients,
        ...(jsonLdNutrients ?? {}),
      };
    }

    // Step 5: Optional fields
    let description: string | undefined;
    try {
      description = await page.$eval(
        '.cmp-product-details-main__description',
        (el) => el.textContent?.trim() ?? undefined,
      );
    } catch {
      // Optional — ignore
    }

    let portionGrams: number | undefined;
    try {
      const servingRaw = await page.$eval(
        '.cmp-nutrition-summary__serving',
        (el) => el.textContent?.trim() ?? '',
      );
      // Parse formats: "210 g", "Ración: 210 g", "210g"
      const portionMatch = servingRaw.match(/(\d+(?:\.\d+)?)\s*g/i);
      if (portionMatch?.[1] !== undefined) {
        portionGrams = parseFloat(portionMatch[1]);
      }
    } catch {
      // Optional — ignore
    }

    let priceEur: number | undefined;
    try {
      const priceRaw = await page.$eval(
        '.cmp-product-details-main__price',
        (el) => el.textContent?.trim() ?? '',
      );
      if (priceRaw) {
        // Comma-decimal: "5,49 €" → 5.49. Do NOT use coerceNutrient (strips comma incorrectly).
        const parsed = parseFloat(priceRaw.replace(',', '.').replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed)) {
          priceEur = parsed;
        }
      }
    } catch {
      // Optional — ignore
    }

    let category: string | undefined;
    try {
      category = await page.$eval(
        '.cmp-breadcrumb a:nth-child(2)',
        (el) => el.textContent?.trim() ?? undefined,
      );
    } catch {
      // Optional — ignore
    }

    // Step 6: Compose RawDishData
    const rawDish: RawDishData = {
      externalId,
      name,
      nameEs: name,  // McDonald's Spain publishes in Spanish — name IS nameEs
      description,
      category,
      portionGrams,
      priceEur,
      aliases: [],
      nutrients,
      sourceUrl: page.url(),
      scrapedAt: new Date().toISOString(),
    };

    return [rawDish];
  }

  // -------------------------------------------------------------------------
  // persistDish — override with real Prisma upsert
  // -------------------------------------------------------------------------

  /**
   * Persists a normalized dish to the database via the shared utility.
   * Delegates entirely to persistDishUtil — no chain-specific logic.
   *
   * @throws Re-throws any Prisma errors — BaseScraper catches and increments dishesSkipped.
   */
  protected override async persistDish(dish: NormalizedDishData): Promise<void> {
    await persistDishUtil(getPrismaClient(), dish);
  }
}
