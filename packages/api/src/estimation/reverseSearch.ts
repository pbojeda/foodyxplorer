// F086 — Reverse Search query module.
//
// Given a calorie budget (and optional protein minimum), returns chain dishes
// that fit the constraints, sorted by protein density descending.

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { ReverseSearchData, ReverseSearchResult } from '@foodxplorer/shared';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Row shape returned by the SQL query
// ---------------------------------------------------------------------------

interface ReverseSearchRow {
  dish_name: string;
  dish_name_es: string | null;
  calories: string | null;
  proteins: string | null;
  fats: string | null;
  carbohydrates: string | null;
  portion_grams: string | null;
  chain_name: string;
  total_matches: string;
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export interface ReverseSearchParams {
  chainSlug: string;
  maxCalories: number;
  minProtein?: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(val: string | null): number {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

function calcProteinDensity(proteins: number, calories: number): number {
  if (calories === 0) return 0;
  return Math.round((proteins / calories) * 100 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

export async function reverseSearchDishes(
  db: Kysely<DB>,
  params: ReverseSearchParams,
): Promise<ReverseSearchData> {
  const { chainSlug, maxCalories, limit } = params;
  const minProtein = params.minProtein ?? null;

  const proteinClause = minProtein !== null
    ? sql`AND COALESCE(rdn.proteins, 0)::numeric >= ${minProtein}`
    : sql``;

  const result = await sql<ReverseSearchRow>`
    WITH ranked_dn AS (
      SELECT dn.*,
             ROW_NUMBER() OVER (PARTITION BY dn.dish_id ORDER BY dn.created_at DESC) AS rn
      FROM dish_nutrients dn
    )
    SELECT
      d.name            AS dish_name,
      d.name_es         AS dish_name_es,
      rdn.calories::text,
      rdn.proteins::text,
      rdn.fats::text,
      rdn.carbohydrates::text,
      d.portion_grams::text AS portion_grams,
      r.name            AS chain_name,
      COUNT(*) OVER ()  AS total_matches
    FROM dishes d
    JOIN restaurants r ON r.id = d.restaurant_id
    JOIN ranked_dn rdn ON rdn.dish_id = d.id AND rdn.rn = 1
    WHERE r.chain_slug = ${chainSlug}
      AND rdn.reference_basis = 'per_serving'
      AND d.availability = 'available'
      AND COALESCE(rdn.calories, 0)::numeric <= ${maxCalories}
      ${proteinClause}
    ORDER BY
      CASE WHEN COALESCE(rdn.calories, 0)::numeric = 0 THEN 0
           ELSE COALESCE(rdn.proteins, 0)::numeric / COALESCE(rdn.calories, 0)::numeric
      END DESC,
      COALESCE(rdn.calories, 0)::numeric ASC
    LIMIT ${limit}
  `.execute(db);

  const rows = result.rows as ReverseSearchRow[];

  const chainName = rows.length > 0 ? rows[0]!.chain_name : chainSlug;
  const totalMatches = rows.length > 0 ? Number(rows[0]!.total_matches) : 0;

  const results: ReverseSearchResult[] = rows.map((row) => {
    const calories = toNum(row.calories);
    const proteins = toNum(row.proteins);
    return {
      name: row.dish_name,
      nameEs: row.dish_name_es,
      calories,
      proteins,
      fats: toNum(row.fats),
      carbohydrates: toNum(row.carbohydrates),
      portionGrams: row.portion_grams !== null && toNum(row.portion_grams) > 0
        ? toNum(row.portion_grams)
        : null,
      proteinDensity: calcProteinDensity(proteins, calories),
    };
  });

  return {
    chainSlug,
    chainName,
    maxCalories,
    minProtein,
    results,
    totalMatches,
  };
}
