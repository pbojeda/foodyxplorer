/**
 * @jest-environment node
 *
 * F044 — Landing Page Overhaul: Edge-Case & Spec-Deviation Tests
 *
 * QA-authored tests targeting gaps not covered by the developer's test suite.
 *
 * API-route cases use the node environment so Request/Response are available natively.
 * Non-API cases (phone schema, content integrity) are pure unit tests with no DOM needs.
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

// Reproduce the exact schema used by WaitlistForm and the API route
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
// 2. WaitlistPayload type drift — phone field missing in types/index.ts
//    This is a static analysis concern; we verify the runtime behaviour
//    by testing the route directly.
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/waitlist/route';

function makeJsonRequest(body: unknown) {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/waitlist — phone field edge cases', () => {
  it('returns 200 when phone is absent (optional)', async () => {
    const req = makeJsonRequest({ email: 'user@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 200 when phone is an empty string (optional)', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 200 when phone is a valid Spanish number', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '+34612345678' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 400 when phone is present but invalid format', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: 'notaphone' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when phone is a number without + prefix', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '34612345678' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when phone is too short (+12345)', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '+12345' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when phone is excessively long (16 digits after +)', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '+1234567890123456' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when phone contains letters', async () => {
    const req = makeJsonRequest({ email: 'user@example.com', phone: '+34ABC345678' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Double-submit: submit the same valid payload twice back-to-back.
  // Each POST must return a well-formed HTTP response (no crash on second call).
  // -------------------------------------------------------------------------
  it('handles two rapid consecutive requests without crashing', async () => {
    const payload = { email: 'user@example.com' };
    const [r1, r2] = await Promise.all([
      POST(makeJsonRequest(payload)),
      POST(makeJsonRequest(payload)),
    ]);
    expect([200, 400]).toContain(r1.status);
    expect([200, 400]).toContain(r2.status);
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

// ---------------------------------------------------------------------------
// 6. API route — concurrent requests and additional security cases
// ---------------------------------------------------------------------------
describe('POST /api/waitlist — concurrency and additional security', () => {
  it('handles 10 concurrent valid requests without crashing', async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      POST(
        makeJsonRequest({ email: `user${i}@example.com` })
      )
    );
    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it('rejects email with embedded newline (CRLF injection attempt)', async () => {
    const req = makeJsonRequest({ email: 'user\r\n@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects email with null byte', async () => {
    const req = makeJsonRequest({ email: 'user\0@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects email that is an array', async () => {
    const req = makeJsonRequest({ email: ['user@example.com'] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects email that is an object', async () => {
    const req = makeJsonRequest({ email: { value: 'user@example.com' } });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns a body with success:false and an error string on 400', async () => {
    const req = makeJsonRequest({ email: 'not-valid' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.error!.length).toBeGreaterThan(0);
  });

  /**
   * RISK — No rate limiting implemented.
   * The route currently accepts unlimited POST requests.
   * An attacker can spam the waitlist with synthetic addresses.
   * Fix: add rate limiting middleware (e.g. Upstash Ratelimit) at the
   * Next.js middleware layer before the route handler runs.
   *
   * Marked .todo because implementing rate limiting is outside the
   * scope of F044, but the risk should be tracked.
   */
  it.todo('[RISK] POST /api/waitlist has no rate limiting — waitlist can be spammed');

  /**
   * BUG — Double-submit race condition in WaitlistForm:
   * handleSubmit does NOT check if status === 'loading' before proceeding.
   * If two submit events fire before the first setStatus('loading') renders
   * (theoretically possible in concurrent React), both would proceed to fetch.
   *
   * In practice, React batches state updates so the second submit is blocked
   * by the button being disabled, but the form's onSubmit handler has no guard.
   *
   * Marked .todo to document the gap; severity LOW because the disabled button
   * provides a practical guard for normal browser interaction.
   */
  it.todo(
    '[BUG] WaitlistForm.handleSubmit has no early return when status === "loading"'
  );
});
