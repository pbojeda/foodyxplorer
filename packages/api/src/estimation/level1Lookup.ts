// Level 1 Official Data Lookup — estimation engine first tier.
//
// Executes a 4-strategy cascade against dishes and foods tables:
//   1. Exact dish match (case-insensitive, optional chain/restaurant scope)
//   2. FTS dish match (Spanish primary, English fallback, same scope)
//   3. Exact food match (no chain scope — foods are chain-agnostic)
//   4. FTS food match (no chain scope)
//
// Each strategy uses a CTE to de-duplicate nutrient rows (most recent wins).
// Returns the first successful result as Level1Result, or null if all miss.
//
// F068: Results ordered by data_sources.priority_tier ASC NULLS LAST (ADR-015).
// When hasExplicitBrand=true, first attempt filters to Tier 0 only; falls through
// to unfiltered cascade if no Tier 0 match found.
//
// BUG-PROD-012: Inverse cascade for non-branded queries.
// When hasExplicitBrand=false AND no chainSlug/restaurantId scope is set,
// first attempt filters to Tier≥1 only (exclude scraped chain PDFs); falls through
// to unfiltered cascade if no Tier≥1 match found. This ensures generic Spanish
// queries (e.g. "tortilla", "jamón") prefer cocina-española/BEDCA over chain PDFs.
// When chainSlug or restaurantId is set, skip the Tier≥1 pre-cascade so the scope
// clause continues to constrain results (AC6 guard).
//
// See: ADR-001 (confidence strategy), ADR-000 (Kysely for complex queries),
//      ADR-015 (provenance graph, priority tier)

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { Level1LookupOptions, Level1Result, DishQueryRow, FoodQueryRow } from './types.js';
import { mapDishRowToResult, mapFoodRowToResult, OFF_SOURCE_UUID } from './types.js';
import { resolveAliases, SUPERMARKET_BRAND_ALIASES } from './brandDetector.js';
import { applyLexicalGuard } from './level3Lookup.js';

// ---------------------------------------------------------------------------
// Guard helper — dual-name OR semantics (ADR-024 addendum, F-H10-FU)
// ---------------------------------------------------------------------------

/**
 * Returns true if the query clears the lexical guard threshold against
 * EITHER the Spanish name (nameEs) OR the English name.
 *
 * L1 FTS is bilingual: a match may occur on the Spanish branch (name_es)
 * or the English branch (name). Since the matched branch is not exposed in
 * the result row, we must evaluate both sides and accept if either passes.
 *
 * nameEs may be null/undefined (Dish.nameEs is optional in Prisma schema).
 * name is always non-null (DB constraint + SQL projection).
 */
function passesGuardEither(
  query: string,
  nameEs: string | null | undefined,
  name: string,
): boolean {
  if (nameEs && applyLexicalGuard(query, nameEs)) return true;
  return applyLexicalGuard(query, name);
}

// ---------------------------------------------------------------------------
// Required-token guard — layered check (ADR-024 addendum 2, F-H10-FU2)
// ---------------------------------------------------------------------------

/**
 * Extended stop-word set for the required-token check.
 *
 * Superset of SPANISH_STOP_WORDS (linguistic) PLUS food-domain modifier tokens
 * that appear across many dish types and do NOT distinguish dish identity.
 *
 * Criteria for inclusion:
 *  - Token is semantically common across many dish types (not a distinguishing ingredient)
 *  - Its presence alone does not justify a match
 *  - Removing it from HI computation does not cause false negatives on known QA battery
 *
 * DO NOT add: pollo, jamon, vino, paella, tortilla, etc. (primary dish identifiers).
 * Validated against 136 FTS-hit rows from /tmp/jaccard-table.md simulation (2026-04-28).
 */
const FOOD_STOP_WORDS_EXTENDED: Set<string> = new Set([
  // SPANISH_STOP_WORDS (linguistic — 14 tokens)
  'de', 'del', 'con', 'la', 'el', 'los', 'las', 'un', 'una', 'al', 'y', 'a', 'en', 'por',
  // Food-domain modifiers — spec starter list (12 tokens)
  'queso', 'fresco', 'leche', 'agua', 'plato', 'racion', 'tapa', 'pintxo', 'media',
  'caliente', 'frio', 'natural',
  // Quantity / size modifiers — do NOT distinguish dish type
  'grande', 'normal', 'generosa', 'generoso', 'cuarto', 'triple', 'doble',
  'algunos', 'algunas', 'tres', 'cuatro', 'cinco',
  // Serving containers — extends existing tapa/pintxo/media/racion set
  'copas', 'copa', 'pinchos', 'pincho', 'rebanadas', 'rebanada',
  'vaso', 'vasito', 'botella', 'botellin',
  // Preparation method modifiers — cooking method, not dish identity
  'brasa', 'frito', 'frita', 'fritos', 'fritas', 'plancha', 'asado', 'asada',
  // Conversational filler
  'favor', 'para',
  // Food packaging / container descriptors
  // NOTE: `sopa` was removed from this set after code-review-specialist MEDIUM-1
  // flagged it as a primary dish identifier (Sopa de ajo, Sopa de marisco, etc.).
  // Q627 (`un sobre de sopa instantánea de pollo`) still passes because the
  // candidate `Sopa instantánea pollo` ALSO contains `sopa` → step 2 accepts.
  'sobre', 'instantanea', 'instantaneo', 'lata',
  // Serving format / unit
  'canas', 'cana', // cañas/caña = beer glass (NFD: caña→cana)
  // Contextual modifiers (product type, not dish identity)
  'molde', 'crema',
  // Truncation artifact (QA capture ~40-char limit): "verduras" truncated to "verdu"
  'verdu',
]);

/**
 * Full normalization pipeline — identical to `computeTokenJaccard`'s `tokenize` in
 * `level3Lookup.ts:68-70`. Replicated locally to avoid importing private symbols.
 *
 * Pipeline: lowercase → NFD diacritic-strip → punctuation-strip → result string.
 * Callers split on /\s+/ after this call.
 *
 * Example: 'Caña de cerveza' → 'cana de cerveza', 'ibérico' → 'iberico'
 */
function normalizeL1(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // NFD diacritic-strip (U+0300–U+036F combining marks)
    .replace(/[^a-z\s]/g, '');       // punctuation strip — hyphens, commas, parens, etc.
}

/** Minimum token length to qualify as high-information (ADR-024 addendum 2 Decision 6).
 *  Below this threshold, 3-char Spanish food words (pan, ron, té) appear in many
 *  candidate names and would cause systematic false negatives if treated as HI tokens. */
const HI_TOKEN_MIN_LENGTH = 4;

/**
 * Extract high-information tokens from a query string.
 *
 * A token is "high-information" if:
 *  1. Its normalized form has length >= HI_TOKEN_MIN_LENGTH (4).
 *  2. It is NOT in FOOD_STOP_WORDS_EXTENDED.
 *
 * Returns an empty Set if no HI tokens exist (caller falls through to Jaccard-only).
 */
function getHighInformationTokens(s: string): Set<string> {
  const tokens = normalizeL1(s)
    .split(/\s+/)
    .filter((t) => t.length >= HI_TOKEN_MIN_LENGTH && !FOOD_STOP_WORDS_EXTENDED.has(t));
  return new Set(tokens);
}

/**
 * Combined L1 lexical guard — replaces direct `passesGuardEither` calls at FTS
 * injection points (Strategy 2 and Strategy 4) in runCascade().
 *
 * Step 1 — Jaccard gate (F-H10-FU): call passesGuardEither. If false → REJECT.
 * Step 2 — Required-token check (F-H10-FU2): if queryHI is non-empty, EVERY HI
 * token must be present in normalizeL1(nameEs) tokens OR normalizeL1(name) tokens.
 * If queryHI is empty → fall through (Jaccard-only behavior preserved, EC-1).
 *
 * OR semantics (EC-3): accept if ALL HI tokens are in nameEs tokens OR ALL HI
 * tokens are in name tokens. Mixed split (some in nameEs, some in name) → REJECT.
 * Matches passesGuardEither's bilingual contract.
 *
 * NOT exported — tested indirectly via cascade tests per ADR-024 addendum 1 decision 4.
 */
function passesGuardL1(
  query: string,
  nameEs: string | null | undefined,
  name: string,
): boolean {
  // Step 1: Jaccard gate (existing F-H10-FU check)
  if (!passesGuardEither(query, nameEs, name)) return false;

  // Step 2: Required-token check
  const queryHI = getHighInformationTokens(query);
  if (queryHI.size === 0) return true; // EC-1: fall through to Jaccard-only behavior

  const tokenize = (s: string): Set<string> =>
    new Set(normalizeL1(s).split(/\s+/).filter((t) => t.length > 0));

  // OR semantics: accept if EVERY HI token is in nameEs tokens OR in name tokens
  if (nameEs) {
    const nameEsTokens = tokenize(nameEs);
    if (Array.from(queryHI).every((t) => nameEsTokens.has(t))) return true;
  }

  const nameTokens = tokenize(name);
  return Array.from(queryHI).every((t) => nameTokens.has(t));
}

// ---------------------------------------------------------------------------
// Query normalization
// ---------------------------------------------------------------------------

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Strategy 1 — Exact dish match
// ---------------------------------------------------------------------------

async function exactDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
  minTier?: number,
): Promise<DishQueryRow | undefined> {
  const { restaurantId, chainSlug } = options;

  const scopeClause = restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;

  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : minTier !== undefined
      ? sql`AND ds.priority_tier >= ${minTier}`
      : sql``;

  const result = await sql<DishQueryRow>`
    WITH ranked_dn AS (
      SELECT dn.*,
             ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT
      d.id          AS dish_id,
      d.name        AS dish_name,
      d.name_es     AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      rdn.calories::text,
      rdn.proteins::text,
      rdn.carbohydrates::text,
      rdn.sugars::text,
      rdn.fats::text,
      rdn.saturated_fats::text,
      rdn.fiber::text,
      rdn.salt::text,
      rdn.sodium::text,
      rdn.trans_fats::text,
      rdn.cholesterol::text,
      rdn.potassium::text,
      rdn.monounsaturated_fats::text,
      rdn.polyunsaturated_fats::text,
      rdn.alcohol::text,
      rdn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    JOIN data_sources ds ON ds.id = rdn.source_id
    WHERE (
      LOWER(d.name) = LOWER(${normalizedQuery})
      OR LOWER(d.name_es) = LOWER(${normalizedQuery})
      OR d.aliases @> ARRAY[${normalizedQuery}]  -- F078: GIN-indexed, aliases stored lowercase
    )
    ${scopeClause}
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 2 — FTS dish match
// ---------------------------------------------------------------------------

async function ftsDishMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
  minTier?: number,
): Promise<DishQueryRow | undefined> {
  const { restaurantId, chainSlug } = options;

  const scopeClause = restaurantId !== undefined
    ? sql`AND r.id = ${restaurantId}::uuid`
    : chainSlug !== undefined
      ? sql`AND r.chain_slug = ${chainSlug}`
      : sql``;

  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : minTier !== undefined
      ? sql`AND ds.priority_tier >= ${minTier}`
      : sql``;

  const result = await sql<DishQueryRow>`
    WITH ranked_dn AS (
      SELECT dn.*,
             ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT
      d.id          AS dish_id,
      d.name        AS dish_name,
      d.name_es     AS dish_name_es,
      d.restaurant_id,
      r.chain_slug,
      d.portion_grams::text AS portion_grams,
      rdn.calories::text,
      rdn.proteins::text,
      rdn.carbohydrates::text,
      rdn.sugars::text,
      rdn.fats::text,
      rdn.saturated_fats::text,
      rdn.fiber::text,
      rdn.salt::text,
      rdn.sodium::text,
      rdn.trans_fats::text,
      rdn.cholesterol::text,
      rdn.potassium::text,
      rdn.monounsaturated_fats::text,
      rdn.polyunsaturated_fats::text,
      rdn.alcohol::text,
      rdn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    JOIN data_sources ds ON ds.id = rdn.source_id
    WHERE (
      to_tsvector('spanish', COALESCE(d.name_es, d.name)) @@ plainto_tsquery('spanish', ${normalizedQuery})
      OR to_tsvector('english', d.name) @@ plainto_tsquery('english', ${normalizedQuery})
    )
    ${scopeClause}
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(d.name_es, d.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 3 — Exact food match (no chain scope)
// ---------------------------------------------------------------------------

async function exactFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  tierFilter?: number,
  minTier?: number,
): Promise<FoodQueryRow | undefined> {
  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : minTier !== undefined
      ? sql`AND ds.priority_tier >= ${minTier}`
      : sql``;

  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      f.barcode::text AS barcode,
      f.brand_name  AS brand_name,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.alcohol::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE (LOWER(f.name_es) = LOWER(${normalizedQuery})
       OR LOWER(f.name) = LOWER(${normalizedQuery})
       OR f.aliases @> ARRAY[${normalizedQuery}])
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Strategy 4 — FTS food match (no chain scope)
// ---------------------------------------------------------------------------

async function ftsFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  tierFilter?: number,
  minTier?: number,
): Promise<FoodQueryRow | undefined> {
  const tierClause = tierFilter !== undefined
    ? sql`AND ds.priority_tier = ${tierFilter}`
    : minTier !== undefined
      ? sql`AND ds.priority_tier >= ${minTier}`
      : sql``;

  const result = await sql<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      f.barcode::text AS barcode,
      f.brand_name  AS brand_name,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.alcohol::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE (to_tsvector('spanish', f.name_es) @@ plainto_tsquery('spanish', ${normalizedQuery})
       OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${normalizedQuery}))
    ${tierClause}
    ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(f.name_es, f.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// F080: OFF branded lookup (Strategy 0 — runs before normal L1 cascade)
// ---------------------------------------------------------------------------

/**
 * Query OFF foods for a branded query.
 * Filters to source_id = OFF_SOURCE_UUID AND food_type = 'branded'.
 * Applies brand alias expansion (mercadona → hacendado + mercadona).
 *
 * @param db - Kysely DB instance
 * @param normalizedQuery - Normalized query string
 * @param detectedBrand - Brand name from detectExplicitBrand()
 * @param sqlImpl - Injectable sql tagged template (default: kysely sql; override in tests)
 */
export async function offBrandedFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  detectedBrand: string,
  sqlImpl: typeof sql = sql,
): Promise<FoodQueryRow | undefined> {
  const brandAliases = resolveAliases(detectedBrand);

  // Build OR conditions for each brand alias (avoids sql.raw — safe parameterized)
  const brandClauses = brandAliases.map((b) => sqlImpl`f.brand_name = ${b}`);
  const brandCondition = brandClauses.reduce(
    (acc, clause) => sqlImpl`${acc} OR ${clause}`,
  );

  // Strip brand terms from query for FTS matching — brand is matched via brand_name column
  const brandTermsSet = new Set(brandAliases);
  const searchTerms = normalizedQuery
    .split(/\s+/)
    .filter((t) => !brandTermsSet.has(t))
    .join(' ')
    .trim() || normalizedQuery; // fallback to full query if nothing left

  const result = await sqlImpl<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.source_id = ${OFF_SOURCE_UUID}::uuid
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      f.barcode::text AS barcode,
      f.brand_name  AS brand_name,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.alcohol::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE f.source_id = ${OFF_SOURCE_UUID}::uuid
      AND f.food_type = 'branded'
      AND (${brandCondition})
      AND (
        to_tsvector('spanish', COALESCE(f.name_es, f.name)) @@ plainto_tsquery('spanish', ${searchTerms})
        OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${searchTerms})
        OR LOWER(f.name_es) = LOWER(${searchTerms})
        OR LOWER(f.name) = LOWER(${searchTerms})
      )
    ORDER BY ds.priority_tier ASC NULLS LAST, length(COALESCE(f.name_es, f.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

/**
 * Query OFF foods as a last-resort fallback (Tier 3 generic fallback).
 * Called by engineRouter after all other levels miss.
 * No brand filter — searches all OFF foods by name.
 *
 * @param db - Kysely DB instance
 * @param normalizedQuery - Normalized query string
 * @param sqlImpl - Injectable sql tagged template (default: kysely sql; override in tests)
 */
export async function offFallbackFoodMatch(
  db: Kysely<DB>,
  normalizedQuery: string,
  sqlImpl: typeof sql = sql,
): Promise<FoodQueryRow | undefined> {
  const result = await sqlImpl<FoodQueryRow>`
    WITH ranked_fn AS (
      SELECT fn.*,
             ROW_NUMBER() OVER (PARTITION BY fn.food_id ORDER BY fn.created_at DESC) AS rn
      FROM food_nutrients fn
      WHERE fn.source_id = ${OFF_SOURCE_UUID}::uuid
    )
    SELECT
      f.id          AS food_id,
      f.name        AS food_name,
      f.name_es     AS food_name_es,
      f.food_group  AS food_group,
      f.barcode::text AS barcode,
      f.brand_name  AS brand_name,
      rfn.calories::text,
      rfn.proteins::text,
      rfn.carbohydrates::text,
      rfn.sugars::text,
      rfn.fats::text,
      rfn.saturated_fats::text,
      rfn.fiber::text,
      rfn.salt::text,
      rfn.sodium::text,
      rfn.trans_fats::text,
      rfn.cholesterol::text,
      rfn.potassium::text,
      rfn.monounsaturated_fats::text,
      rfn.polyunsaturated_fats::text,
      rfn.alcohol::text,
      rfn.reference_basis::text,
      ds.id         AS source_id,
      ds.name       AS source_name,
      ds.type::text AS source_type,
      ds.url        AS source_url,
      ds.priority_tier::text AS source_priority_tier
    FROM foods f
    JOIN ranked_fn rfn ON rfn.food_id = f.id AND rfn.rn = 1
    JOIN data_sources ds ON ds.id = rfn.source_id
    WHERE f.source_id = ${OFF_SOURCE_UUID}::uuid
      AND (
        to_tsvector('spanish', COALESCE(f.name_es, f.name)) @@ plainto_tsquery('spanish', ${normalizedQuery})
        OR to_tsvector('english', f.name) @@ plainto_tsquery('english', ${normalizedQuery})
        OR LOWER(f.name_es) = LOWER(${normalizedQuery})
        OR LOWER(f.name) = LOWER(${normalizedQuery})
      )
    ORDER BY length(COALESCE(f.name_es, f.name)) ASC
    LIMIT 1
  `.execute(db);

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Internal cascade runner
// ---------------------------------------------------------------------------

/**
 * Run the 4-strategy cascade with optional tier filtering.
 *
 * @param tierFilter - Equality predicate: `AND ds.priority_tier = tierFilter`
 * @param minTier    - Lower-bound predicate: `AND ds.priority_tier >= minTier`
 *
 * `tierFilter` and `minTier` are mutually exclusive; passing both throws.
 */
async function runCascade(
  db: Kysely<DB>,
  normalizedQuery: string,
  options: Level1LookupOptions,
  tierFilter?: number,
  minTier?: number,
): Promise<Level1Result | null> {
  if (tierFilter !== undefined && minTier !== undefined) {
    throw new Error('runCascade: tierFilter and minTier are mutually exclusive');
  }

  // Strategy 1: exact dish
  const exactDishRow = await exactDishMatch(db, normalizedQuery, options, tierFilter, minTier);
  if (exactDishRow !== undefined) {
    return { matchType: 'exact_dish', result: mapDishRowToResult(exactDishRow), rawFoodGroup: null };
  }

  // Strategy 2: FTS dish
  const ftsDishRow = await ftsDishMatch(db, normalizedQuery, options, tierFilter, minTier);
  if (ftsDishRow !== undefined) {
    if (passesGuardL1(normalizedQuery, ftsDishRow.dish_name_es, ftsDishRow.dish_name)) {
      return { matchType: 'fts_dish', result: mapDishRowToResult(ftsDishRow), rawFoodGroup: null };
    }
    // Guard rejected — fall through to Strategy 3
  }

  // Strategy 3: exact food (no chain scope)
  const exactFoodRow = await exactFoodMatch(db, normalizedQuery, tierFilter, minTier);
  if (exactFoodRow !== undefined) {
    return { matchType: 'exact_food', result: mapFoodRowToResult(exactFoodRow), rawFoodGroup: exactFoodRow.food_group };
  }

  // Strategy 4: FTS food (no chain scope)
  const ftsFoodRow = await ftsFoodMatch(db, normalizedQuery, tierFilter, minTier);
  if (ftsFoodRow !== undefined) {
    if (passesGuardL1(normalizedQuery, ftsFoodRow.food_name_es, ftsFoodRow.food_name)) {
      return { matchType: 'fts_food', result: mapFoodRowToResult(ftsFoodRow), rawFoodGroup: ftsFoodRow.food_group };
    }
    // Guard rejected — fall through to null (runCascade returns null)
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the Level 1 official data lookup cascade.
 *
 * Tries 4 strategies in order; returns the first match or null if all miss.
 * Results are ordered by priority_tier ASC NULLS LAST (ADR-015, F068).
 *
 * When hasExplicitBrand=true (F068): first pass filters to Tier 0 only.
 * If no Tier 0 match → falls through to normal (unfiltered) cascade.
 *
 * When hasExplicitBrand=false AND no chainSlug/restaurantId scope is set
 * (BUG-PROD-012): first pass filters to Tier≥1 only (excludes scraped chain PDFs),
 * so official Spanish data (cocina-española / BEDCA) wins over chain FTS matches.
 * If no Tier≥1 match → falls through to normal (unfiltered) cascade so chain-only
 * terms (e.g. "frappuccino") are still found via Tier 0 rather than returning null.
 * When chainSlug or restaurantId is set, skip the Tier≥1 pre-cascade so the scope
 * clause continues to constrain results to the selected restaurant.
 *
 * Throws with code='DB_UNAVAILABLE' on database errors.
 *
 * @param db     - Kysely DB instance
 * @param query  - Raw query string (will be normalized internally)
 * @param options - Optional chain/restaurant scoping + brand flag
 */
export async function level1Lookup(
  db: Kysely<DB>,
  query: string,
  options: Level1LookupOptions,
): Promise<Level1Result | null> {
  const normalizedQuery = normalizeQuery(query);

  try {
    // F080: Supermarket branded query → try OFF branded lookup first (Tier 0 priority)
    if (options.hasExplicitBrand === true && options.detectedBrand !== undefined) {
      const isKnownSupermarket = options.detectedBrand in SUPERMARKET_BRAND_ALIASES ||
        // hacendado is also a valid supermarket brand (direct, not via alias)
        options.detectedBrand === 'hacendado';

      if (isKnownSupermarket) {
        const offRow = await offBrandedFoodMatch(db, normalizedQuery, options.detectedBrand);
        if (offRow !== undefined) {
          return {
            matchType: 'fts_food',
            result: mapFoodRowToResult(offRow),
            rawFoodGroup: offRow.food_group,
          };
        }
      }
    }

    // F068: Branded query → try Tier 0 first (existing behavior)
    if (options.hasExplicitBrand === true) {
      const tier0Result = await runCascade(db, normalizedQuery, options, /* tierFilter= */ 0);
      if (tier0Result !== null) {
        return tier0Result;
      }
      // Fall through to unfiltered cascade
    }

    // BUG-PROD-012: Non-branded, unscoped query → try Tier≥1 first to prefer
    // official Spanish data (cocina-española / BEDCA) over scraped chain PDFs.
    // Skip when chainSlug/restaurantId is set so the scope clause wins (AC6 guard).
    if (
      options.hasExplicitBrand !== true &&
      options.chainSlug === undefined &&
      options.restaurantId === undefined
    ) {
      const tier1PlusResult = await runCascade(db, normalizedQuery, options, /* tierFilter= */ undefined, /* minTier= */ 1);
      if (tier1PlusResult !== null) {
        return tier1PlusResult;
      }
      // Fall through to unfiltered cascade (AC5: chain-only terms like "frappuccino")
    }

    // Normal cascade (ordered by priority_tier)
    return await runCascade(db, normalizedQuery, options);
  } catch (err) {
    throw Object.assign(
      new Error('Database query failed'),
      { code: 'DB_UNAVAILABLE', cause: err },
    );
  }
}
