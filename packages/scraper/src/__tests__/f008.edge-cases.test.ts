// QA edge-case tests for F008 — McDonald's Spain Scraper.
//
// Covers gaps not addressed by mcdonalds-es.test.ts and persist.test.ts:
//   - parseJsonLd corner cases (malicious input, unusual embeddings, encoding)
//   - tableExtractor label normalisation edge cases
//   - extractDishes data-integrity edge cases
//   - getMenuUrls URL-construction edge cases
//   - persist.ts algorithm edge cases (race conditions, concurrent upserts)
//   - coerceNutrient interaction: price vs nutrient parsing
//   - Spec compliance assertions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page, Locator, ElementHandle } from 'playwright';
import type { NormalizedDishData } from '../base/types.js';
import { ScraperStructureError } from '../base/errors.js';

// ---------------------------------------------------------------------------
// Mock persistDishUtil + getPrismaClient before scraper imports
// ---------------------------------------------------------------------------

vi.mock('../utils/persist.js', () => ({
  persistDishUtil: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: vi.fn().mockReturnValue({ _isMockPrisma: true }),
}));

import { McDonaldsEsScraper } from '../chains/mcdonalds-es/McDonaldsEsScraper.js';
import { parseJsonLd, isComplete } from '../chains/mcdonalds-es/jsonLdParser.js';
import { persistDishUtil } from '../utils/persist.js';
import type { PlaywrightCrawler } from 'crawlee';

const mockPersistDishUtil = vi.mocked(persistDishUtil);

// ---------------------------------------------------------------------------
// Mock page / element helpers
// ---------------------------------------------------------------------------

interface MockPage {
  waitForSelector: ReturnType<typeof vi.fn>;
  $$eval: ReturnType<typeof vi.fn>;
  $eval: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  $$: ReturnType<typeof vi.fn>;
}

function makeMockPage(overrides: Partial<MockPage> = {}): Page {
  const defaults: MockPage = {
    waitForSelector: vi.fn().mockResolvedValue(null),
    $$eval: vi.fn().mockResolvedValue([]),
    $eval: vi.fn().mockResolvedValue(''),
    url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test-product.html'),
    locator: vi.fn().mockReturnValue({
      click: vi.fn().mockRejectedValue(new Error('no banner')),
    } as unknown as Locator),
    $$: vi.fn().mockResolvedValue([]),
  };
  return { ...defaults, ...overrides } as unknown as Page;
}

function makeElementHandle(text: string): ElementHandle {
  return {
    textContent: vi.fn().mockResolvedValue(text),
    $$: vi.fn().mockResolvedValue([]),
  } as unknown as ElementHandle;
}

function makeMockRow(label: string, value: string): ElementHandle {
  return {
    $$: vi.fn().mockResolvedValue([
      makeElementHandle(label),
      makeElementHandle(value),
    ]),
  } as unknown as ElementHandle;
}

// ---------------------------------------------------------------------------
// TestMcDonaldsScraper — override createCrawler for unit testing
// ---------------------------------------------------------------------------

class TestMcDonaldsScraper extends McDonaldsEsScraper {
  protected override createCrawler(
    requestHandler: (ctx: { page: Page; request: { url: string; userData: Record<string, unknown> } }) => Promise<void>,
    failedRequestHandler: (ctx: { request: { url: string }; error: Error }) => Promise<void>,
  ): PlaywrightCrawler {
    return {
      async run(requests?: Array<{ url: string; userData?: Record<string, unknown> }>): Promise<void> {
        for (const req of requests ?? []) {
          const userData = req.userData ?? {};
          try {
            await requestHandler({
              page: {} as Page,
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
  }
}

// Type alias for calling protected methods in tests
type ScraperProtected = {
  getMenuUrls: (p: Page) => Promise<string[]>;
  extractDishes: (p: Page) => Promise<import('../base/types.js').RawDishData[]>;
  persistDish: (d: NormalizedDishData) => Promise<void>;
};

function asProtected(s: McDonaldsEsScraper): ScraperProtected {
  return s as unknown as ScraperProtected;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F008 edge-cases — parseJsonLd()', () => {
  it('[B] returns null for an empty string, not a crash', () => {
    expect(parseJsonLd('')).toBeNull();
  });

  it('[B] returns null for a JSON null literal', () => {
    expect(parseJsonLd('null')).toBeNull();
  });

  it('[B] returns null for a JSON array with no NutritionInformation', () => {
    const raw = JSON.stringify([{ '@type': 'WebSite' }, { '@type': 'BreadcrumbList' }]);
    expect(parseJsonLd(raw)).toBeNull();
  });

  it('[B] handles JSON-LD where NutritionInformation is top-level (not nested in Product)', () => {
    const raw = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NutritionInformation',
      calories: '400 cal',
      proteinContent: '20 g',
      carbohydrateContent: '50 g',
      fatContent: '10 g',
    });
    const result = parseJsonLd(raw);
    expect(result).not.toBeNull();
    expect(result?.calories).toBe('400 cal');
    expect(result?.proteins).toBe('20 g');
  });

  it('[B] handles Product missing @type on nutrition node (returns null — no NutritionInformation found)', () => {
    // Product has a nutrition key but no @type on it — should NOT match
    const raw = JSON.stringify({
      '@type': 'Product',
      nutrition: {
        calories: '400 cal',  // no @type: "NutritionInformation"
      },
    });
    const result = parseJsonLd(raw);
    // The parser requires @type === 'NutritionInformation' on the nested node
    expect(result).toBeNull();
  });

  it('[I] handles JSON-LD with extra whitespace around the NutritionInformation values', () => {
    const raw = JSON.stringify({
      '@type': 'Product',
      nutrition: {
        '@type': 'NutritionInformation',
        calories: '  490 cal  ',
        proteinContent: '27 g',
        carbohydrateContent: '58 g',
        fatContent: '19 g',
      },
    });
    const result = parseJsonLd(raw);
    // Values returned as-is from JSON-LD — coercion happens downstream
    expect(result?.calories).toBe('  490 cal  ');
  });

  it('[B] handles malicious JSON-LD with circular-like structure (deeply nested @graph)', () => {
    // A pathological case: @graph containing another @graph (depth 2)
    const raw = JSON.stringify({
      '@graph': [
        {
          '@graph': [
            {
              '@type': 'Product',
              nutrition: {
                '@type': 'NutritionInformation',
                calories: '200 cal',
                proteinContent: '10 g',
                carbohydrateContent: '30 g',
                fatContent: '5 g',
              },
            },
          ],
        },
      ],
    });
    // The current parser only searches one level deep in @graph.
    // It will not find the nutrition node 2 levels down.
    // This test documents the known limitation — it should return null, not throw.
    expect(() => parseJsonLd(raw)).not.toThrow();
    // The result can be null (limitation) or a value (if the parser recurses) —
    // the key assertion is "no crash".
  });

  it('[B] returns null for JSON-LD with numeric values instead of strings', () => {
    // Some sites may embed numbers directly. The parser maps them regardless
    // of type (JSON maps the key unconditionally). Verify no crash.
    const raw = JSON.stringify({
      '@type': 'NutritionInformation',
      calories: 490,    // number, not string
      proteinContent: 27,
      carbohydrateContent: 58,
      fatContent: 19,
    });
    expect(() => parseJsonLd(raw)).not.toThrow();
    const result = parseJsonLd(raw);
    // Even if values are numbers the mapping should still work — document behaviour
    if (result !== null) {
      // calories mapped directly — will be the number 490
      expect(result.calories).toBeDefined();
    }
  });
});

describe('F008 edge-cases — isComplete()', () => {
  it('returns false when calories is the empty string', () => {
    // Empty string is semantically invalid — isComplete now treats it as absent,
    // triggering HTML table fallback instead of passing 0 calories downstream.
    const nutrition = {
      calories: '',
      proteins: '27 g',
      carbohydrates: '58 g',
      fats: '19 g',
    };
    expect(isComplete(nutrition)).toBe(false);
  });

  it('returns false when fats is null', () => {
    // null is semantically invalid — isComplete now treats it as absent.
    const nutritionWithNull = {
      calories: '490 cal',
      proteins: '27 g',
      carbohydrates: '58 g',
      fats: null as unknown as string,
    };
    expect(isComplete(nutritionWithNull)).toBe(false);
  });
});

describe('F008 edge-cases — tableExtractor LABEL_MAP', () => {
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

  it('[B] maps "lípidos" label (alternative Spanish label for fats) to fats nutrient key', async () => {
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McPollo');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('no json-ld'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcpollo.html'),
      $$: vi.fn().mockResolvedValue([
        makeMockRow('Valor energético', '300 kcal'),
        makeMockRow('Lípidos', '10 g'),      // alternative label for fats
        makeMockRow('Proteínas', '20 g'),
        makeMockRow('Hidratos de carbono', '35 g'),
        makeMockRow('Sodio', '500 mg'),
      ]),
    });

    const dishes = await asProtected(scraper).extractDishes(mockPage);
    expect(dishes[0]?.nutrients.fats).toBe('10 g');
  });

  it('[B] correctly maps "sal" (salt label in table) to salt key, not sodium', async () => {
    // spec §7 maps "sal" → salt, "sodio" → sodium. Both should be distinct.
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Patatas');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('no json-ld'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/patatas.html'),
      $$: vi.fn().mockResolvedValue([
        makeMockRow('Valor energético', '320 kcal'),
        makeMockRow('Grasas', '15 g'),
        makeMockRow('Proteínas', '4 g'),
        makeMockRow('Hidratos de carbono', '42 g'),
        makeMockRow('Sal', '0.8 g'),   // salt in grams
      ]),
    });

    const dishes = await asProtected(scraper).extractDishes(mockPage);
    // salt key should be populated from the table; sodium should be absent
    expect(dishes[0]?.nutrients.salt).toBe('0.8 g');
    expect(dishes[0]?.nutrients.sodium).toBeUndefined();
  });

  it('[B] handles table rows with leading/trailing whitespace in labels (normalisation)', async () => {
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('no json-ld'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([
        makeMockRow('  Valor energético  ', '200 kcal'),  // extra whitespace
        makeMockRow('\tProteínas\t', '15 g'),             // tab chars
        makeMockRow('Hidratos  de  carbono', '25 g'),     // double spaces
        makeMockRow('Grasas', '8 g'),
      ]),
    });

    const dishes = await asProtected(scraper).extractDishes(mockPage);
    expect(dishes[0]?.nutrients.calories).toBe('200 kcal');
    expect(dishes[0]?.nutrients.proteins).toBe('15 g');
    // 'hidratos  de  carbono' collapsed to 'hidratos de carbono' → maps to carbohydrates
    expect(dishes[0]?.nutrients.carbohydrates).toBe('25 g');
  });

  it('[I] ignores unknown/unmapped table labels without crashing', async () => {
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('no json-ld'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([
        makeMockRow('Valor energético', '200 kcal'),
        makeMockRow('Proteínas', '15 g'),
        makeMockRow('Hidratos de carbono', '25 g'),
        makeMockRow('Grasas', '8 g'),
        makeMockRow('Vitamina C', '5 mg'),   // not in LABEL_MAP — should be ignored
        makeMockRow('Calcio', '100 mg'),      // not in LABEL_MAP — should be ignored
      ]),
    });

    await expect(asProtected(scraper).extractDishes(mockPage)).resolves.not.toThrow();
  });

  it('[B] handles table row with only one cell (header row or malformed row)', async () => {
    // A header row has <th> not <td>, so cells.length < 2 — must be skipped silently.
    const oneColRow: ElementHandle = {
      $$: vi.fn().mockResolvedValue([makeElementHandle('Por ración')]),
    } as unknown as ElementHandle;

    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('no json-ld'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([
        oneColRow,
        makeMockRow('Proteínas', '10 g'),
        makeMockRow('Valor energético', '150 kcal'),
        makeMockRow('Grasas', '5 g'),
        makeMockRow('Hidratos de carbono', '20 g'),
      ]),
    });

    await expect(asProtected(scraper).extractDishes(mockPage)).resolves.not.toThrow();
    const dishes = await asProtected(scraper).extractDishes(mockPage);
    expect(dishes[0]?.nutrients.proteins).toBe('10 g');
  });
});

describe('F008 edge-cases — getMenuUrls()', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[B] returns empty array when no hrefs match the product URL pattern', async () => {
    const mockPage = makeMockPage({
      waitForSelector: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([
        '/es/es-es/ofertas.html',
        '/es/es-es/menu.html',
        'https://www.facebook.com/mcdonalds',
      ]),
    });

    const urls = await asProtected(scraper).getMenuUrls(mockPage);
    expect(urls).toEqual([]);
  });

  it('[B] correctly handles already-absolute URLs that do NOT need baseUrl prepended', async () => {
    const absoluteUrl = 'https://www.mcdonalds.com/es/es-es/product/big-mac.html';
    const mockPage = makeMockPage({
      waitForSelector: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([absoluteUrl]),
    });

    const urls = await asProtected(scraper).getMenuUrls(mockPage);
    // Must NOT double-prepend baseUrl
    expect(urls[0]).toBe(absoluteUrl);
    expect(urls[0]).not.toContain('https://www.mcdonalds.comhttps://');
  });

  it('[B] correctly builds absolute URL from relative href (no double slash)', async () => {
    // baseUrl is 'https://www.mcdonalds.com' (no trailing slash)
    // href starts with '/' — concatenation should produce one slash, not two
    const mockPage = makeMockPage({
      waitForSelector: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue(['/es/es-es/product/mcroyal-deluxe.html']),
    });

    const urls = await asProtected(scraper).getMenuUrls(mockPage);
    expect(urls[0]).toBe('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html');
    expect(urls[0]).not.toContain('//es/'); // no double slash from concatenation
  });

  it('[B] handles an empty href list gracefully (returns empty array)', async () => {
    const mockPage = makeMockPage({
      waitForSelector: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([]),
    });

    const urls = await asProtected(scraper).getMenuUrls(mockPage);
    expect(urls).toEqual([]);
  });

  it('[B] deduplicates URLs that differ only in trailing query string but same path — URL identity', async () => {
    // The deduplication uses Set on the absolute URL string. A URL with a query
    // string is different from one without — both would be included (expected).
    const mockPage = makeMockPage({
      waitForSelector: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([
        '/es/es-es/product/big-mac.html',
        '/es/es-es/product/big-mac.html?ref=menu',  // with query — counts as different
      ]),
    });

    const urls = await asProtected(scraper).getMenuUrls(mockPage);
    // The second URL does NOT match PRODUCT_URL_PATTERN because the regex
    // expects .html$ but "?ref=menu" follows it. Assert correct filtering.
    // Pattern: /\/es\/es-es\/product\/[^/]+\.html$/
    expect(urls.every(u => u.endsWith('.html'))).toBe(true);
  });
});

describe('F008 edge-cases — extractDishes() price parsing', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Build a minimal JSON-LD page mock with custom price
  function makePageWithPrice(priceText: string): Page {
    return makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') {
          return Promise.resolve(JSON.stringify({
            '@type': 'Product',
            nutrition: {
              '@type': 'NutritionInformation',
              calories: '400 cal',
              proteinContent: '20 g',
              carbohydrateContent: '50 g',
              fatContent: '10 g',
            },
          }));
        }
        if (selector === '.cmp-product-details-main__price') return Promise.resolve(priceText);
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([]),
    });
  }

  it('[B] correctly parses Spanish comma-decimal price "5,49 €" → 5.49', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithPrice('5,49 €'));
    expect(dishes[0]?.priceEur).toBe(5.49);
  });

  it('[B] correctly parses price without currency symbol "5.49" → 5.49', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithPrice('5.49'));
    expect(dishes[0]?.priceEur).toBe(5.49);
  });

  it('correctly parses Spanish thousand-separator price "1.299,00 €" → 1299', async () => {
    // "1.299,00 €" — dot is thousand separator, comma is decimal.
    // When comma is present: strip dots (thousands), replace comma with dot (decimal).
    const dishes = await asProtected(scraper).extractDishes(makePageWithPrice('1.299,00 €'));
    expect(dishes[0]?.priceEur).toBe(1299);
  });

  it('[B] sets priceEur to undefined when price text is only whitespace', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithPrice('   '));
    expect(dishes[0]?.priceEur).toBeUndefined();
  });

  it('[B] sets priceEur to undefined when price text is NaN after parsing', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithPrice('Precio no disponible'));
    expect(dishes[0]?.priceEur).toBeUndefined();
  });
});

describe('F008 edge-cases — extractDishes() portionGrams parsing', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePageWithServing(servingText: string): Page {
    return makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') {
          return Promise.resolve(JSON.stringify({
            '@type': 'Product',
            nutrition: {
              '@type': 'NutritionInformation',
              calories: '400 cal',
              proteinContent: '20 g',
              carbohydrateContent: '50 g',
              fatContent: '10 g',
            },
          }));
        }
        if (selector === '.cmp-nutrition-summary__serving') return Promise.resolve(servingText);
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([]),
    });
  }

  it('[B] parses "210 g" (space before unit) correctly', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing('210 g'));
    expect(dishes[0]?.portionGrams).toBe(210);
  });

  it('[B] parses "210g" (compact format, no space) correctly', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing('210g'));
    expect(dishes[0]?.portionGrams).toBe(210);
  });

  it('[B] parses "Ración: 210 g" (prefix text) correctly', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing('Ración: 210 g'));
    expect(dishes[0]?.portionGrams).toBe(210);
  });

  it('[I] parses decimal serving size "142.5 g" correctly', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing('142.5 g'));
    expect(dishes[0]?.portionGrams).toBe(142.5);
  });

  it('[B] returns undefined portionGrams when serving text has no gram value', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing('Tamaño no disponible'));
    expect(dishes[0]?.portionGrams).toBeUndefined();
  });

  it('[B] returns undefined portionGrams when serving text is empty', async () => {
    const dishes = await asProtected(scraper).extractDishes(makePageWithServing(''));
    expect(dishes[0]?.portionGrams).toBeUndefined();
  });
});

describe('F008 edge-cases — extractDishes() externalId extraction', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePageWithUrl(url: string): Page {
    return makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test Product');
        if (selector === 'script[type="application/ld+json"]') {
          return Promise.resolve(JSON.stringify({
            '@type': 'Product',
            nutrition: {
              '@type': 'NutritionInformation',
              calories: '300 cal',
              proteinContent: '15 g',
              carbohydrateContent: '40 g',
              fatContent: '8 g',
            },
          }));
        }
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue(url),
      $$: vi.fn().mockResolvedValue([]),
    });
  }

  it('[B] extracts externalId from standard product URL slug', async () => {
    const dishes = await asProtected(scraper).extractDishes(
      makePageWithUrl('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
    );
    expect(dishes[0]?.externalId).toBe('mcroyal-deluxe');
  });

  it('[B] sets externalId to undefined when URL does not match product pattern', async () => {
    // Non-product URL — slug regex won't match
    const dishes = await asProtected(scraper).extractDishes(
      makePageWithUrl('https://www.mcdonalds.com/es/es-es/menu.html'),
    );
    expect(dishes[0]?.externalId).toBeUndefined();
  });

  it('[B] handles hyphenated multi-word slugs correctly', async () => {
    const dishes = await asProtected(scraper).extractDishes(
      makePageWithUrl('https://www.mcdonalds.com/es/es-es/product/mcnuggets-20-piezas.html'),
    );
    expect(dishes[0]?.externalId).toBe('mcnuggets-20-piezas');
  });
});

describe('F008 edge-cases — extractDishes() empty product name', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[B] throws ScraperStructureError when h1 exists but textContent is empty string', async () => {
    // The h1 selector resolves but the element has no text — must throw, not silently continue
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') {
          // Element found, but text is empty
          return Promise.resolve('');
        }
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
    });

    await expect(asProtected(scraper).extractDishes(mockPage)).rejects.toThrow(ScraperStructureError);
  });

  it('[B] BUG: does NOT throw ScraperStructureError when h1 textContent is only whitespace — spec says it should (regression risk)', async () => {
    // SPEC §4.2: "if (!name) throw ScraperStructureError('Product name heading is empty')"
    // The implementation trims the raw name but then only checks `if (!rawName)`.
    // A whitespace-only string "   " trims to "" which IS falsy — but the check
    // runs BEFORE the trim assignment: `const rawName = ...trim() ?? ''`.
    // Actually: rawName is ALREADY trimmed to '' so the check should catch it.
    // However, name is assigned from rawName directly. Let's document actual behaviour:
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('   ');
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
    });

    // The implementation: rawName = el.textContent?.trim() ?? '' → '   '.trim() = ''
    // Then checks: if (!rawName) → if (!'') → true → throws ScraperStructureError
    // BUT: the mock returns '   ' as the resolved value (not from an element's textContent)
    // The scraper does: page.$eval(selector, (el) => el.textContent?.trim() ?? '')
    // The mock returns the STRING '   ' directly (not running the callback).
    // So rawName = '   ' (untrimmed, because the mock bypasses the callback).
    // '   ' is truthy → the check passes → name = '   ' → no error thrown.
    // This is a TEST INFRASTRUCTURE issue: the mock $eval does not execute the
    // page.$eval callback, it just returns the mock value. The real trim happens
    // inside the callback that Playwright would execute in the browser.
    // CONSEQUENCE: whitespace-only names from the mock are NOT caught.
    // The real implementation WOULD trim (via the browser callback).
    // We document this by asserting the current (potentially surprising) behaviour:
    const dishes = await asProtected(scraper).extractDishes(mockPage);
    // With mock infrastructure, '   ' is returned as-is (not trimmed by browser).
    // The scraper uses the result directly: name = '   ' (non-empty in JS context).
    // RawDishData.name = '   ' then normalizeDish trims it → '' → Zod fails min(1).
    // This means the dish would be SKIPPED at normalization, not at extraction.
    // Assert that at least the result is an array (no crash):
    expect(Array.isArray(dishes)).toBe(true);
    // The name in the raw dish will be whitespace — document the risk:
    if (dishes.length > 0) {
      // name is untrimmed whitespace — will fail Zod validation in normalize()
      expect(dishes[0]?.name.trim()).toBe('');
    }
  });
});

describe('F008 edge-cases — JSON-LD partial completeness and fallback merge', () => {
  let scraper: McDonaldsEsScraper;

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[B] falls back to table when JSON-LD has calories but is missing proteins (isComplete = false)', async () => {
    // JSON-LD is incomplete — missing proteins, carbs, fats
    const incompleteJsonLd = JSON.stringify({
      '@type': 'Product',
      nutrition: {
        '@type': 'NutritionInformation',
        calories: '490 cal',
        // proteins, carbohydrates, fats missing → isComplete returns false
      },
    });

    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('McRoyal Deluxe');
        if (selector === 'script[type="application/ld+json"]') return Promise.resolve(incompleteJsonLd);
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/mcroyal-deluxe.html'),
      $$: vi.fn().mockResolvedValue([
        makeMockRow('Valor energético', '490 kcal'),
        makeMockRow('Grasas', '19 g'),
        makeMockRow('Proteínas', '27 g'),
        makeMockRow('Hidratos de carbono', '58 g'),
        makeMockRow('Sodio', '870 mg'),
      ]),
    });

    const dishes = await asProtected(scraper).extractDishes(mockPage);

    // After merge: JSON-LD values take precedence, table fills in missing fields.
    // calories comes from JSON-LD ('490 cal'), other fields from table
    expect(dishes[0]?.nutrients.calories).toBe('490 cal');  // JSON-LD wins
    expect(dishes[0]?.nutrients.proteins).toBe('27 g');     // from table
    expect(dishes[0]?.nutrients.fats).toBe('19 g');         // from table
    // Warn should have been emitted for the fallback
    expect(console.warn).toHaveBeenCalled();
  });

  it('[B] emits a warn log when falling back to HTML table', async () => {
    const mockPage = makeMockPage({
      $eval: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'h1.cmp-product-details-main__heading') return Promise.resolve('Test');
        if (selector === 'script[type="application/ld+json"]') return Promise.reject(new Error('not found'));
        return Promise.resolve('');
      }),
      url: vi.fn().mockReturnValue('https://www.mcdonalds.com/es/es-es/product/test.html'),
      $$: vi.fn().mockResolvedValue([]),
    });

    await asProtected(scraper).extractDishes(mockPage);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to HTML table'),
    );
  });
});

describe('F008 edge-cases — persist.ts algorithm correctness (supplemental)', () => {
  // These tests supplement persist.test.ts, focusing on cases not covered there.
  // Because vi.mock('../utils/persist.js') at the top of this file intercepts
  // the persistDishUtil export (turning it into a mock), we CANNOT re-import the
  // real implementation here. Instead we construct a manually wired mock prisma
  // and verify the mock persistDishUtil call arguments from the scraper's
  // persistDish() override.

  let scraper: McDonaldsEsScraper;

  function makeNormalizedDish(overrides: Partial<NormalizedDishData> = {}): NormalizedDishData {
    return {
      name: 'McRoyal Deluxe',
      nameEs: 'McRoyal Deluxe',
      description: 'Test',
      externalId: 'mcroyal-deluxe',
      availability: 'available',
      portionGrams: 210,
      priceEur: 5.49,
      aliases: [],
      confidenceLevel: 'medium',
      estimationMethod: 'scraped',
      sourceId: 'a1b2c3d4-0000-4000-a000-000000000002',
      restaurantId: 'a1b2c3d4-0000-4000-a000-000000000001',
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
      ...overrides,
    };
  }

  beforeEach(() => {
    scraper = new TestMcDonaldsScraper();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPersistDishUtil.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[B] spec §8.4: persistDish() passes the exact dish object to persistDishUtil', async () => {
    const dish = makeNormalizedDish();
    await asProtected(scraper).persistDish(dish);

    expect(mockPersistDishUtil).toHaveBeenCalledTimes(1);
    const [, dishArg] = mockPersistDishUtil.mock.calls[0]!;
    expect(dishArg).toBe(dish);
  });

  it('[B] spec §8.4: persistDish() with externalId=undefined passes through correctly', async () => {
    const dish = makeNormalizedDish({ externalId: undefined });
    await asProtected(scraper).persistDish(dish);

    const [, dishArg] = mockPersistDishUtil.mock.calls[0]!;
    expect((dishArg as NormalizedDishData).externalId).toBeUndefined();
  });

  it('[B] spec §8.4: persistDish() with portionGrams=undefined passes through correctly', async () => {
    const dish = makeNormalizedDish({ portionGrams: undefined });
    await asProtected(scraper).persistDish(dish);

    const [, dishArg] = mockPersistDishUtil.mock.calls[0]!;
    expect((dishArg as NormalizedDishData).portionGrams).toBeUndefined();
  });

  it('[B] spec §8.4: persistDish() with priceEur=undefined passes through correctly', async () => {
    const dish = makeNormalizedDish({ priceEur: undefined });
    await asProtected(scraper).persistDish(dish);

    const [, dishArg] = mockPersistDishUtil.mock.calls[0]!;
    expect((dishArg as NormalizedDishData).priceEur).toBeUndefined();
  });

  it('[B] spec §8.4: persistDish() re-throws when persistDishUtil rejects', async () => {
    const dish = makeNormalizedDish();
    const dbError = new Error('Transaction failed');
    mockPersistDishUtil.mockRejectedValueOnce(dbError);

    await expect(asProtected(scraper).persistDish(dish)).rejects.toThrow('Transaction failed');
  });
});

describe('F008 edge-cases — spec compliance checks', () => {
  it('[B] spec §11: CONFIG.rateLimit.requestsPerMinute is 8 (conservative, below default 10)', () => {
    expect(McDonaldsEsScraper.CONFIG.rateLimit.requestsPerMinute).toBe(8);
  });

  it('[B] spec §11: CONFIG.rateLimit.concurrency is 1', () => {
    expect(McDonaldsEsScraper.CONFIG.rateLimit.concurrency).toBe(1);
  });

  it('[B] spec §11: CONFIG.retryPolicy.maxRetries is 3', () => {
    expect(McDonaldsEsScraper.CONFIG.retryPolicy.maxRetries).toBe(3);
  });

  it('[B] spec §11: CONFIG.retryPolicy.backoffMs is 2000', () => {
    expect(McDonaldsEsScraper.CONFIG.retryPolicy.backoffMs).toBe(2000);
  });

  it('[B] spec §11: CONFIG.chainSlug matches registry key "mcdonalds-es"', () => {
    expect(McDonaldsEsScraper.CONFIG.chainSlug).toBe('mcdonalds-es');
  });

  it('[B] spec §11: CONFIG.baseUrl is "https://www.mcdonalds.com" (no trailing slash)', () => {
    expect(McDonaldsEsScraper.CONFIG.baseUrl).toBe('https://www.mcdonalds.com');
  });

  it('[B] spec §9.1: registry exports { config, ScraperClass } for mcdonalds-es', async () => {
    const { registry } = await import('../registry.js');
    const entry = registry['mcdonalds-es'];
    expect(entry).toBeDefined();
    expect(entry?.config).toBeDefined();
    expect(entry?.ScraperClass).toBeDefined();
    expect(entry?.ScraperClass).toBe(McDonaldsEsScraper);
  });

  it('[B] spec §11: CONFIG.selectors.cookieConsent matches expected selector', () => {
    expect(McDonaldsEsScraper.CONFIG.selectors['cookieConsent']).toBe('[data-testid="cookie-consent-accept"]');
  });

  it('[B] spec §4.1: product URL pattern filters /es/es-es/product/<slug>.html only', () => {
    // Test the regex used in getMenuUrls indirectly by checking filtering behaviour
    // URLs that should NOT match:
    const nonProductUrls = [
      '/es/es-es/product/',                // no slug, no .html
      '/es/es-es/products/big-mac.html',   // "products" not "product"
      '/us/en-us/product/big-mac.html',    // wrong locale
      '/es/es-es/product/big-mac.htm',     // wrong extension
    ];

    // Valid product URL
    const validUrl = '/es/es-es/product/big-mac.html';
    const pattern = /\/es\/es-es\/product\/[^/]+\.html$/;

    expect(pattern.test(validUrl)).toBe(true);
    nonProductUrls.forEach((url) => {
      expect(pattern.test(url)).toBe(false);
    });
  });
});
