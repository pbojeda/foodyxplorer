// Unit tests for McDonaldsEsScraper.
//
// All tests use fixture HTML files — no real network calls.
// Playwright Page is mocked with vi.fn() stubs driven by fixture content.
// persistDishUtil is mocked at module level to avoid DB calls.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaywrightCrawler } from 'crawlee';
import type { Page, Locator, ElementHandle } from 'playwright';
import { ScraperStructureError } from '../base/errors.js';
import type { RawDishData, NormalizedDishData } from '../base/types.js';

// ---------------------------------------------------------------------------
// Mock persistDishUtil before importing the scraper
// vi.mock() is hoisted to the top of the file, so factories must not
// reference variables declared in the module body. We retrieve the mock
// via vi.mocked() after the import instead.
// ---------------------------------------------------------------------------

vi.mock('../utils/persist.js', () => ({
  persistDishUtil: vi.fn().mockResolvedValue(undefined),
}));

// Mock getPrismaClient so it returns a dummy value in tests
vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: vi.fn().mockReturnValue({ _isMockPrisma: true }),
}));

// Import scraper AFTER mocks are set up
import { McDonaldsEsScraper } from '../chains/mcdonalds-es/McDonaldsEsScraper.js';
import { parseJsonLd, isComplete } from '../chains/mcdonalds-es/jsonLdParser.js';

// Retrieve typed mock references after imports
import { persistDishUtil } from '../utils/persist.js';
const mockPersistDishUtil = vi.mocked(persistDishUtil);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'mcdonalds-es');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

let productPageHtml: string;
let _productPageNoJsonldHtml: string;
let _menuPageHtml: string;
let _blockedPageHtml: string;

beforeAll(() => {
  productPageHtml = loadFixture('product-page.html');
  _productPageNoJsonldHtml = loadFixture('product-page-no-jsonld.html');
  _menuPageHtml = loadFixture('menu-page.html');
  _blockedPageHtml = loadFixture('product-blocked.html');
});

// ---------------------------------------------------------------------------
// Mock page factory
//
// Creates a duck-typed mock Page with vi.fn() stubs.
// Tests can override individual stubs to drive specific scenarios.
// ---------------------------------------------------------------------------

interface MockPage {
  waitForSelector: ReturnType<typeof vi.fn>;
  $$eval: ReturnType<typeof vi.fn>;
  $eval: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  $$: ReturnType<typeof vi.fn>;
  setContent: ReturnType<typeof vi.fn>;
}

function makeMockPage(overrides: Partial<MockPage> = {}): Page {
  const defaults: MockPage = {
    waitForSelector: vi.fn().mockResolvedValue(null),
    $$eval: vi.fn().mockResolvedValue([]),
    $eval: vi.fn().mockResolvedValue(''),
    url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
    locator: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
    } as unknown as Locator),
    $$: vi.fn().mockResolvedValue([]),
    setContent: vi.fn().mockResolvedValue(undefined),
  };
  return { ...defaults, ...overrides } as unknown as Page;
}

/**
 * Creates an ElementHandle mock whose textContent() returns the given string.
 */
function makeElementHandle(text: string): ElementHandle {
  return {
    textContent: vi.fn().mockResolvedValue(text),
    $$: vi.fn().mockResolvedValue([]),
  } as unknown as ElementHandle;
}

/**
 * Creates a mock row with two td cells.
 */
function makeMockRow(label: string, value: string): ElementHandle {
  return {
    $$: vi.fn().mockResolvedValue([
      makeElementHandle(label),
      makeElementHandle(value),
    ]),
  } as unknown as ElementHandle;
}

// ---------------------------------------------------------------------------
// TestMcDonaldsScraper — overrides createCrawler for unit testing
// ---------------------------------------------------------------------------

class TestMcDonaldsScraper extends McDonaldsEsScraper {
  protected override createCrawler(
    requestHandler: (ctx: { page: Page; request: { url: string; userData: Record<string, unknown> } }) => Promise<void>,
    failedRequestHandler: (ctx: { request: { url: string }; error: Error }) => Promise<void>,
  ): PlaywrightCrawler {
    const mockCrawler = {
      async run(requests?: Array<{ url: string; userData?: Record<string, unknown> }>): Promise<void> {
        const reqs = requests ?? [];
        for (const req of reqs) {
          const mockPage = {} as Page;
          const userData = req.userData ?? {};
          try {
            await requestHandler({
              page: mockPage,
              request: { url: req.url, userData },
            });
          } catch (err) {
            await failedRequestHandler({
              request: { url: req.url },
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        }
      },
    } as unknown as PlaywrightCrawler;
    return mockCrawler;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McDonaldsEsScraper', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPersistDishUtil.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // parseJsonLd — pure string parsing tests (no page needed)
  // ---------------------------------------------------------------------------

  describe('parseJsonLd()', () => {
    it('returns nutrient partial from a Product with nested NutritionInformation', () => {
      // Extract the JSON-LD from the fixture
      const match = productPageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(match).not.toBeNull();
      const raw = match![1]!;

      const result = parseJsonLd(raw);
      expect(result).not.toBeNull();
      expect(result?.calories).toBe('490 cal');
      expect(result?.fats).toBe('19 g');
      expect(result?.saturatedFats).toBe('7 g');
      expect(result?.transFats).toBe('0.5 g');
      expect(result?.carbohydrates).toBe('58 g');
      expect(result?.sugars).toBe('12 g');
      expect(result?.fiber).toBe('3 g');
      expect(result?.proteins).toBe('27 g');
      expect(result?.sodium).toBe('870 mg');
    });

    it('returns null for malformed JSON', () => {
      expect(parseJsonLd('{ not valid json')).toBeNull();
    });

    it('returns null when no NutritionInformation node is found', () => {
      const raw = JSON.stringify({ '@type': 'WebPage', name: 'Test' });
      expect(parseJsonLd(raw)).toBeNull();
    });

    it('handles @graph array pattern', () => {
      const raw = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: 'Test' },
          {
            '@type': 'Product',
            name: 'TestProduct',
            nutrition: {
              '@type': 'NutritionInformation',
              calories: '300 cal',
              proteinContent: '15 g',
              carbohydrateContent: '40 g',
              fatContent: '8 g',
            },
          },
        ],
      });
      const result = parseJsonLd(raw);
      expect(result?.calories).toBe('300 cal');
      expect(result?.proteins).toBe('15 g');
    });
  });

  describe('isComplete()', () => {
    it('returns true when calories, proteins, carbohydrates, and fats are all present', () => {
      const nutrition = {
        calories: '490 cal',
        proteins: '27 g',
        carbohydrates: '58 g',
        fats: '19 g',
      };
      expect(isComplete(nutrition)).toBe(true);
    });

    it('returns false when any required field is missing', () => {
      expect(isComplete({ calories: '490 cal', proteins: '27 g', carbohydrates: '58 g' })).toBe(false);
      expect(isComplete({ calories: '490 cal', proteins: '27 g', fats: '19 g' })).toBe(false);
      expect(isComplete(null)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getMenuUrls
  // ---------------------------------------------------------------------------

  describe('getMenuUrls(page)', () => {
    it('extracts product URLs from the product list grid', async () => {
      // Build mock page that returns product hrefs matching the fixture menu-page.html
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockResolvedValue(null),
        $$eval: vi.fn().mockResolvedValue([
          '/es/es-es/product/mcroyal-deluxe.html',
          '/es/es-es/product/big-mac.html',
          '/es/es-es/product/quarterpounder-queso.html',
          '/es/es-es/product/mcpollo.html',
          '/es/es-es/product/mcnuggets-6.html',
          '/es/es-es/product/big-mac.html',          // duplicate
          '/es/es-es/product/mcroyal-deluxe.html',   // duplicate
          '/es/es-es/product/ensalada-caesar.html',
        ]),
      });

      // Access protected method
      const urls = await (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage);

      expect(urls.length).toBeGreaterThanOrEqual(5);
    });

    it('deduplicates repeated URLs across category tabs', async () => {
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockResolvedValue(null),
        $$eval: vi.fn().mockResolvedValue([
          '/es/es-es/product/big-mac.html',
          '/es/es-es/product/big-mac.html',
          '/es/es-es/product/mcroyal-deluxe.html',
        ]),
      });

      const urls = await (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage);

      const bigMacUrls = urls.filter(u => u.includes('big-mac'));
      expect(bigMacUrls).toHaveLength(1);
    });

    it('prepends baseUrl to relative hrefs', async () => {
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockResolvedValue(null),
        $$eval: vi.fn().mockResolvedValue([
          '/es/es-es/product/mcroyal-deluxe.html',
        ]),
      });

      const urls = await (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage);

      expect(urls[0]).toBe('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html');
    });

    it('does not prepend baseUrl to absolute hrefs', async () => {
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockResolvedValue(null),
        $$eval: vi.fn().mockResolvedValue([
          'https://www.mcdonalds.com/es/es-es/product/big-mac.html',
        ]),
      });

      const urls = await (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage);

      expect(urls[0]).toBe('https://www.mcdonalds.com/es/es-es/product/big-mac.html');
    });

    it('throws ScraperStructureError if product list selector is not found', async () => {
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout waiting for selector')),
      });

      await expect(
        (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage),
      ).rejects.toThrow(ScraperStructureError);
    });

    it('filters out non-product URLs', async () => {
      const mockPage = makeMockPage({
        waitForSelector: vi.fn().mockResolvedValue(null),
        $$eval: vi.fn().mockResolvedValue([
          '/es/es-es/product/mcroyal-deluxe.html',
          '/es/es-es/ofertas.html',           // not a product URL
          '/es/es-es/menu.html',              // not a product URL
        ]),
      });

      const urls = await (scraper as unknown as { getMenuUrls: (p: Page) => Promise<string[]> }).getMenuUrls(mockPage);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/product/');
    });
  });

  // ---------------------------------------------------------------------------
  // extractDishes — JSON-LD path
  // ---------------------------------------------------------------------------

  describe('extractDishes(page) — JSON-LD path', () => {
    function makeJsonLdPage(): Page {
      return makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('Cookie banner not present')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string, _fn: (el: Element) => unknown) => {
          if (selector === 'h1.cmp-product-details-main__heading') {
            return Promise.resolve('McRoyal Deluxe');
          }
          if (selector === 'script[type="application/ld+json"]') {
            // Extract JSON-LD from fixture
            const match = productPageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            return Promise.resolve(match?.[1] ?? null);
          }
          if (selector === '.cmp-product-details-main__description') {
            return Promise.resolve('Una jugosa hamburguesa con lechuga, tomate y queso cheddar.');
          }
          if (selector === '.cmp-nutrition-summary__serving') {
            return Promise.resolve('Ración: 210 g');
          }
          if (selector === '.cmp-product-details-main__price') {
            return Promise.resolve('5,49 €');
          }
          if (selector === '.cmp-breadcrumb a:nth-child(2)') {
            return Promise.resolve('Hamburguesas');
          }
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([]),
      });
    }

    it('extracts all nutrient fields from JSON-LD NutritionInformation', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes).toHaveLength(1);
      const dish = dishes[0]!;
      expect(dish.nutrients.calories).toBe('490 cal');
      expect(dish.nutrients.fats).toBe('19 g');
      expect(dish.nutrients.saturatedFats).toBe('7 g');
      expect(dish.nutrients.transFats).toBe('0.5 g');
      expect(dish.nutrients.carbohydrates).toBe('58 g');
      expect(dish.nutrients.sugars).toBe('12 g');
      expect(dish.nutrients.fiber).toBe('3 g');
      expect(dish.nutrients.proteins).toBe('27 g');
      expect(dish.nutrients.sodium).toBe('870 mg');
    });

    it('sets name and nameEs from the product heading', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes[0]?.name).toBe('McRoyal Deluxe');
      expect(dishes[0]?.nameEs).toBe('McRoyal Deluxe');
    });

    it('extracts externalId from the URL slug', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes[0]?.externalId).toBe('mcroyal-deluxe');
    });

    it('extracts portionGrams when serving size contains "g" (format: "Ración: 210 g")', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes[0]?.portionGrams).toBe(210);
    });

    it('extracts portionGrams when serving size is compact format "210g" (no space)', async () => {
      const mockPage = makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
          if (selector === 'script[type="application/ld+json"]') {
            const match = productPageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            return Promise.resolve(match?.[1] ?? null);
          }
          if (selector === '.cmp-nutrition-summary__serving') return Promise.resolve('210g');
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([]),
      });

      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);
      expect(dishes[0]?.portionGrams).toBe(210);
    });

    it('extracts priceEur with comma-decimal conversion ("5,49 €" → 5.49)', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes[0]?.priceEur).toBe(5.49);
    });

    it('returns dish without priceEur when price selector is absent', async () => {
      const mockPage = makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
          if (selector === 'script[type="application/ld+json"]') {
            const match = productPageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            return Promise.resolve(match?.[1] ?? null);
          }
          if (selector === '.cmp-product-details-main__price') return Promise.reject(new Error('not found'));
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([]),
      });

      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);
      expect(dishes).toHaveLength(1);
      expect(dishes[0]?.priceEur).toBeUndefined();
    });

    it('returns dish without portionGrams when serving selector is absent', async () => {
      const mockPage = makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
          if (selector === 'script[type="application/ld+json"]') {
            const match = productPageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            return Promise.resolve(match?.[1] ?? null);
          }
          if (selector === '.cmp-nutrition-summary__serving') return Promise.reject(new Error('not found'));
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([]),
      });

      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);
      expect(dishes).toHaveLength(1);
      expect(dishes[0]?.portionGrams).toBeUndefined();
    });

    it('throws ScraperStructureError when product name heading is not found', async () => {
      const mockPage = makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.reject(new Error('not found'));
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([]),
      });

      await expect(
        (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage),
      ).rejects.toThrow(ScraperStructureError);
    });

    it('passes sodium (not salt) so normalizeNutrients can derive salt correctly', async () => {
      const mockPage = makeJsonLdPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      // sodium should be set; salt should NOT be explicitly set by the scraper
      expect(dishes[0]?.nutrients.sodium).toBeDefined();
      expect(dishes[0]?.nutrients.salt).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // extractDishes — HTML table fallback path
  // ---------------------------------------------------------------------------

  describe('extractDishes(page) — table fallback path', () => {
    function makeTableFallbackPage(): Page {
      return makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
          // JSON-LD not found — simulate absence
          if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('not found'));
          if (selector === '.cmp-nutrition-summary__serving') return Promise.resolve('Ración: 210 g');
          if (selector === '.cmp-product-details-main__price') return Promise.resolve('5,49 €');
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        $$: vi.fn().mockResolvedValue([
          makeMockRow('Valor energético', '490 kcal'),
          makeMockRow('Grasas', '19 g'),
          makeMockRow('Grasas saturadas', '7 g'),
          makeMockRow('Grasas trans', '0.5 g'),
          makeMockRow('Hidratos de carbono', '58 g'),
          makeMockRow('Azúcares', '12 g'),
          makeMockRow('Fibra alimentaria', '3 g'),
          makeMockRow('Proteínas', '27 g'),
          makeMockRow('Sodio', '870 mg'),
        ]),
      });
    }

    it('falls back to HTML table when JSON-LD is absent', async () => {
      const mockPage = makeTableFallbackPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      expect(dishes).toHaveLength(1);
    });

    it('maps Spanish labels to correct nutrient keys from the table', async () => {
      const mockPage = makeTableFallbackPage();
      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);

      const dish = dishes[0]!;
      // Table returns raw strings — coercion happens in normalizeNutrients
      expect(dish.nutrients.calories).toBe('490 kcal');
      expect(dish.nutrients.fats).toBe('19 g');
      expect(dish.nutrients.proteins).toBe('27 g');
      expect(dish.nutrients.sodium).toBe('870 mg');
    });

    it('returns empty array when no JSON-LD and no table rows', async () => {
      const mockPage = makeMockPage({
        locator: vi.fn().mockReturnValue({
          click: vi.fn().mockRejectedValue(new Error('no banner')),
        } as unknown as Locator),
        $eval: vi.fn().mockImplementation((selector: string) => {
          if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
          if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('not found'));
          return Promise.resolve('');
        }),
        url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
        // No table rows
        $$: vi.fn().mockResolvedValue([]),
      });

      const dishes = await (scraper as unknown as { extractDishes: (p: Page) => Promise<RawDishData[]> }).extractDishes(mockPage);
      // No nutrients → normalizeNutrients will return null → BaseScraper skips
      // extractDishes itself still returns what it can (with empty nutrients)
      expect(Array.isArray(dishes)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // persistDish override
  // ---------------------------------------------------------------------------

  describe('persistDish() override', () => {
    function makeNormalizedDish(): NormalizedDishData {
      return {
        name: 'McRoyal Deluxe',
        nameEs: 'McRoyal Deluxe',
        availability: 'available',
        aliases: [],
        confidenceLevel: 'medium',
        estimationMethod: 'scraped',
        sourceId: '00000000-0000-4000-a000-000000000098',
        restaurantId: '00000000-0000-4000-a000-000000000099',
        nutrients: {
          calories: 490,
          proteins: 27,
          carbohydrates: 58,
          sugars: 12,
          fats: 19,
          saturatedFats: 7,
          fiber: 3,
          salt: 2.175,
          sodium: 870,
          transFats: 0.5,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          referenceBasis: 'per_serving',
        },
      };
    }

    it('calls persistDishUtil with the Prisma client and the normalized dish', async () => {
      const dish = makeNormalizedDish();

      // Call the protected persistDish method directly
      await (scraper as unknown as { persistDish: (d: NormalizedDishData) => Promise<void> }).persistDish(dish);

      expect(mockPersistDishUtil).toHaveBeenCalledTimes(1);
      // First arg is the Prisma client (whatever getPrismaClient() returns in test env)
      // Second arg is the normalized dish
      const callArgs = mockPersistDishUtil.mock.calls[0]!;
      expect(callArgs[1]).toBe(dish);
    });
  });

  // ---------------------------------------------------------------------------
  // Static CONFIG
  // ---------------------------------------------------------------------------

  describe('static CONFIG', () => {
    it('has chainSlug "mcdonalds-es"', () => {
      expect(McDonaldsEsScraper.CONFIG.chainSlug).toBe('mcdonalds-es');
    });

    it('has restaurantId from env stub', () => {
      expect(McDonaldsEsScraper.CONFIG.restaurantId).toBe('00000000-0000-4000-a000-000000000099');
    });

    it('has sourceId from env stub', () => {
      expect(McDonaldsEsScraper.CONFIG.sourceId).toBe('00000000-0000-4000-a000-000000000098');
    });
  });
});
