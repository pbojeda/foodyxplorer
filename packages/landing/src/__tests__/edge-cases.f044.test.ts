/**
 * @jest-environment node
 *
 * F044 — Landing Page Overhaul: Edge-Case & Spec-Deviation Tests
 *
 * QA-authored tests targeting gaps not covered by the developer's test suite.
 *
 * Note: API route tests (sections 2 and 6) removed in F046 — the Next.js
 * /api/waitlist route was deleted and replaced by the Fastify API.
 */

// ---------------------------------------------------------------------------
// 1. Phone validation — regex discrepancy between spec and implementation
//
// Spec says:  /^\+\d{1,3}\s?\d{6,12}$/  (one optional space)
// Impl uses:  strip all spaces, then /^\+\d{7,15}$/
//
// Both accept common Spanish / international formats, but there are edge cases.
// ---------------------------------------------------------------------------
import { z } from 'zod';

// Reproduce the exact schema used by WaitlistForm
const phoneSchema = z
  .string()
  .optional()
  .refine(
    (val) => {
      if (!val || val.trim() === '') return true;
      const stripped = val.replace(/\s/g, '');
      return /^\+\d{7,15}$/.test(stripped);
    },
    { message: 'Introduce un teléfono válido (ej: +34 612 345 678)' }
  );

function phoneValid(val: string): boolean {
  return phoneSchema.safeParse(val).success;
}

describe('Phone validation — boundary and edge cases', () => {
  // ---------- should accept ----------

  it('accepts standard Spanish mobile (+34 612345678)', () => {
    expect(phoneValid('+34612345678')).toBe(true);
  });

  it('accepts Spanish mobile with single space (+34 612345678)', () => {
    expect(phoneValid('+34 612345678')).toBe(true);
  });

  it('accepts Spanish mobile with multiple spaces (+34 612 345 678)', () => {
    // Spec regex only allows ONE optional space; impl strips ALL spaces.
    // This is MORE permissive than spec — document the behaviour.
    expect(phoneValid('+34 612 345 678')).toBe(true);
  });

  it('accepts US number (+1 2125550100)', () => {
    expect(phoneValid('+1 2125550100')).toBe(true);
  });

  it('accepts empty string (phone is optional)', () => {
    expect(phoneValid('')).toBe(true);
  });

  it('accepts undefined (phone is optional)', () => {
    expect(phoneSchema.safeParse(undefined).success).toBe(true);
  });

  it('accepts number with 3-digit country code (+351 912345678)', () => {
    expect(phoneValid('+351 912345678')).toBe(true);
  });

  // ---------- should reject ----------

  it('rejects phone without + prefix (34612345678)', () => {
    expect(phoneValid('34612345678')).toBe(false);
  });

  it('rejects phone that is only + with no digits', () => {
    expect(phoneValid('+')).toBe(false);
  });

  it('rejects phone that is too short (+12345 — 5 digits total stripped)', () => {
    // +12345 stripped = 6 chars total, 5 digits after +  → fails /^\+\d{7,15}$/
    expect(phoneValid('+12345')).toBe(false);
  });

  it('rejects phone that is way too long (16 digits after +)', () => {
    expect(phoneValid('+1234567890123456')).toBe(false);
  });

  it('rejects plain text that is not a phone number', () => {
    expect(phoneValid('notaphone')).toBe(false);
  });

  it('rejects a phone number with letters (+34ABC345678)', () => {
    expect(phoneValid('+34ABC345678')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. SectionId type drift
//    page.tsx uses 'product-demo' and 'restaurants' as sectionId values,
//    but the SectionId union type in types/index.ts does not include them.
//    This will cause TypeScript errors if SectionObserver ever tightens its
//    sectionId prop type from `string` to `SectionId`.
//
//    The test below documents the known missing values.
// ---------------------------------------------------------------------------
import type { SectionId } from '@/types';

describe('SectionId type — documented missing values (spec deviation)', () => {
  /**
   * SPEC DEVIATION (severity: LOW)
   *
   * page.tsx passes sectionId="product-demo" and sectionId="restaurants"
   * to <SectionObserver>, but neither value is in the SectionId union type.
   * SectionObserver currently accepts `string`, so no runtime error occurs,
   * but if the type is ever tightened the page will fail to compile.
   *
   * Fix: add 'product-demo' | 'restaurants' to SectionId in types/index.ts,
   * and remove 'problem' which is no longer used.
   */
  it.todo(
    '[SPEC DEVIATION] SectionId type should include "product-demo" and "restaurants"'
  );

  // Type-level check: confirm 'hero' is in SectionId (compile-time only)
  const heroId: SectionId = 'hero';
  it('SectionId type includes "hero"', () => {
    expect(heroId).toBe('hero');
  });
});

// ---------------------------------------------------------------------------
// 4. content.ts integrity — all 10 dishes are present and have all required fields
// ---------------------------------------------------------------------------
import { DISHES, getConfidenceBadgeClass, getLevelDisplay } from '@/lib/content';
import type { ConfidenceLevel } from '@/lib/content';

const REQUIRED_DISH_QUERIES = [
  'big mac',
  'pulpo a feira',
  'poke salmón',
  'tortilla española',
  'lentejas con chorizo',
  'huevos rotos',
  'ensalada césar',
  'paella valenciana',
  'croquetas de jamón',
  'pizza margarita',
];

describe('DISHES content data — integrity checks', () => {
  it('contains exactly 10 pre-loaded dishes', () => {
    expect(DISHES).toHaveLength(10);
  });

  it.each(REQUIRED_DISH_QUERIES)('contains dish with query "%s"', (query) => {
    const found = DISHES.find((d) => d.query === query);
    expect(found).toBeDefined();
  });

  it('covers all three confidence levels (L1, L2, L3)', () => {
    const levels = new Set(DISHES.map((d) => d.level));
    expect(levels.has('L1')).toBe(true);
    expect(levels.has('L2')).toBe(true);
    expect(levels.has('L3')).toBe(true);
  });

  it('every dish has positive numeric nutritional values', () => {
    for (const dish of DISHES) {
      expect(dish.kcal).toBeGreaterThan(0);
      expect(dish.protein).toBeGreaterThanOrEqual(0);
      expect(dish.carbs).toBeGreaterThanOrEqual(0);
      expect(dish.fat).toBeGreaterThanOrEqual(0);
    }
  });

  it('every dish has non-empty note and allergen fields', () => {
    for (const dish of DISHES) {
      expect(dish.note.trim().length).toBeGreaterThan(0);
      expect(dish.allergen.trim().length).toBeGreaterThan(0);
    }
  });

  it('getConfidenceBadgeClass returns a non-empty string for all levels', () => {
    const levels: ConfidenceLevel[] = ['L1', 'L2', 'L3'];
    for (const level of levels) {
      expect(getConfidenceBadgeClass(level).trim().length).toBeGreaterThan(0);
    }
  });

  it('getLevelDisplay returns string containing level number', () => {
    expect(getLevelDisplay('L1', 'Alta')).toContain('1');
    expect(getLevelDisplay('L2', 'Media')).toContain('2');
    expect(getLevelDisplay('L3', 'Baja')).toContain('3');
  });

  it('L1 dishes have official allergen confirmation text', () => {
    const l1Dishes = DISHES.filter((d) => d.level === 'L1');
    for (const dish of l1Dishes) {
      // L1 = official source; allergen note should indicate verification
      expect(dish.allergen.toLowerCase()).toContain('verific');
    }
  });

  it('dish queries are all lower-case (autocomplete matching is case-sensitive on query field)', () => {
    for (const dish of DISHES) {
      expect(dish.query).toBe(dish.query.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// 5. SearchSimulator autocomplete filter logic — unit tests on the filter
//    (isolated from component rendering)
// ---------------------------------------------------------------------------
describe('SearchSimulator filter logic — edge cases', () => {
  function filterDishes(query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return DISHES.filter((d) => d.query.includes(normalized));
  }

  it('empty query returns empty suggestions (button should be disabled)', () => {
    expect(filterDishes('')).toHaveLength(0);
  });

  it('whitespace-only query returns empty suggestions', () => {
    expect(filterDishes('   ')).toHaveLength(0);
  });

  it('partial match "pok" returns poke salmón', () => {
    const result = filterDishes('pok');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.query).toBe('poke salmón');
  });

  it('exact match returns one result', () => {
    expect(filterDishes('big mac')).toHaveLength(1);
  });

  it('query with no match returns empty array (no-result state triggered)', () => {
    expect(filterDishes('platillo marciano xyz123')).toHaveLength(0);
  });

  it('case-insensitive match: "BIG MAC" finds big mac', () => {
    expect(filterDishes('BIG MAC')).toHaveLength(1);
  });

  it('query with leading/trailing spaces still matches ("  big mac  ")', () => {
    expect(filterDishes('  big mac  ')).toHaveLength(1);
  });

  it('common prefix "a" matches multiple dishes', () => {
    // 'a' appears in several dish queries (paella, ensalada, etc.)
    const results = filterDishes('a');
    expect(results.length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // RISK: a very long input string — must not cause catastrophic backtracking
  // or throw. String.includes() is safe, but document it anyway.
  // -------------------------------------------------------------------------
  it('extremely long query (1000 chars) returns empty and does not throw', () => {
    const longQuery = 'x'.repeat(1000);
    expect(() => filterDishes(longQuery)).not.toThrow();
    expect(filterDishes(longQuery)).toHaveLength(0);
  });
});
