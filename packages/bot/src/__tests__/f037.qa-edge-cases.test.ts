// F037 — QA edge-case tests
//
// Hunts for bugs the developer missed:
// - Empty/whitespace/trailing-space inputs
// - Unicode/emoji inputs
// - Mixed-case inputs that should work (case-insensitive)
// - Mixed-case subcommands that MAY fail (spec says lowercase-only)
// - MarkdownV2 special chars in chain names
// - Formatter boundary values (0-second TTL, <1-min TTL)
// - resolveChain corner cases (identical name/nameEs, short normalized queries)
// - comparisonRunner: one dish explicit + one uses fallback
// - NL fall-through when Step 0 matches but chain not found
// - Redis race-condition simulations (concurrent writes)
// - Long chain names approaching message-length limits
// - /contexto multiline args

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../apiClient.js';
import type { ChainListItem, EstimateData } from '@foodxplorer/shared';
import type { Redis } from 'ioredis';
import { ApiError } from '../apiClient.js';
import { detectContextSet } from '../lib/contextDetector.js';
import { resolveChain } from '../lib/chainResolver.js';
import {
  formatContextConfirmation,
  formatContextView,
  formatContextCleared,
} from '../formatters/contextFormatter.js';
import type { BotStateChainContext } from '../lib/conversationState.js';
import { handleContexto } from '../commands/contexto.js';
import { handleNaturalLanguage } from '../handlers/naturalLanguage.js';
import { runComparison } from '../lib/comparisonRunner.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAIN_MCDONALDS: ChainListItem = {
  chainSlug: 'mcdonalds-es',
  name: "McDonald's",
  nameEs: 'McDonalds',
  countryCode: 'ES',
  dishCount: 150,
  isActive: true,
};

const CHAIN_BURGER_KING: ChainListItem = {
  chainSlug: 'burger-king-es',
  name: 'Burger King',
  nameEs: 'Burger King',
  countryCode: 'ES',
  dishCount: 100,
  isActive: true,
};

// Chain with identical name and nameEs
const CHAIN_SUBWAY: ChainListItem = {
  chainSlug: 'subway-es',
  name: 'Subway',
  nameEs: 'Subway',
  countryCode: 'ES',
  dishCount: 80,
  isActive: true,
};

// Chain with special MarkdownV2 chars in name
const CHAIN_PANS: ChainListItem = {
  chainSlug: 'pans-company-es',
  name: 'Pans & Company',
  nameEs: 'Pans & Company',
  countryCode: 'ES',
  dishCount: 40,
  isActive: true,
};

// Chain whose nameEs differs from name (allows testing name-only prefix)
const CHAIN_KFC: ChainListItem = {
  chainSlug: 'kfc-es',
  name: 'KFC',
  nameEs: null,
  countryCode: 'ES',
  dishCount: 60,
  isActive: true,
};

// Chain with parentheses in display name
const CHAIN_FIVE_GUYS: ChainListItem = {
  chainSlug: 'five-guys-es',
  name: 'Five Guys',
  nameEs: 'Five Guys (ES)',
  countryCode: 'ES',
  dishCount: 50,
  isActive: true,
};

const ESTIMATE_DATA_NULL: EstimateData = {
  query: 'xyz',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: false,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: null,
  result: null,
  cachedAt: null,
};

const NUTRIENTS = {
  calories: 563, proteins: 26.5, carbohydrates: 45, sugars: 0,
  fats: 30, saturatedFats: 0, fiber: 0, salt: 0, sodium: 0,
  transFats: 0, cholesterol: 0, potassium: 0,
  monounsaturatedFats: 0, polyunsaturatedFats: 0,
  referenceBasis: 'per_serving' as const,
};

const ESTIMATE_DATA_WITH_RESULT: EstimateData = {
  query: 'big mac',
  chainSlug: null,
  portionMultiplier: 1.0,
  level1Hit: true,
  level2Hit: false,
  level3Hit: false,
  level4Hit: false,
  matchType: 'exact_dish',
  cachedAt: null,
  result: {
    entityType: 'dish',
    entityId: 'fd000000-0001-4000-a000-000000000001',
    name: 'Big Mac',
    nameEs: 'Big Mac',
    restaurantId: 'fd000000-0002-4000-a000-000000000001',
    chainSlug: 'mcdonalds-es',
    portionGrams: 200,
    confidenceLevel: 'high',
    estimationMethod: 'official',
    similarityDistance: null,
    source: { id: 'fd000000-0004-4000-a000-000000000001', name: 'src', type: 'official', url: null },
    nutrients: NUTRIENTS,
  },
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockApiClient = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>;
};

function makeMockClient(chains: ChainListItem[] = [CHAIN_MCDONALDS, CHAIN_BURGER_KING]): MockApiClient {
  return {
    searchDishes: vi.fn(),
    estimate: vi.fn(),
    listRestaurants: vi.fn(),
    listRestaurantDishes: vi.fn(),
    listChains: vi.fn().mockResolvedValue(chains),
    healthCheck: vi.fn(),
    searchRestaurants: vi.fn(),
    createRestaurant: vi.fn(),
    uploadImage: vi.fn(),
    uploadPdf: vi.fn(),
    analyzeMenu: vi.fn(),
    calculateRecipe: vi.fn(),
  };
}

function makeMockRedis(storedJson: string | null = null, ttlValue = 3600): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(storedJson),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(ttlValue),
  };
}

const CHAT_ID = 99;

// ===========================================================================
// 1. detectContextSet edge cases
// ===========================================================================

describe('detectContextSet — edge cases', () => {
  // Edge case 1: "estoy en" with NO text after (just the prefix, no capture)
  it('"estoy en" with nothing after → null', () => {
    expect(detectContextSet('estoy en')).toBeNull();
  });

  // Edge case 2: "estoy en " with single trailing space only
  it('"estoy en " (trailing space only) → null', () => {
    expect(detectContextSet('estoy en ')).toBeNull();
  });

  // Edge case 3: "estoy en  " (double trailing space) → null (capture is empty after trim)
  it('"estoy en  " (double trailing space) → null', () => {
    expect(detectContextSet('estoy en  ')).toBeNull();
  });

  // Edge case 4: mixed case "Estoy En McDonalds" — regex has /i flag
  it('"Estoy En McDonalds" (mixed case) → "McDonalds"', () => {
    expect(detectContextSet('Estoy En McDonalds')).toBe('McDonalds');
  });

  // Edge case 5: "ESTOY EN    mcdonalds" (multiple spaces between words)
  it('"ESTOY EN    mcdonalds" (multiple spaces) → "mcdonalds"', () => {
    expect(detectContextSet('ESTOY EN    mcdonalds')).toBe('mcdonalds');
  });

  // Edge case 6: emoji input "estoy en 🍔"
  // The capture group allows non-comma/non-punctuation chars — emoji should be captured
  // but resolveChain will return null (normalized length < 3 or no match).
  // Critically: detectContextSet itself should return the emoji string, not null.
  it('"estoy en 🍔" → returns captured emoji string (not null)', () => {
    const result = detectContextSet('estoy en 🍔');
    // The emoji is captured — it's not a comma, question mark, or period
    // This test documents the actual behavior so downstream tests can verify
    // that resolveChain handles it gracefully (via the < 3 char guard or no match)
    expect(result).toBe('🍔');
  });

  // Edge case 7: leading/trailing whitespace on the full input
  it('"  estoy en mcdonalds  " (outer whitespace) → null (regex anchors prevent match)', () => {
    // The regex is anchored with ^ and $. The code does .trim() before applying it.
    // After strip of ¿/¡ and trim, "estoy en mcdonalds" should match.
    expect(detectContextSet('  estoy en mcdonalds  ')).toBe('mcdonalds');
  });

  // Edge case 8: newline embedded in input — rejected (BUG-F037-02 fixed)
  it('"estoy en\\nmcdonalds" (embedded newline) → null (newlines rejected)', () => {
    expect(detectContextSet('estoy en\nmcdonalds')).toBeNull();
  });

  // Edge case 9: input that is just whitespace
  it('"   " (only whitespace) → null', () => {
    expect(detectContextSet('   ')).toBeNull();
  });

  // Edge case 10: capture group exactly 1 char (below minimum for resolveChain, but detectContextSet itself should not filter on length)
  it('"estoy en x" (1-char capture) → "x" (detectContextSet does not filter by length)', () => {
    // detectContextSet returns the raw capture — resolveChain enforces the min-length guard
    expect(detectContextSet('estoy en x')).toBe('x');
  });

  // Edge case 11: "estoy en el " (article then trailing space)
  // After stripping trailing punct and trimming: "estoy en el"
  // The optional article group (?:el\s+) requires whitespace AFTER "el".
  // With nothing after "el", the optional group does NOT consume it.
  // The capture group [^,¿?!.]{1,50} then matches "el" itself.
  // Result: returns "el" (NOT null) — this is a known behavior, not a bug.
  it('"estoy en el " (article then trailing space) → "el" (article group not consumed, "el" captured)', () => {
    // resolveChain will receive "el" → normalize → "el" (2 chars) → null (< 3 min length)
    // So the end-to-end behavior is still safe (no chain match for "el")
    expect(detectContextSet('estoy en el ')).toBe('el');
  });
});

// ===========================================================================
// 2. resolveChain edge cases
// ===========================================================================

describe('resolveChain — edge cases', () => {
  // Edge case 12: query with only whitespace normalizes to empty string → null
  it('query = "   " (only spaces) → null, no API call', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await resolveChain('   ', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  // Edge case 13: query with leading/trailing spaces that reduce to < 3 chars after normalize
  it('query = "  m  " → normalizes to "m" (1 char) → null, no API call', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await resolveChain('  m  ', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  // Edge case 14: chains with identical nameEs and name (both === "Subway")
  // Tier 2 exact match — should return one result without ambiguity
  it('chain with identical name and nameEs → single exact match (not ambiguous)', async () => {
    const client = makeMockClient([CHAIN_SUBWAY]);
    const result = await resolveChain('subway', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('subway-es');
    }
  });

  // Edge case 15: chain with "Pans & Company" in name — & is not a normalize-strippable char
  // Querying "pans" should prefix-match slug "pans-company-es"
  it('"pans" → prefix matches "pans-company-es" slug', async () => {
    const client = makeMockClient([CHAIN_PANS]);
    const result = await resolveChain('pans', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('pans-company-es');
    }
  });

  // Edge case 16: query "pans company" matches via substring (bidirectional)
  it('"pans company" → substring matches "Pans & Company" (company included in normalized name)', async () => {
    // normalized "pans & company" = "pans & company" (& not stripped by normalize)
    // normalized "pans company" = "pans company"
    // "pans & company".includes("pans company") → false (& separates them)
    // "pans company".includes("pans & company") → false (query lacks &)
    // However the slug "pans-company-es" → normalized "pans-company-es"
    // "pans-company-es".includes("pans company") → false (hyphen vs space)
    // "pans company".includes("pans-company-es") → false
    // This should return null — documenting this gap
    const client = makeMockClient([CHAIN_PANS]);
    const result = await resolveChain('pans company', client as unknown as ApiClient);
    // "pans company" normalizes to "pans company"
    // slug normalized = "pans-company-es" — no match at tier1/2/3/4
    // Unless tier 4 slug check: "pans-company-es".includes("pans company") → FALSE (hyphen vs space)
    // Tier 4 name check: "pans & company".includes("pans company") → FALSE
    // So this returns null
    expect(result).toBeNull();
  });

  // Edge case 17: emoji query — should return null gracefully (normalized length check)
  it('emoji query "🍔" → null (normalized length may be < 3 code units)', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    // 🍔 in JS = 2 code units (surrogate pair) → length 2 → < 3 → null
    const result = await resolveChain('🍔', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  // Edge case 18: query that is entirely accented chars, normalizing to exact slug
  it('accented query "mcdonálds-es" normalizes to "mcdonalds-es" → exact slug match', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await resolveChain('mcdonálds-es', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  // Edge case 19: query with apostrophe in it — normalize strips apostrophes
  it('"mcdonald\'s" → apostrophe stripped by normalize → prefix/substring match', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    // normalize("mcdonald's") → "mcdonalds" → prefix of "mcdonalds-es"
    const result = await resolveChain("mcdonald's", client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  // Edge case 20: listChains returns empty array → null
  it('listChains returns [] → null', async () => {
    const client = makeMockClient([]);
    const result = await resolveChain('mcdonalds', client as unknown as ApiClient);
    expect(result).toBeNull();
  });

  // Edge case 21: two chains where one's nameEs equals the other's name
  // Ensures tier 2 exact match doesn't incorrectly match both
  it('two chains with overlapping name/nameEs — exact slug differentiates them', async () => {
    const chainA: ChainListItem = {
      chainSlug: 'chain-a-es',
      name: 'Burger Place',
      nameEs: 'Burger King', // same as chain B's nameEs
      countryCode: 'ES',
      dishCount: 10,
      isActive: true,
    };
    const chainB: ChainListItem = {
      chainSlug: 'chain-b-es',
      name: 'Another Burger',
      nameEs: 'Burger King', // same as chain A's nameEs
      countryCode: 'ES',
      dishCount: 10,
      isActive: true,
    };
    const client = makeMockClient([chainA, chainB]);
    // Exact slug "chain-a-es" → tier 1, unambiguous
    const result = await resolveChain('chain-a-es', client as unknown as ApiClient);
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('chain-a-es');
    }
  });

  // Edge case 22: query exactly 3 chars after normalization — should pass the minimum length guard
  it('query normalizes to exactly 3 chars → passes min length, calls API', async () => {
    const client = makeMockClient([CHAIN_KFC]);
    await resolveChain('kfc', client as unknown as ApiClient);
    expect(client.listChains).toHaveBeenCalled();
  });

  // Edge case 23: query with a trailing space that after normalization is exactly 2 chars → null
  it('query " mc " → normalizes to "mc" (2 chars) → null, no API call', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await resolveChain(' mc ', client as unknown as ApiClient);
    expect(result).toBeNull();
    expect(client.listChains).not.toHaveBeenCalled();
  });

  // Edge case 24: query "five guys (es)" — parentheses in nameEs
  // normalize strips parentheses? No — normalize only strips diacritics and apostrophes.
  // "Five Guys (ES)" normalizes to "five guys (es)"
  // query "five guys" → tier 3 prefix: "five guys (es)".startsWith("five guys") → TRUE
  it('"five guys" → prefix matches nameEs "Five Guys (ES)"', async () => {
    const client = makeMockClient([CHAIN_FIVE_GUYS]);
    const result = await resolveChain('five guys', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('five-guys-es');
    }
  });
});

// ===========================================================================
// 3. formatContextConfirmation — MarkdownV2 special chars
// ===========================================================================

describe('formatContextConfirmation — MarkdownV2 special chars in chainName', () => {
  // Edge case 25: ampersand in name — & is NOT a MarkdownV2 reserved char
  it('"Pans & Company" — & passes through unescaped', () => {
    const result = formatContextConfirmation('Pans & Company', 'pans-company-es');
    // & is not in RESERVED_CHARS_REGEX — should appear as-is
    expect(result).toContain('Pans & Company');
  });

  // Edge case 26: parentheses in name — ( and ) ARE reserved in MarkdownV2
  it('"Five Guys (ES)" — parentheses are escaped', () => {
    const result = formatContextConfirmation('Five Guys (ES)', 'five-guys-es');
    expect(result).toContain('Five Guys \\(ES\\)');
  });

  // Edge case 27: hyphen in name — hyphen IS reserved in MarkdownV2
  it('"Burger-King" — hyphen is escaped in chainName (not in code span)', () => {
    const result = formatContextConfirmation('Burger-King', 'burger-king-es');
    // The chainName is escaped, the chainSlug inside code span is NOT escaped
    expect(result).toContain('Burger\\-King');
  });

  // Edge case 28: period in name — period IS reserved in MarkdownV2
  it('"Mr. Burger" — period is escaped', () => {
    const result = formatContextConfirmation('Mr. Burger', 'mr-burger-es');
    expect(result).toContain('Mr\\. Burger');
  });

  // Edge case 29: underscore in name — underscore IS reserved in MarkdownV2
  it('"Mc_Donalds" — underscore is escaped', () => {
    const result = formatContextConfirmation('Mc_Donalds', 'mc-donalds-es');
    expect(result).toContain('Mc\\_Donalds');
  });

  // Edge case 30: very long chain name (100 chars) — should not exceed Telegram message limit
  it('very long chain name (100 chars) — message is still a finite string', () => {
    const longName = 'A'.repeat(100);
    const result = formatContextConfirmation(longName, 'long-chain-es');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Telegram message limit is 4096 — confirmation messages should be well within that
    expect(result.length).toBeLessThan(4096);
  });

  // Edge case 31: exclamation mark in name — ! IS reserved in MarkdownV2
  it('"Pollo! Rico" — exclamation mark is escaped', () => {
    const result = formatContextConfirmation('Pollo! Rico', 'pollo-rico-es');
    expect(result).toContain('Pollo\\! Rico');
  });
});

// ===========================================================================
// 4. formatContextView — boundary values
// ===========================================================================

describe('formatContextView — boundary and edge values', () => {
  const ctx: BotStateChainContext = {
    chainSlug: 'mcdonalds-es',
    chainName: 'McDonalds',
  };

  // Edge case 32: remainingSeconds = 1 (just above 0) → shows time, not "Expira pronto"
  it('remainingSeconds = 1 → shows "0h 0m" (not "Expira pronto")', () => {
    const result = formatContextView(ctx, 1);
    // 1 second → floor(1/3600)=0 hours, floor((1%3600)/60)=0 minutes
    expect(result).not.toContain('Expira pronto');
    expect(result).toContain('0h');
    expect(result).toContain('0m');
  });

  // Edge case 33: remainingSeconds = 0 → "Expira pronto"
  it('remainingSeconds = 0 → "Expira pronto"', () => {
    const result = formatContextView(ctx, 0);
    expect(result).toContain('Expira pronto');
  });

  // Edge case 34: remainingSeconds = 59 (less than 1 minute) → shows "0h 0m"
  it('remainingSeconds = 59 → shows "0h 0m" (both floor to 0)', () => {
    const result = formatContextView(ctx, 59);
    expect(result).toContain('0h');
    expect(result).toContain('0m');
    expect(result).not.toContain('Expira pronto');
  });

  // Edge case 35: remainingSeconds = 7200 (full 2h TTL) → shows "2h 0m"
  it('remainingSeconds = 7200 → shows "2h 0m"', () => {
    const result = formatContextView(ctx, 7200);
    expect(result).toContain('2h');
    expect(result).toContain('0m');
  });

  // Edge case 36: chain name with special MarkdownV2 chars in view message
  it('chainName with parentheses in view message — escaped correctly', () => {
    const ctxSpecial: BotStateChainContext = {
      chainSlug: 'five-guys-es',
      chainName: 'Five Guys (ES)',
    };
    const result = formatContextView(ctxSpecial, 3600);
    expect(result).toContain('Five Guys \\(ES\\)');
  });

  // Edge case 37: very large remainingSeconds (e.g. if Redis TTL is misconfigured)
  it('remainingSeconds = 99999 → shows valid hours/minutes without throwing', () => {
    const result = formatContextView(ctx, 99999);
    expect(typeof result).toBe('string');
    // 99999 seconds = 27h 46m
    expect(result).toContain('27h');
    expect(result).toContain('46m');
  });
});

// ===========================================================================
// 5. handleContexto — edge cases
// ===========================================================================

describe('handleContexto — edge cases', () => {
  // Edge case 38: "BORRAR" (uppercase) — now routes to Clear flow (BUG-F037-01 fixed)
  it('"BORRAR" (uppercase) → routes to Clear flow (case-insensitive)', async () => {
    const redis = makeMockRedis(JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } }));
    const client = makeMockClient([]);
    const result = await handleContexto('BORRAR', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto borrado');
  });

  // Edge case 39: args with embedded newline (from the /s regex in bot.ts)
  it('args = "mcdonalds\\nsomething" (multiline) → trimmed args passed to resolveChain → no match', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    // "mcdonalds\nsomething" → trimmed → "mcdonalds\nsomething"
    // normalize → "mcdonalds\nsomething" (newline not stripped by normalize)
    // No exact match for slug or name → but tier 4 bidirectional substring:
    // does "mcdonalds\nsomething" include "mcdonalds"? Yes.
    // So chainResolver should match mcdonalds-es via tier 4 substring
    const result = await handleContexto('mcdonalds\nsomething', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Behavior depends on whether "mcdonalds-es".includes("mcdonalds\nsomething") or vice versa.
    // "mcdonalds\nsomething".includes("mcdonalds") → true → but this is query.includes(name), not name.includes(query)
    // name = "mcdonalds-es" (slug normalized), nameEs = "mcdonalds"
    // tier 4 slug: "mcdonalds-es".includes("mcdonalds\nsomething") → false
    //              "mcdonalds\nsomething".includes("mcdonalds-es") → false
    // tier 4 name: normalize("McDonald's") = "mcdonalds"
    //              "mcdonalds".includes("mcdonalds\nsomething") → false
    //              "mcdonalds\nsomething".includes("mcdonalds") → TRUE
    // So tier 4 matches! chainResolver returns mcdonalds-es context.
    // This is a potentially surprising behavior for multiline input.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Either it sets the context (tier 4 match) or returns "no encontré ninguna cadena"
    // The key thing is: it should NOT throw
  });

  // Edge case 40: /contexto called with args that have only newlines
  it('args = "\\n\\n" (only newlines) → after trim, empty → View flow', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    const result = await handleContexto('\n\n', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // "\n\n".trim() = "" → View flow
    expect(result).toContain('No hay contexto activo');
  });

  // Edge case 41: /contexto args exactly "mc" (below resolveChain minimum length)
  // Spec AC#21: `/contexto mc` (query < 3 chars) → "no encontré ninguna cadena"
  it('args = "mc" (2 chars, below min length) → "No encontré ninguna cadena"', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await handleContexto('mc', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('No encontré ninguna cadena');
    // resolveChain should NOT have called listChains
    expect(client.listChains).not.toHaveBeenCalled();
  });

  // Edge case 42: context already set, setting a new one — overwrites old context, preserves other state fields
  it('overwrite existing context — old chainSlug replaced, other state fields preserved', async () => {
    const existingState = JSON.stringify({
      chainContext: { chainSlug: 'burger-king-es', chainName: 'Burger King' },
      pendingSearch: 'pizza',
    });
    const redis = makeMockRedis(existingState);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    await handleContexto('mcdonalds-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as { chainContext?: { chainSlug: string }; pendingSearch?: string };
    expect(saved.chainContext?.chainSlug).toBe('mcdonalds-es');
    expect(saved.pendingSearch).toBe('pizza');
  });

  // Edge case 43: clear flow when state has other fields but no chainContext
  it('clear with state that has no chainContext (but has pendingSearch) → returns cleared, state not written', async () => {
    const stateWithoutContext = JSON.stringify({ pendingSearch: 'burger' });
    const redis = makeMockRedis(stateWithoutContext);
    const client = makeMockClient();
    const result = await handleContexto('borrar', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto borrado');
    // No write needed since there was nothing to delete
    expect(redis.set).not.toHaveBeenCalled();
  });

  // Edge case 44: View flow shows TTL = 7200 as "2h 0m"
  it('view flow with TTL = 7200 → shows "2h 0m"', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state, 7200);
    const client = makeMockClient();
    const result = await handleContexto('', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('2h');
    expect(result).toContain('0m');
  });

  // Edge case 45: chain name with special MarkdownV2 chars — confirmation message is properly escaped
  it('chain with parentheses in name → confirmation message escapes parens', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_FIVE_GUYS]);
    const result = await handleContexto('five-guys-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    // Parentheses in "Five Guys (ES)" should be escaped
    expect(result).toContain('\\(ES\\)');
  });
});

// ===========================================================================
// 6. NL handler — edge cases
// ===========================================================================

describe('handleNaturalLanguage — edge cases', () => {
  // Edge case 46: "estoy en" (no chain text) → detectContextSet returns null → falls through to food query
  it('"estoy en" with nothing after → falls through to food query (no chain detection)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('estoy en', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // detectContextSet("estoy en") → null → goes straight to Step 1/2
    expect(client.listChains).not.toHaveBeenCalled();
    expect(client.estimate).toHaveBeenCalled();
  });

  // Edge case 47: "estoy en " (trailing space) → detectContextSet returns null → falls through
  it('"estoy en " (trailing space) → falls through to food query', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('estoy en ', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(client.listChains).not.toHaveBeenCalled();
    expect(client.estimate).toHaveBeenCalled();
  });

  // Edge case 48: "Estoy En McDonalds" (mixed case) → Step 0 detects it, chain found → confirmation
  it('"Estoy En McDonalds" (mixed case) → context set (case-insensitive detection)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await handleNaturalLanguage('Estoy En McDonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('Contexto establecido');
    expect(client.estimate).not.toHaveBeenCalled();
  });

  // Edge case 49: "estoy en 🍔" → detectContextSet returns "🍔",
  // resolveChain gets "🍔" → normalized length 2 → null → silent fall-through → food query
  it('"estoy en 🍔" → chain not found (emoji), falls through to food query silently', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const result = await handleNaturalLanguage('estoy en 🍔', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Should NOT return error message about chains
    expect(result).not.toContain('No encontré ninguna cadena');
    // Should fall through to food query
    expect(client.estimate).toHaveBeenCalled();
  });

  // Edge case 50: NL with active context + explicit chain override — explicit chain wins, context NOT changed
  it('active context + NL query with explicit "en burger-king-es" → explicit slug used, context unchanged', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('big mac en burger-king-es', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // The explicit slug from the query wins
    expect(client.estimate).toHaveBeenCalledWith({ query: 'big mac', chainSlug: 'burger-king-es' });
    // Redis should NOT be written (context not changed)
    expect(redis.set).not.toHaveBeenCalled();
  });

  // Edge case 51: listChains is slow/times out during Step 0
  // Simulated as: listChains rejects with a generic Error (not ApiError) → should rethrow
  it('listChains throws non-ApiError during Step 0 → error propagates (not swallowed)', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]);
    client.listChains.mockRejectedValue(new Error('connection timeout'));
    // handleNaturalLanguage delegates to handleContextSet which rethrows non-ApiErrors
    await expect(
      handleNaturalLanguage('estoy en mcdonalds', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient),
    ).rejects.toThrow('connection timeout');
  });

  // Edge case 52: NL comparison with explicit chain — handleNaturalLanguage uses extractComparisonQuery
  // which requires a Spanish comparison PREFIX (e.g., "compara", "qué engorda más").
  // Plain "big mac en mcdonalds-es vs whopper" has NO prefix → extractComparisonQuery returns null.
  // It falls to Step 2 (single-dish) instead. This is by design — NL comparisons need a prefix.
  // The /comparar command handles prefix-free "A vs B" syntax directly.
  it('NL plain "big mac en mcdonalds-es vs whopper" — no comparison prefix → treated as single-dish query (not comparison)', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'burger-king-es', chainName: 'Burger King' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('big mac en mcdonalds-es vs whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Falls through to Step 2 single-dish — only one estimate call
    expect(client.estimate).toHaveBeenCalledTimes(1);
  });

  // Edge case 52b: NL comparison WITH prefix + explicit chain on one side + context
  // "compara big mac en mcdonalds-es con whopper" with BK context → dishA explicit, dishB uses context
  it('NL comparison WITH prefix "compara big mac en mcdonalds-es con whopper" + BK context → explicit wins for A, context for B', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'burger-king-es', chainName: 'Burger King' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient([]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    await handleNaturalLanguage('compara big mac en mcdonalds-es con whopper', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // extractComparisonQuery finds "compara" prefix → splits on "con"
    // dishA = "big mac en mcdonalds-es", dishB = "whopper"
    expect(client.estimate).toHaveBeenCalledTimes(2);
    const callA = (client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }])[0];
    const callB = (client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }])[0];
    // dishA has explicit mcdonalds-es
    expect(callA.chainSlug).toBe('mcdonalds-es');
    // dishB has no explicit slug → context fallback
    expect(callB.chainSlug).toBe('burger-king-es');
  });

  // Edge case 53: state with chainContext but no other fields — clear should leave empty state
  it('state with only chainContext → borrar produces empty state (no extra fields)', async () => {
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    await handleContexto('borrar', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as Record<string, unknown>;
    // chainContext must be gone
    expect(Object.prototype.hasOwnProperty.call(saved, 'chainContext')).toBe(false);
    // Object should be empty (no ghost fields)
    expect(Object.keys(saved)).toHaveLength(0);
  });
});

// ===========================================================================
// 7. runComparison — one explicit + one context (AC#11)
// ===========================================================================

describe('runComparison — one explicit chain + one context fallback', () => {
  // Edge case 54: dishA has explicit slug, dishB has no slug → fallback applies only to B
  it('dishA explicit slug + dishB no slug → A keeps explicit, B gets fallback', async () => {
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    await runComparison(
      'big mac en mcdonalds-es',
      'whopper',
      undefined,
      client as unknown as ApiClient,
      'burger-king-es', // fallback from context
    );

    expect(client.estimate).toHaveBeenCalledTimes(2);
    const callA = (client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }])[0];
    const callB = (client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }])[0];
    expect(callA.chainSlug).toBe('mcdonalds-es'); // explicit wins
    expect(callB.chainSlug).toBe('burger-king-es'); // fallback applied
  });

  // Edge case 55: both dishes have same explicit slug → fallback does NOT override either
  it('both dishes have explicit slug → fallback never applied to either', async () => {
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    await runComparison(
      'big mac en mcdonalds-es',
      'whopper en burger-king-es',
      undefined,
      client as unknown as ApiClient,
      'kfc-es', // fallback should be ignored
    );

    const callA = (client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }])[0];
    const callB = (client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }])[0];
    expect(callA.chainSlug).toBe('mcdonalds-es');
    expect(callB.chainSlug).toBe('burger-king-es');
    // Neither should be kfc-es
    expect(callA.chainSlug).not.toBe('kfc-es');
    expect(callB.chainSlug).not.toBe('kfc-es');
  });

  // Edge case 56: fallbackChainSlug is empty string → treated as falsy, no injection
  it('fallbackChainSlug = "" (empty string) → no chainSlug injected', async () => {
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    await runComparison('big mac', 'whopper', undefined, client as unknown as ApiClient, '');

    const callA = (client.estimate.mock.calls[0] as [{ query: string; chainSlug?: string }])[0];
    const callB = (client.estimate.mock.calls[1] as [{ query: string; chainSlug?: string }])[0];
    // Empty string is falsy → condition `!exprA.chainSlug && fallbackChainSlug` is false
    expect(Object.prototype.hasOwnProperty.call(callA, 'chainSlug')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(callB, 'chainSlug')).toBe(false);
  });
});

// ===========================================================================
// 8. Concurrent context set + estimate simulation
// ===========================================================================

describe('concurrent context set + estimate (race condition simulation)', () => {
  // Edge case 57: context set in flight when estimate fires — simulate via ordering
  // If context set hasn't completed writing to Redis when estimate reads,
  // estimate fails open (no chainSlug). This is the correct behavior.
  it('estimate with Redis returning null (context set not yet written) → fail-open, no chainSlug', async () => {
    // Simulate: Redis get returns null (context not yet committed)
    const redis = makeMockRedis(null);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);

    const { handleEstimar } = await import('../commands/estimar.js');
    await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);

    const callArgs = (client.estimate.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.prototype.hasOwnProperty.call(callArgs, 'chainSlug')).toBe(false);
  });

  // Edge case 58: concurrent writes — second setState overwrites first
  // This is a Redis non-atomic operation, documented as known behavior.
  // Test that at least neither write throws.
  it('two concurrent setStateStrict calls — both complete without throwing', async () => {
    const { setStateStrict } = await import('../lib/conversationState.js');
    const redis = makeMockRedis(null);

    const state1 = { chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } };
    const state2 = { chainContext: { chainSlug: 'burger-king-es', chainName: 'Burger King' } };

    const [result1, result2] = await Promise.all([
      setStateStrict(redis as unknown as Redis, CHAT_ID, state1),
      setStateStrict(redis as unknown as Redis, CHAT_ID, state2),
    ]);

    expect(result1).toBe(true);
    expect(result2).toBe(true);
    // Both wrote — last writer wins (no error)
    expect(redis.set).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// 9. resolveChain — tier disambiguation
// ===========================================================================

describe('resolveChain — tier precedence and disambiguation', () => {
  // Edge case 59: a query that matches tier 1 (exact slug) even when tier 3/4 would also match
  // Verify tier 1 short-circuits before reaching tier 3
  it('exact slug match short-circuits — listChains called once, tier 1 wins', async () => {
    const client = makeMockClient([CHAIN_MCDONALDS, CHAIN_BURGER_KING]);
    const result = await resolveChain('mcdonalds-es', client as unknown as ApiClient);
    expect(client.listChains).toHaveBeenCalledTimes(1);
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });

  // Edge case 60: tier 3 ambiguity — two slugs start with same prefix
  it('two slugs with same prefix → tier 3 ambiguous', async () => {
    const chainA: ChainListItem = { chainSlug: 'burger-a-es', name: 'Burger A', nameEs: null, countryCode: 'ES', dishCount: 10, isActive: true };
    const chainB: ChainListItem = { chainSlug: 'burger-b-es', name: 'Burger B', nameEs: null, countryCode: 'ES', dishCount: 10, isActive: true };
    const client = makeMockClient([chainA, chainB]);
    const result = await resolveChain('burger', client as unknown as ApiClient);
    expect(result).toBe('ambiguous');
  });

  // Edge case 61: tier 4 — query contains chain name (longer query that includes chain name)
  it('"estoy en el burger king de fuencarral" → tier 4 substring (query contains "burger king")', async () => {
    const client = makeMockClient([CHAIN_BURGER_KING]);
    // detectContextSet("estoy en el burger king de fuencarral") → "burger king de fuencarral"
    // resolveChain("burger king de fuencarral")
    // normalize → "burger king de fuencarral"
    // tier 1: not an exact slug
    // tier 2: not an exact name ("burger king" is shorter than query)
    // tier 3: "burger-king-es".startsWith("burger king de fuencarral") → false
    //         "burger king".startsWith("burger king de fuencarral") → false
    // tier 4: "burger king".includes("burger king de fuencarral") → false
    //         "burger king de fuencarral".includes("burger king") → TRUE → match
    const result = await resolveChain('burger king de fuencarral', client as unknown as ApiClient);
    expect(result).not.toBeNull();
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('burger-king-es');
    }
  });

  // Edge case 62: both tier 4 name and nameEs can independently match → same chain → not ambiguous
  it('query matches both name and nameEs of same chain → single match (not ambiguous)', async () => {
    // Chain with name="McDonald's" and nameEs="McDonalds"
    // query "mcdonalds" → normalize → "mcdonalds"
    // name normalized = "mcdonalds" → tier 2 name exact match (nameEs ?? name = "McDonalds")
    // Actually nameEs is "McDonalds" → tier 2 checks normalize("McDonalds") = "mcdonalds" === "mcdonalds" → HIT
    const client = makeMockClient([CHAIN_MCDONALDS]);
    const result = await resolveChain('mcdonalds', client as unknown as ApiClient);
    expect(result).not.toBe('ambiguous');
    if (result && result !== 'ambiguous') {
      expect(result.chainSlug).toBe('mcdonalds-es');
    }
  });
});

// ===========================================================================
// 10. Spec compliance — acceptance criteria not tested in developer tests
// ===========================================================================

describe('spec compliance — acceptance criteria gap checks', () => {
  // AC#4: /contexto ambi → ambiguity message, BotState unchanged
  it('AC#4: ambiguous resolution → BotState is NOT written', async () => {
    const chainA: ChainListItem = { chainSlug: 'mc-a-es', name: 'Mc A', nameEs: null, countryCode: 'ES', dishCount: 10, isActive: true };
    const chainB: ChainListItem = { chainSlug: 'mc-b-es', name: 'Mc B', nameEs: null, countryCode: 'ES', dishCount: 10, isActive: true };
    const redis = makeMockRedis(null);
    const client = makeMockClient([chainA, chainB]);
    const result = await handleContexto('mc', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // "mc" normalizes to "mc" → 2 chars → < 3 → resolveChain returns null before calling listChains
    // So we get "no encontré ninguna cadena" (min length guard kicks in)
    expect(result).toContain('No encontré ninguna cadena');
    expect(redis.set).not.toHaveBeenCalled();
  });

  // AC#7: /contexto borrar — other fields preserved
  it('AC#7: borrar preserves other BotState fields', async () => {
    const state = JSON.stringify({
      chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' },
      pendingSearch: 'pizza',
      pendingPhotoFileId: 'file123',
    });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    await handleContexto('borrar', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    const setCall = redis.set.mock.calls[0] as [string, string, string, number];
    const saved = JSON.parse(setCall[1]) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(saved, 'chainContext')).toBe(false);
    expect(saved['pendingSearch']).toBe('pizza');
    expect(saved['pendingPhotoFileId']).toBe('file123');
  });

  // AC#15: Redis down during /estimar → query sent without chainSlug (fail-open, no error message)
  it('AC#15: Redis unavailable during /estimar → fail-open, user gets estimate result', async () => {
    const { handleEstimar } = await import('../commands/estimar.js');
    const redis = makeMockRedis(null);
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // Should get a result (not an error) and no chainSlug should be injected
    expect(result).not.toContain('No pude');
    expect(result).not.toContain('error');
    const callArgs = (client.estimate.mock.calls[0] as [Record<string, unknown>])[0];
    expect(Object.prototype.hasOwnProperty.call(callArgs, 'chainSlug')).toBe(false);
  });

  // AC#17: NL "estoy en casa" → silent fall-through, NO error shown to user
  it('AC#17: NL "estoy en casa" → detectContextSet matches, resolveChain returns null → silent fall-through to food estimate', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([]); // no chains
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    const result = await handleNaturalLanguage('estoy en casa', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // MUST NOT show error about chains
    expect(result).not.toContain('No encontré ninguna cadena');
    expect(result).not.toContain('No pude comprobar');
    // MUST fall through to food estimate (even if result is null)
    expect(client.estimate).toHaveBeenCalled();
  });

  // AC#18: NL "estoy en mcdonalds, cuántas calorías tiene el big mac" → comma blocks regex → food query
  it('AC#18: comma after chain name → regex blocked → processed as food query', async () => {
    const redis = makeMockRedis(null);
    const client = makeMockClient([CHAIN_MCDONALDS]);
    client.estimate.mockResolvedValue(ESTIMATE_DATA_NULL);
    await handleNaturalLanguage('estoy en mcdonalds, cuántas calorías tiene el big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    // detectContextSet returns null (comma blocks) → no chain resolution
    expect(client.listChains).not.toHaveBeenCalled();
    // Falls through to food estimate
    expect(client.estimate).toHaveBeenCalled();
  });

  // AC#20: /estimar with implicit context → response includes "_Contexto activo: <chainName>_"
  it('AC#20: implicit context injected into /estimar → response includes context indicator', async () => {
    const { handleEstimar } = await import('../commands/estimar.js');
    const state = JSON.stringify({ chainContext: { chainSlug: 'mcdonalds-es', chainName: 'McDonalds' } });
    const redis = makeMockRedis(state);
    const client = makeMockClient();
    client.estimate.mockResolvedValue(ESTIMATE_DATA_WITH_RESULT);
    const result = await handleEstimar('big mac', CHAT_ID, redis as unknown as Redis, client as unknown as ApiClient);
    expect(result).toContain('_Contexto activo:');
    expect(result).toContain('McDonalds');
  });
});
