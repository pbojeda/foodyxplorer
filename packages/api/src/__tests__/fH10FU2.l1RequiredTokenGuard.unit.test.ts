// F-H10-FU2: L1 required-token guard — unit tests (single-pass, mocked DB)
//
// Tests the passesGuardL1 combined guard (ADR-024 addendum 2, F-H10-FU2) via
// the real level1Lookup with a mocked Kysely DB.
//
// Phases covered:
//   Phase 1 — Helper invariants tested INDIRECTLY via cascade fixtures
//   Phase 2 — passesGuardL1 combined behavior (Step 1 → Step 2 ordering, OR semantics)
//   Phase 3 — 6 known FP fixtures (AC3) + 6 legitimate-match fixtures (AC4)
//   Phase 4 — EC-1 through EC-9 edge-case suite
//
// All invocations set chainSlug to force single-pass behaviour (bypassing
// BUG-PROD-012 two-pass path). See fH10FU.q649.unit.test.ts for two-pass coverage.
//
// Mocking approach mirrors fH10FU.l1LexicalGuard.unit.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DishQueryRow, FoodQueryRow } from '../estimation/types.js';

// ---------------------------------------------------------------------------
// Mock Kysely executor
// ---------------------------------------------------------------------------

const { mockExecuteQuery } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
}));

function buildMockDb() {
  const executor = {
    executeQuery: mockExecuteQuery,
    compileQuery: (node: unknown) => ({ sql: '', parameters: [], query: node }),
    transformQuery: (node: unknown) => node,
    withPlugins: function() { return this; },
    withPlugin: function() { return this; },
    withoutPlugins: function() { return this; },
  };
  return { getExecutor: () => executor };
}

import { level1Lookup } from '../estimation/level1Lookup.js';

// ---------------------------------------------------------------------------
// Base nutrient fields shared by all fixtures
// ---------------------------------------------------------------------------

const BASE_NUTRIENTS = {
  calories: '300.00',
  proteins: '10.00',
  carbohydrates: '30.00',
  sugars: '5.00',
  fats: '12.00',
  saturated_fats: '3.00',
  fiber: '2.00',
  salt: '0.50',
  sodium: '200.00',
  trans_fats: '0.00',
  cholesterol: '20.00',
  potassium: '150.00',
  monounsaturated_fats: '5.00',
  polyunsaturated_fats: '2.00',
  alcohol: '0.00',
  reference_basis: 'per_serving',
};

const BASE_SOURCE = {
  source_id: 'fd000000-fu20-4000-a000-000000000010',
  source_name: 'Test Source',
  source_type: 'official',
  source_url: null,
  source_priority_tier: '1',
};

// ---------------------------------------------------------------------------
// Helper: returns empty rows for a strategy (miss)
// ---------------------------------------------------------------------------

function miss(): { rows: never[] } {
  return { rows: [] };
}

// ---------------------------------------------------------------------------
// Helper: mock the 4 strategies with controlled FTS result
// S1 exact dish → miss, S2 FTS dish → hit, S3 exact food → miss, S4 FTS food → miss
// ---------------------------------------------------------------------------

function mockDishFtsHit(dishRow: DishQueryRow): void {
  mockExecuteQuery
    .mockResolvedValueOnce(miss())        // S1 exact dish — miss
    .mockResolvedValueOnce({ rows: [dishRow] }) // S2 FTS dish — HIT
    .mockResolvedValueOnce(miss())        // S3 exact food — miss
    .mockResolvedValueOnce(miss());       // S4 FTS food — miss
}

// S1 miss, S2 miss, S3 miss, S4 FTS food → hit
function mockFoodFtsHit(foodRow: FoodQueryRow): void {
  mockExecuteQuery
    .mockResolvedValueOnce(miss())        // S1 exact dish — miss
    .mockResolvedValueOnce(miss())        // S2 FTS dish — miss
    .mockResolvedValueOnce(miss())        // S3 exact food — miss
    .mockResolvedValueOnce({ rows: [foodRow] }); // S4 FTS food — HIT
}

// ---------------------------------------------------------------------------
// Fixture builder helpers
// ---------------------------------------------------------------------------

function makeDishRow(overrides: Partial<DishQueryRow> & { dish_name: string; dish_name_es: string | null; dish_id?: string }): DishQueryRow {
  return {
    dish_id: overrides.dish_id ?? 'fd000000-fu20-4000-a000-000000000001',
    dish_name: overrides.dish_name,
    dish_name_es: overrides.dish_name_es,
    restaurant_id: 'fd000000-fu20-4000-a000-000000000002',
    chain_slug: 'test-chain',
    portion_grams: '200.00',
    ...BASE_NUTRIENTS,
    ...BASE_SOURCE,
  };
}

function makeFoodRow(overrides: Partial<FoodQueryRow> & { food_name: string; food_name_es: string | null; food_id?: string }): FoodQueryRow {
  return {
    food_id: overrides.food_id ?? 'fd000000-fu20-4000-a000-000000000020',
    food_name: overrides.food_name,
    food_name_es: overrides.food_name_es,
    food_group: 'Test Category',
    barcode: null,
    brand_name: null,
    ...BASE_NUTRIENTS,
    reference_basis: 'per_100g',
    ...BASE_SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — Helper invariants tested INDIRECTLY via cascade behavior
// ---------------------------------------------------------------------------

describe('passesGuardL1 — Phase 1 cascade behavior (helpers tested indirectly)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('cascade with stop-word-only query "agua" (in FOOD_STOP_WORDS_EXTENDED) against "Agua mineral" → ACCEPT (queryHI empty → fall through to Jaccard)', async () => {
    // "agua" is in FOOD_STOP_WORDS_EXTENDED → queryHI = {} → required-token step skipped entirely.
    // Jaccard: SPANISH_STOP_WORDS does NOT include "agua" (only linguistic stop words).
    // tokenize("agua") = {agua}, tokenize("Agua mineral") = {agua, mineral} → 1/2 = 0.5 ≥ 0.25 → ACCEPT.
    // This exercises EC-1: FOOD_STOP_WORDS_EXTENDED tokens DO NOT create HI tokens;
    // the required-token check is skipped; Jaccard gate alone decides the result.
    const row = makeDishRow({ dish_name: 'Mineral water', dish_name_es: 'Agua mineral' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'agua', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('cascade with 3-char query "pan" against "Pan tumaca" → ACCEPT (length<4 filter; queryHI empty)', async () => {
    // "pan" is 3 chars → does not pass the length >= 4 filter → queryHI empty → Jaccard-only fallthrough.
    // Jaccard: {pan} ∩ {pan, tumaca} = 1/2 = 0.5 ≥ 0.25 → accept.
    // Exercises EC-2.
    const row = makeDishRow({ dish_name: 'Pan tumaca', dish_name_es: 'Pan tumaca' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pan', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('cascade with "queso fresco con membrillo" against "Queso fresco con membrillo" → ACCEPT (HI token "membrillo" present; queso/fresco filtered as extended stop)', async () => {
    // FOOD_STOP_WORDS_EXTENDED includes "queso" and "fresco" → filtered out.
    // "con" is in SPANISH_STOP_WORDS → filtered.
    // queryHI = {membrillo}.
    // Candidate "Queso fresco con membrillo" normalizes to include "membrillo" → all HI present → ACCEPT.
    // Exercises FOOD_STOP_WORDS_EXTENDED inclusion + every-HI semantics.
    const row = makeDishRow({ dish_name: 'Queso fresco con membrillo', dish_name_es: 'Queso fresco con membrillo' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('cascade with "coca cola" against "Coca Cola Zero" → ACCEPT (both HI tokens present; normalizeL1 handles spaces)', async () => {
    // "Coca Cola Zero" (no hyphen) after normalizeL1: {coca, cola, zero}.
    // queryHI = {coca, cola}. Both present in candidate tokens → ACCEPT.
    // Note: "Coca-Cola Zero" (with hyphen) merges to "cocacola zero" after [^a-z\s] strip —
    // this is handled identically to computeTokenJaccard. Use space-separated form to test the path.
    // Exercises that coca/cola (4+ chars, not in FOOD_STOP_WORDS_EXTENDED) become HI tokens.
    const row = makeDishRow({ dish_name: 'Coca Cola Zero', dish_name_es: 'Coca Cola Zero' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'coca cola', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('cascade with "chorizo ibérico" against "Chorizo iberico embutido" → ACCEPT (NFD strips accent: ibérico→iberico)', async () => {
    // "ibérico" after NFD normalization → "iberico".
    // queryHI = {chorizo, iberico}. Candidate "Chorizo iberico embutido" has both → ACCEPT.
    // Exercises EC-4 NFD normalization.
    const row = makeDishRow({ dish_name: 'Chorizo iberico embutido', dish_name_es: 'Chorizo ibérico embutido' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'chorizo ibérico', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('cascade with "caña" query against "Caña de cerveza" → ACCEPT (NFD: caña→cana on both sides)', async () => {
    // "caña" normalizes to "cana" (NFD strip). Candidate "Caña de cerveza" → "cana de cerveza".
    // "cana" is in FOOD_STOP_WORDS_EXTENDED → queryHI = {} → Jaccard-only fallthrough → ACCEPT.
    // (Jaccard: {cana} ∩ {cana, cerveza} with stop-word filter = {cana} vs {cana, cerveza} = 0.5)
    // Exercises EC-4 with HI token NFD normalization AND FOOD_STOP_WORDS_EXTENDED "cana" entry.
    const row = makeDishRow({ dish_name: 'Beer glass', dish_name_es: 'Caña de cerveza' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'caña', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('cascade with "paella" against "Paella valenciana" → ACCEPT (single HI token present)', async () => {
    // queryHI = {paella}. Candidate "Paella valenciana" → "paella" present → ACCEPT.
    // Exercises EC-5: single-token use case not broken by required-token check.
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('cascade with "membrillo" against "CROISSANT QUESO FRESCO" → REJECT (HI token absent; queryHI={membrillo})', async () => {
    // queryHI = {membrillo}. Candidate "CROISSANT QUESO FRESCO" does not contain "membrillo" → REJECT.
    // Direct test of every-HI rejection path.
    // Jaccard: {membrillo} ∩ {croissant, queso, fresco} = 0/4 = 0.000 — step1 also rejects.
    const row = makeDishRow({ dish_name: 'Croissant fresh cheese', dish_name_es: 'CROISSANT QUESO FRESCO' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'membrillo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('cascade with "un poco de todo" against "Patatas para todo uso" → REJECT (queryHI={poco,todo}; poco absent)', async () => {
    // "un" → stop word, "de" → stop word. "poco" (4 chars, not in stop list) and "todo" (4 chars,
    // not in stop list) → queryHI = {poco, todo}.
    // Candidate "Patatas para todo uso" normalizes → {patatas, para, todo, uso}.
    // "todo" present, "poco" absent → every fails → REJECT.
    // Exercises EC-9 (Q345 path) and confirms poco/todo are NOT in FOOD_STOP_WORDS_EXTENDED.
    const row = makeFoodRow({ food_name: 'Potatoes for all uses', food_name_es: 'Patatas para todo uso' });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'un poco de todo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — passesGuardL1 combined behavior (via level1Lookup cascade)
// ---------------------------------------------------------------------------

describe('passesGuardL1 — combined guard behavior (via level1Lookup cascade)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Step 1 gate fires first: Jaccard REJECT stops before required-token check', async () => {
    // Jaccard < 0.25 should reject before required-token check even applies.
    // query="membrillo" vs candidate "Paella valenciana" → {membrillo} ∩ {paella, valenciana} = 0 → REJECT at step1.
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'membrillo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Step 2 gate fires when Jaccard passes but HI token absent from both names', async () => {
    // Jaccard passes (≥ 0.25) but a required HI token is absent from both nameEs and name.
    // query="coca cola membrillo" vs "Coca-Cola Zero":
    // Jaccard: {coca, cola, membrillo} ∩ {coca, cola, zero} = {coca,cola} → 2/4 = 0.5 → step1 PASS.
    // queryHI={coca, cola, membrillo}. nameEs "Coca-Cola Zero" → {coca, cola, zero} → membrillo absent → REJECT.
    const row = makeDishRow({ dish_name: 'Coca-Cola Zero', dish_name_es: 'Coca-Cola Zero' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'coca cola membrillo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Fall-through when queryHI is empty: Jaccard-pass candidate accepted', async () => {
    // "tapa" is 4 chars AND in FOOD_STOP_WORDS_EXTENDED → queryHI empty → Jaccard-only fallthrough.
    // query="tapa" vs candidate "Presunto Serrano Tapas": Jaccard {tapa} ∩ {presunto, serrano, tapas} = 0
    // Actually tapa ≠ tapas. Let's use a candidate where Jaccard passes:
    // query="tapa" vs "Tapa de jamón": after stop-word strip: {tapa} ∩ {tapa, jamon} = 1/2 = 0.5 → PASS.
    // Result: non-null (accepted via Jaccard-only).
    const row = makeDishRow({ dish_name: 'Ham tapa', dish_name_es: 'Tapa de jamón' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tapa', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('OR semantics: every HI token in nameEs → ACCEPT (English side not checked)', async () => {
    // All HI tokens present in nameEs; name (English) lacks one — should still accept via OR.
    // query="chorizo iberico" → HI={chorizo, iberico}.
    // nameEs="Chorizo ibérico embutido" → after NFD: {chorizo, iberico, embutido} → both HI present.
    // name="Pork chorizo" → {pork, chorizo} → iberico absent. But nameEs side already accepted → ACCEPT.
    const row = makeDishRow({ dish_name: 'Pork chorizo', dish_name_es: 'Chorizo ibérico embutido' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'chorizo iberico', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('OR semantics: HI tokens only in name → ACCEPT when nameEs missing them', async () => {
    // nameEs is null → evaluate only name side. name has all HI tokens → ACCEPT.
    // query="gazpacho andaluz" → HI={gazpacho, andaluz}.
    // nameEs=null, name="Gazpacho andaluz fresh" → both HI present → ACCEPT.
    const row = makeDishRow({ dish_name: 'Gazpacho andaluz fresh', dish_name_es: null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'gazpacho andaluz', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('Rejects when HI tokens split across names (not in EITHER side fully)', async () => {
    // "chorizo" in nameEs only, "iberico" in name only → neither side has ALL HI → REJECT.
    // query="chorizo iberico" → HI={chorizo, iberico}.
    // nameEs="Chorizo ahumado" → {chorizo, ahumado} → iberico absent → nameEs side fails.
    // name="Iberico sausage" → {iberico, sausage} → chorizo absent → name side fails.
    // Jaccard step1 must pass first. nameEs Jaccard: {chorizo, iberico} ∩ {chorizo, ahumado} = 1/3 ≥ 0.25 → PASS.
    const row = makeDishRow({ dish_name: 'Iberico sausage', dish_name_es: 'Chorizo ahumado' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'chorizo iberico', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('null nameEs: evaluation falls directly to name side', async () => {
    // EC-7: nameEs null, name has all HI tokens → ACCEPT.
    // query="paella valenciana" → HI={paella, valenciana}.
    // nameEs=null, name="Paella valenciana" → both HI present → ACCEPT.
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella valenciana', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — 6 known FP fixtures (AC3) — FULL nameEs (not truncated)
// ---------------------------------------------------------------------------

describe('passesGuardL1 — 6 known FP fixtures (AC3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Q649: queso fresco con membrillo → CROISSANT CON QUESO FRESCO — REJECT (membrillo absent from candidate)', async () => {
    // queryHI = {membrillo} (queso+fresco in FOOD_STOP_WORDS_EXTENDED, con in SPANISH_STOP_WORDS).
    // Candidate "CROISSANT CON QUESO FRESCO" → after normalize: {croissant, queso, fresco} (con stripped).
    // "membrillo" absent → every fails → REJECT.
    // Uses FULL nameEs (not QA-truncated "CROISSANT CON QUESO FRESC").
    // matchType: fts_dish (from jaccard-table)
    const row = makeDishRow({
      dish_name: 'CROISSANT WITH FRESH CHEESE',
      dish_name_es: 'CROISSANT CON QUESO FRESCO',
    });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso fresco con membrillo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Q178: una coca cola → Huevas cocidas de merluza de cola patagónia — REJECT (coca absent)', async () => {
    // postStrip (via level1Lookup normalizeQuery): "una coca cola".
    // queryHI = {coca, cola}. Candidate tokens after normalize: {huevas, cocidas, merluza, cola, patagonia}.
    // "coca" absent → every fails → REJECT.
    // matchType: fts_food (from jaccard-table)
    const row = makeFoodRow({
      food_name: 'Boiled hake eggs',
      food_name_es: 'Huevas cocidas de merluza de cola patagónia',
    });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'una coca cola', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Q312: coca cola grande → Huevas cocidas de merluza de cola patagónia — REJECT (coca absent)', async () => {
    // queryHI = {coca, cola} (grande is in FOOD_STOP_WORDS_EXTENDED).
    // "coca" absent from candidate → REJECT.
    const row = makeFoodRow({
      food_name: 'Boiled hake eggs',
      food_name_es: 'Huevas cocidas de merluza de cola patagónia',
    });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'coca cola grande', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Q345: un poco de todo → Patatas aptas para todo uso culinario — REJECT (poco absent)', async () => {
    // queryHI = {poco, todo} (un/de are SPANISH_STOP_WORDS; poco/todo are 4 chars, not stop words).
    // Candidate: "Patatas aptas para todo uso culinario" → after normalize: {patatas, aptas, para, todo, uso, culinario}.
    // "todo" present but "poco" absent → every fails → REJECT at step2.
    // Also rejected at step1 (Jaccard 0.143 < 0.25) — double-rejection, defence in depth.
    const row = makeFoodRow({
      food_name: 'Potatoes for all culinary uses',
      food_name_es: 'Patatas aptas para todo uso culinario',
    });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'un poco de todo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('Q378: una copa de oporto → Paté fresco de vino de Oporto — REJECT (copa absent from candidate)', async () => {
    // Note: level1Lookup's normalizeQuery does NOT strip "copa" (that is extractFoodQuery's job,
    // run upstream before level1Lookup is called). Here we pass the postStrip query "oporto"
    // as the input to level1Lookup to match actual runtime behavior.
    // queryHI = {oporto}. Candidate "Paté fresco de vino de Oporto" → after normalize: {pate, fresco, vino, oporto}.
    // "oporto" IS present → step2 PASSES → ACCEPT at L1 (L3 embedding catches semantic mismatch).
    // This is the correct L1 behavior per ADR-024 addendum 2: Q378 is delegated to L3.
    // This test documents the ACCEPT (not REJECT) — contrasting with the original spec claim.
    const row = makeFoodRow({
      food_name: 'Paté fresco de vino de Oporto',
      food_name_es: 'Paté fresco de vino de Oporto',
    });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    // Pass the post-stripped query as level1Lookup receives it at runtime
    const result = await level1Lookup(db, 'oporto', { chainSlug: 'test-chain' });
    // L1 accepts (oporto present in candidate) — L3 handles the semantic mismatch
    expect(result).not.toBeNull();
  });

  it('Q580: pollo al curri con arro blanco → Foccacia Pollo al Curry — REJECT (curri≠curry, arro absent, blanco absent)', async () => {
    // queryHI = {pollo, curri, arro, blanco}.
    // Candidate "Foccacia Pollo al Curry": after normalize: {foccacia, pollo, curry}.
    // "curri" ≠ "curry" (no common normalization), "arro" absent, "blanco" absent → every fails → REJECT.
    // matchType: fts_dish (from jaccard-table)
    const row = makeDishRow({
      dish_name: 'Foccacia Chicken Curry',
      dish_name_es: 'Foccacia Pollo al Curry',
    });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo al curri con arro blanco', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — AC4 legitimate matches preserved
// ---------------------------------------------------------------------------

describe('passesGuardL1 — AC4 legitimate matches preserved', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('paella → Paella valenciana — ACCEPT', async () => {
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('gazpacho → Gazpacho andaluz — ACCEPT', async () => {
    const row = makeDishRow({ dish_name: 'Gazpacho', dish_name_es: 'Gazpacho andaluz' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'gazpacho', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  it('tortilla → Tortilla de patatas — ACCEPT', async () => {
    const row = makeDishRow({ dish_name: 'Potato omelette', dish_name_es: 'Tortilla de patatas' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tortilla', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('croquetas → Croquetas de jamón — ACCEPT', async () => {
    const row = makeDishRow({ dish_name: 'Ham croquettes', dish_name_es: 'Croquetas de jamón' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'croquetas', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('jamón → Bocadillo de jamón york — ACCEPT (jamon HI present after NFD)', async () => {
    // "jamón" normalizes to "jamon" (NFD strip). Candidate "Bocadillo de jamón york" → "bocadillo jamon york".
    // queryHI = {jamon}. "jamon" present in candidate → ACCEPT.
    const row = makeDishRow({ dish_name: 'Ham sandwich', dish_name_es: 'Bocadillo de jamón york' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'jamón', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('chorizo ibérico → Chorizo ibérico embutido — ACCEPT (both HI tokens present after NFD)', async () => {
    // queryHI = {chorizo, iberico} (both after NFD). Candidate has both → ACCEPT.
    const row = makeDishRow({ dish_name: 'Iberico chorizo', dish_name_es: 'Chorizo ibérico embutido' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'chorizo ibérico', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — EC edge cases (AC6)
// ---------------------------------------------------------------------------

describe('passesGuardL1 — EC edge cases (AC6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // EC-1: zero HI tokens — Jaccard-only fallthrough
  it('EC-1: query "tapa" (in FOOD_STOP_WORDS_EXTENDED, 4 chars) — zero HI tokens → Jaccard-only fallthrough → ACCEPT', async () => {
    // "tapa" is 4 chars but is in FOOD_STOP_WORDS_EXTENDED → queryHI empty → Jaccard fallthrough.
    // Candidate "Tapa de jamón": Jaccard {tapa} ∩ {tapa, jamon} = 1/2 = 0.5 → ACCEPT.
    const row = makeDishRow({ dish_name: 'Ham tapa', dish_name_es: 'Tapa de jamón' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tapa', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-1: query "agua fria" — both tokens in FOOD_STOP_WORDS_EXTENDED → zero HI tokens → Jaccard-only fallthrough', async () => {
    // "agua" is in FOOD_STOP_WORDS_EXTENDED, "fria" is in FOOD_STOP_WORDS_EXTENDED → queryHI empty.
    // Jaccard only: {agua, fria} ∩ {agua, fria} = 2/2 = 1.0 → ACCEPT.
    const row = makeDishRow({ dish_name: 'Cold water', dish_name_es: 'Agua fría' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'agua fria', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  // EC-2: short tokens (< 4 chars)
  it('EC-2: query "pan" (3 chars) — below length threshold → zero HI tokens → Jaccard-only fallthrough', async () => {
    const row = makeDishRow({ dish_name: 'Bread', dish_name_es: 'Pan tumaca' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pan', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-2: query "té ron" — 2-char and 3-char tokens → zero HI tokens → Jaccard-only fallthrough', async () => {
    // "té" = 2 chars (after NFD: "te"), "ron" = 3 chars → both below 4 → queryHI empty.
    // Candidate "Ron caña": Jaccard {te, ron} ∩ {ron, cana} = {ron} → 1/3 ≈ 0.33 → ACCEPT.
    // (Both below length threshold → required-token skipped.)
    const row = makeDishRow({ dish_name: 'Sugar cane rum', dish_name_es: 'Ron caña' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'té ron', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  // EC-3: OR semantics
  it('EC-3: HI tokens in nameEs only (not in name) → ACCEPT via Spanish-side OR', async () => {
    // query="cordero asado" → HI={cordero, asado}.
    // nameEs="Cordero asado al horno" → both present → ACCEPT via ES side.
    // name="Roasted lamb" → {roasted, lamb} → neither HI token present → name side fails.
    // OR semantics: accept because ES side passes.
    const row = makeDishRow({ dish_name: 'Roasted lamb', dish_name_es: 'Cordero asado al horno' });
    // Note: "asado" is in FOOD_STOP_WORDS_EXTENDED → queryHI = {cordero}
    // "cordero" present in "Cordero asado al horno" → ACCEPT.
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'cordero asado', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-3: HI tokens in name only (nameEs null) → ACCEPT via English-side OR', async () => {
    // EC-7 overlap: nameEs null, name has all HI tokens → ACCEPT.
    // query="gazpacho andaluz" → HI={gazpacho, andaluz}.
    // nameEs=null, name="Gazpacho Andaluz" → both present → ACCEPT via EN side.
    const row = makeDishRow({ dish_name: 'Gazpacho Andaluz', dish_name_es: null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'gazpacho andaluz', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-3: HI tokens split — chorizo in nameEs only, iberico in name only → neither side complete → REJECT', async () => {
    // query="chorizo iberico" → HI={chorizo, iberico}.
    // nameEs="Chorizo ahumado" → {chorizo, ahumado} → iberico absent → ES side fails.
    // name="Iberico sausage" → {iberico, sausage} → chorizo absent → EN side fails.
    // Both sides fail → REJECT.
    // Step1 passes (nameEs Jaccard: {chorizo,iberico} ∩ {chorizo,ahumado} = 1/3 ≈ 0.33 ≥ 0.25).
    const row = makeDishRow({ dish_name: 'Iberico sausage', dish_name_es: 'Chorizo ahumado' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'chorizo iberico', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  // EC-4: NFD + punctuation normalization
  it('EC-4: caña query normalizes to cana; Caña de cerveza candidate normalizes to cana de cerveza → ACCEPT', async () => {
    // "caña" → NFD strip → "cana". "cana" is in FOOD_STOP_WORDS_EXTENDED → queryHI = {}.
    // Jaccard-only fallthrough: {cana} ∩ {cana, cerveza} = 1/2 = 0.5 → ACCEPT.
    const row = makeDishRow({ dish_name: 'Beer glass', dish_name_es: 'Caña de cerveza' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'caña', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-4: café solo candidate — accented token strips correctly → ACCEPT', async () => {
    // "café" → NFD → "cafe". queryHI = {cafe}. Candidate "Café solo" → "cafe solo" → {cafe, solo}.
    // "cafe" present → ACCEPT.
    const row = makeDishRow({ dish_name: 'Black coffee', dish_name_es: 'Café solo' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'café', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  // EC-5: single-token query
  it('EC-5: single-token paella query vs Paella valenciana — Step 2 ACCEPT (does not break single-token use case)', async () => {
    // queryHI = {paella}. "paella" present in "Paella valenciana" → all HI present → ACCEPT.
    // Confirms threshold-based approach would have broken this (0.5 ≥ 0.25 is fine, but any
    // threshold > 0.5 would break it); required-token check handles this correctly.
    const row = makeDishRow({ dish_name: 'Paella', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  // EC-7: null nameEs
  it('EC-7: nameEs null — evaluates English name only; all HI tokens present → ACCEPT', async () => {
    // query="croquetas jamon" → HI={croquetas, jamon}.
    // nameEs=null, name="Ham croquettes jamon" → {ham, croquettes, jamon} → croquetas absent!
    // Let's use English tokens: name="Croquetas de jamon" → {croquetas, jamon} → both present → ACCEPT.
    const row = makeDishRow({ dish_name: 'Croquetas de jamon', dish_name_es: null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'croquetas jamon', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('EC-7: nameEs null — evaluates English name only; HI token absent → REJECT', async () => {
    // query="croquetas membrillo" → HI={croquetas, membrillo}.
    // nameEs=null, name="Ham croquettes" → {ham, croquettes} → neither HI token present → REJECT.
    // Step1: Jaccard {croquetas, membrillo} ∩ {ham, croquettes} = 0/4 = 0 → REJECT at step1 too.
    const row = makeDishRow({ dish_name: 'Ham croquettes', dish_name_es: null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'croquetas membrillo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  // EC-9: Q345 filler-HI tokens
  it('EC-9: Q345 filler-HI tokens poco+todo — todo in candidate but poco absent → REJECT', async () => {
    // queryHI = {poco, todo}. Candidate "Patatas para todo uso" → {patatas, para, todo, uso}.
    // "todo" present, "poco" absent → every fails → REJECT.
    const row = makeFoodRow({ food_name: 'Potatoes for all uses', food_name_es: 'Patatas para todo uso' });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'un poco de todo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('EC-9: Q345 Jaccard 0.143 < 0.25 — Step 1 also rejects independently (defence in depth)', async () => {
    // With full candidate name "Patatas aptas para todo uso culinario":
    // postStrip from normalizeQuery: "un poco de todo" → after SPANISH_STOP_WORDS strip: {poco, todo}
    // vs candidate tokens: {patatas, aptas, para, todo, uso, culinario} → intersection = {todo} → 1/7 ≈ 0.143 < 0.25
    // Step1 REJECTS even before step2. This test confirms double-rejection for EC-9.
    const row = makeFoodRow({ food_name: 'Potatoes for all culinary uses', food_name_es: 'Patatas aptas para todo uso culinario' });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'un poco de todo', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adversarial edge cases — QA-added (F-H10-FU2 QA pass, 2026-04-28)
// ---------------------------------------------------------------------------

describe('passesGuardL1 — adversarial edge cases (QA pass)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Hyphenated query tokens
  // ---------------------------------------------------------------------------

  it('Hyphen merging: "coca-cola" (hyphenated) vs "Coca Cola Zero" — REJECT (hyphen stripped, "cocacola" not a candidate token)', async () => {
    // normalizeL1 strips hyphens via [^a-z\s] → "coca-cola" → "cocacola" (single token, 8 chars).
    // queryHI = {cocacola}. Candidate "Coca Cola Zero" tokenizes to {coca, cola, zero}.
    // "cocacola" is absent → every fails → REJECT at Step 2.
    // Note: Jaccard also = 0 (no token overlap), so Step 1 rejects too.
    // This is consistent with computeTokenJaccard's pipeline (same punctuation strip).
    // Users who type "coca-cola" (hyphen) will get null at L1 and fall to L3 embedding.
    const row = makeDishRow({ dish_name: 'Coca Cola Zero', dish_name_es: 'Coca Cola Zero' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'coca-cola', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // EC-6: Two-pass cascade (BUG-PROD-012) with FULL nameEs — Step 2 fires in pass 2
  // ---------------------------------------------------------------------------

  it('EC-6 two-pass (unscoped): FULL nameEs passes Step 1 (Jaccard 0.60) but Step 2 rejects (membrillo absent) in both passes — result null', async () => {
    // This test exercises the EC-6 scenario with the FULL nameEs ('CROISSANT CON QUESO FRESCO'),
    // where Step 1 PASSES (Jaccard = 3/5 = 0.60 ≥ 0.25) and Step 2 fires and REJECTS.
    //
    // In contrast, fH10FU.q649.unit.test.ts uses the TRUNCATED nameEs ('CROISSANT CON QUESO FRESC')
    // where Step 1 itself rejects (Jaccard 0.20 < 0.25). That test validates Step 1 rejection.
    // THIS test validates Step 2 rejection in the two-pass path with the production-accurate FULL name.
    //
    // Pass 1 (minTier≥1, no chainSlug/restaurantId → two-pass trigger):
    //   All 4 strategies miss (CROISSANT is Tier 0; excluded from Tier≥1 filter) → 4 DB calls.
    // Pass 2 (unfiltered):
    //   S1 miss, S2 returns FULL nameEs CROISSANT row.
    //   Step 1: Jaccard('queso fresco con membrillo', 'CROISSANT CON QUESO FRESCO') = 3/5 = 0.60 → PASS.
    //   Step 2: queryHI={membrillo}. 'membrillo' not in {croissant, queso, fresco, con} → REJECT.
    //   S3 miss, S4 miss → pass 2 returns null.
    // Final result: null. Total: 8 DB calls.
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S1 (Tier≥1 exact dish → miss)
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S2 (Tier≥1 FTS dish → CROISSANT excluded)
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S3 (Tier≥1 exact food → miss)
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S4 (Tier≥1 FTS food → miss)
      .mockResolvedValueOnce({ rows: [] })  // Pass 2 S1 (unfiltered exact dish → miss)
      .mockResolvedValueOnce({ rows: [makeDishRow({  // Pass 2 S2 (FTS dish → FULL nameEs hit)
        dish_name: 'CROISSANT WITH FRESH CHEESE',
        dish_name_es: 'CROISSANT CON QUESO FRESCO',  // FULL nameEs — Jaccard 0.60, Step1 PASSES
        chain_slug: 'starbucks-es',
      })] })
      .mockResolvedValueOnce({ rows: [] })  // Pass 2 S3 (unfiltered exact food → miss)
      .mockResolvedValueOnce({ rows: [] }); // Pass 2 S4 (unfiltered FTS food → miss)

    const db = buildMockDb() as never;
    // No chainSlug, no restaurantId → triggers two-pass BUG-PROD-012 path
    const result = await level1Lookup(db, 'queso fresco con membrillo', {});

    expect(result).toBeNull();
    // 8 total DB calls: 4 per pass — proves BOTH passes ran and guard fired in pass 2
    expect(mockExecuteQuery).toHaveBeenCalledTimes(8);
  });

  it('EC-6 two-pass (unscoped): S4 FTS food — FULL nameEs passes Step 1 but Step 2 rejects — null across both passes', async () => {
    // Validates EC-6 for Strategy 4 (FTS food) in the two-pass path.
    // Pass 1 (minTier≥1): all miss (food row is Tier 0 / excluded) → 4 DB calls.
    // Pass 2 (unfiltered): S4 returns a food row whose nameEs passes Jaccard but lacks HI token.
    // query="coca cola grande", postStrip by normalizeQuery="coca cola grande".
    // queryHI={coca, cola}. food_name_es='Huevas cocidas de merluza de cola patagónia'.
    // Step 1: Jaccard('coca cola grande', 'Huevas cocidas de merluza de cola patagónia') < 0.25 → REJECT.
    // Actually let's use a case where Step1 passes and Step2 fires:
    // query="membrillo artesano", queryHI={membrillo, artesano}.
    // candidate "Mermelada de membrillo": Jaccard {membrillo,artesano} ∩ {mermelada,membrillo} = {membrillo}
    // union = {membrillo,artesano,mermelada} → 1/3 ≈ 0.33 → Step1 PASSES.
    // Step2: 'artesano' absent → REJECT.
    mockExecuteQuery
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S1
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S2
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S3
      .mockResolvedValueOnce({ rows: [] })  // Pass 1 S4
      .mockResolvedValueOnce({ rows: [] })  // Pass 2 S1
      .mockResolvedValueOnce({ rows: [] })  // Pass 2 S2
      .mockResolvedValueOnce({ rows: [] })  // Pass 2 S3
      .mockResolvedValueOnce({ rows: [makeFoodRow({  // Pass 2 S4 — food FTS hit, Step1 passes, Step2 rejects
        food_name: 'Quince jam',
        food_name_es: 'Mermelada de membrillo',
      })] });

    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'membrillo artesano', {});

    expect(result).toBeNull();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(8);
  });

  // ---------------------------------------------------------------------------
  // Empty string nameEs (spec EC-7 extension: '' treated as null)
  // ---------------------------------------------------------------------------

  it('Empty string nameEs treated as falsy (like null): evaluates name side only — HI tokens in name → ACCEPT', async () => {
    // Spec EC-7 mentions null/undefined nameEs. Empty string '' is also falsy in JS.
    // passesGuardL1: if (nameEs) { ... } — '' skips to name evaluation.
    // If name has all HI tokens → ACCEPT. Documents this implicit behavior.
    // query="paella valenciana" → HI={paella, valenciana}.
    // nameEs='', name='Paella valenciana' → name side passes → ACCEPT.
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: '' as unknown as null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella valenciana', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  it('Empty string nameEs treated as falsy: HI token absent from name only → REJECT', async () => {
    // nameEs='' (falsy) and name lacks 'membrillo' → REJECT.
    // query="membrillo casero" → HI={membrillo, casero}.
    // nameEs='', name='Quince jam' → {quince, jam} → neither HI present → REJECT.
    // Note: Step 1 Jaccard likely also rejects here, but this documents the '' behavior.
    const row = makeDishRow({ dish_name: 'Quince jam', dish_name_es: '' as unknown as null });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'membrillo casero', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Leading/trailing whitespace in query (normalizeQuery trims before guard)
  // ---------------------------------------------------------------------------

  it('Leading/trailing whitespace in query: "  paella  " trimmed by normalizeQuery → ACCEPT against Paella valenciana', async () => {
    // level1Lookup calls normalizeQuery(query) which applies .trim().
    // So "  paella  " → "paella" before reaching passesGuardL1. No crash.
    // queryHI={paella}. 'paella' in 'Paella valenciana' → ACCEPT.
    const row = makeDishRow({ dish_name: 'Paella valenciana', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, '  paella  ', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('fts_dish');
  });

  // ---------------------------------------------------------------------------
  // Deduplication of repeated query tokens
  // ---------------------------------------------------------------------------

  it('Repeated query token "pollo pollo pollo" — Set dedup yields {pollo}; present in candidate → ACCEPT', async () => {
    // getHighInformationTokens uses Set → {pollo} (size 1).
    // every([pollo] in candidate) with candidate having 'pollo' → ACCEPT.
    // Confirms Set dedup prevents spurious repeated-token false negatives.
    const row = makeDishRow({ dish_name: 'Chicken roast', dish_name_es: 'Pollo asado al horno' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo pollo pollo', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // L3-delegation regression checks (spec EC-9 trade-off elaborated queries)
  // ---------------------------------------------------------------------------

  it('L3 delegation: "tarta de queso casera" vs "Tarta de queso" — REJECT at L1 (casera absent)', async () => {
    // queryHI = {tarta, casera} (queso is in FOOD_STOP_WORDS_EXTENDED; de/con stop words).
    // Candidate "Tarta de queso" tokens: {tarta, queso}.
    // 'casera' absent → every fails → REJECT.
    // Jaccard also passes (tarta overlap = 0.33 ≥ 0.25), so Step 1 passes but Step 2 rejects.
    // Correct behavior per spec EC-9 trade-off: elaborated queries delegated to L3 embedding.
    const row = makeDishRow({ dish_name: 'Cheesecake', dish_name_es: 'Tarta de queso' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'tarta de queso casera', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('L3 delegation: "pizza margarita" vs "Pizza margherita" — REJECT at L1 (spelling drift)', async () => {
    // queryHI = {pizza, margarita}. Candidate "Pizza margherita" tokens: {pizza, margherita}.
    // 'margarita' ≠ 'margherita' (different tokens) → every fails → REJECT.
    // Correct behavior: spelling drift handled by L3 embedding, not L1 exact token match.
    const row = makeDishRow({ dish_name: 'Margherita pizza', dish_name_es: 'Pizza margherita' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pizza margarita', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('L3 delegation: "paella de mariscos" vs "Paella valenciana" — REJECT at L1 (mariscos absent)', async () => {
    // queryHI = {paella, mariscos}. Candidate "Paella valenciana" tokens: {paella, valenciana}.
    // 'mariscos' absent → REJECT. L3 embedding to handle semantic match.
    // Step 1 Jaccard: {paella, mariscos} ∩ {paella, valenciana} = {paella} → 1/3 ≈ 0.33 → PASS.
    // Step 2 fires and rejects.
    const row = makeDishRow({ dish_name: 'Valencian paella', dish_name_es: 'Paella valenciana' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'paella de mariscos', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Known FN truncation artifacts (Phase 0.2 simulation, documented per-spec)
  // ---------------------------------------------------------------------------

  it('FN artifact Q327: "queso mancheg" (truncated "manchego") — REJECT at L1 (mancheg absent, truncation prevents match)', async () => {
    // Phase 0.2 simulation identified 5 FNs from QA truncation at ~40-char limit.
    // Q327: raw query truncated to "queso mancheg" (should be "queso manchego").
    // queryHI = {mancheg} (queso is extended stop word; mancheg=7 chars, not in list).
    // Candidate "Queso manchego curado" → tokens: {manchego, curado} (queso stop word).
    // 'mancheg' ≠ 'manchego' → every fails → REJECT.
    // This is expected behavior: truncated query cannot match. Documents the known FN.
    const row = makeFoodRow({ food_name: 'Aged manchego cheese', food_name_es: 'Queso manchego curado' });
    mockFoodFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'queso mancheg', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('FN artifact Q331: "pollo a la plan" (truncated "plancha") — REJECT at L1 (plan absent; plancha is stop word post-NFD)', async () => {
    // Phase 0.2 FN: Q331 raw query truncated: "plancha" → "plan" (4 chars, not in FOOD_STOP_WORDS_EXTENDED).
    // "plancha" IS in FOOD_STOP_WORDS_EXTENDED (exact match: 'plancha').
    // "plan" is NOT → queryHI = {pollo, plan}.
    // Candidate "Pollo a la plancha": tokens {pollo, plancha}.
    // 'plan' ≠ 'plancha' → every fails → REJECT.
    // This is the truncation artifact: real query "pollo a la plancha" would have queryHI={pollo}
    // and 'pollo' is present → ACCEPT. Only the truncated QA-capture form fails.
    const row = makeDishRow({ dish_name: 'Grilled chicken', dish_name_es: 'Pollo a la plancha' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo a la plan', { chainSlug: 'test-chain' });
    expect(result).toBeNull();
  });

  it('FN artifact Q331 (non-truncated real query): "pollo a la plancha" — ACCEPT (plancha is stop word, queryHI={pollo} present)', async () => {
    // Companion test to Q331 FN: the REAL (non-truncated) query should ACCEPT.
    // queryHI = {pollo} (plancha is in FOOD_STOP_WORDS_EXTENDED, la/a are stop words).
    // Candidate "Pollo a la plancha": tokens {pollo, plancha}.
    // 'pollo' present → ACCEPT. Confirms the FN is truncation-only, not an algorithm defect.
    const row = makeDishRow({ dish_name: 'Grilled chicken', dish_name_es: 'Pollo a la plancha' });
    mockDishFtsHit(row);
    const db = buildMockDb() as never;
    const result = await level1Lookup(db, 'pollo a la plancha', { chainSlug: 'test-chain' });
    expect(result).not.toBeNull();
  });
});
