/**
 * F-CATALOG-COV-001 Round-3 — AC-12a: Seed-layer fidelity gate (locked-denominator).
 *
 * N_LOCKED = 7 raw-query fixtures derived from the Step 2 pre-analysis table
 * (SECONDARY source — `docs/research/qa-improvement-sprint-report-2026-04-21.md`).
 * PRIMARY telemetry was unavailable at planning time (API timeout fallback documented
 * in the Implementation Plan preamble).
 *
 * EXPLICIT LIMITATION: This is a SEED-LAYER fidelity gate only — it does NOT model
 * `passesGuardL1` (ADR-024 Jaccard guard), full `applyH7TrailingStrip` production
 * context, L3 fuzzy search, or any L4 LLM fallback. Production parity is verified
 * separately by AC-NEW-qa-battery (human QA, post-deploy).
 *
 * 4-step helper (mirrors conversationCore.ts:688-691 dual-gate):
 *   1. extractFoodQuery(raw.trim())      — wrapper strip
 *   2. extractPortionModifier(stripped.query) — portion/count strip
 *      If modified.cleanQuery !== stripped.query AND modified.portionMultiplier !== 1
 *        → apply stripContainerResidual(modified.cleanQuery) [dual-gate per AC-NEW-export]
 *      Else use modified.cleanQuery
 *   3. extractedTerm.toLowerCase().trim()
 *   4. In-memory seed lookup (name / nameEs / aliases)
 *      On miss: applyH7TrailingStrip retry
 *
 * Pass criterion: ≥6 of 7 fixtures (⌈0.75 × 7⌉ = 6) resolve to a non-null externalId.
 *
 * normalizeQueryKey (verbatim from spec — for fixture deduplication reference only,
 * not used in the 4-step lookup):
 *   raw.toLowerCase().trim().replace(/[.,;:!?¿¡]+$/, '').replace(/\s+/g, ' ')
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { extractFoodQuery } from '../conversation/entityExtractor.js';
import { extractPortionModifier } from '../conversation/entityExtractor.js';
import { stripContainerResidual } from '../conversation/conversationCore.js';
import { applyH7TrailingStrip } from '../estimation/h7TrailingStrip.js';
import type { SpanishDishEntry } from '../scripts/spanishDishesTypes.js';

// ---------------------------------------------------------------------------
// Load seed data
// ---------------------------------------------------------------------------

const DATA_DIR = process.cwd().includes('packages/api') ? '.' : 'packages/api';
const JSON_PATH = path.resolve(DATA_DIR, 'prisma/seed-data/spanish-dishes.json');

interface JsonRoot {
  dishes: SpanishDishEntry[];
}

const jsonRoot = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as JsonRoot;
const dishes = jsonRoot.dishes;

// ---------------------------------------------------------------------------
// 4-step seed-layer lookup helper (mirrors conversationCore.ts:688-691)
// ---------------------------------------------------------------------------

function seedLayerLookup(raw: string): SpanishDishEntry[] {
  // Step 1: wrapper strip
  const stripped = extractFoodQuery(raw.trim());

  // Step 2: portion/count modifier strip + conditional dual-gate container strip
  const modified = extractPortionModifier(stripped.query);
  const extractedTerm =
    modified.cleanQuery !== stripped.query && modified.portionMultiplier !== 1
      ? stripContainerResidual(modified.cleanQuery)
      : modified.cleanQuery;

  // Step 3: lowercase + trim
  const q = extractedTerm.toLowerCase().trim();

  // Step 4a: in-memory seed lookup
  const firstHit = dishes.filter(
    (d) =>
      d.name.toLowerCase() === q ||
      d.nameEs.toLowerCase() === q ||
      (d.aliases ?? []).some((a) => a.toLowerCase() === q),
  );

  if (firstHit.length > 0) return firstHit;

  // Step 4b: on miss — H7 trailing strip retry (ADR-023 L1-Retry Seam)
  const stripped2 = applyH7TrailingStrip(q);
  if (stripped2 === q) return [];

  return dishes.filter(
    (d) =>
      d.name.toLowerCase() === stripped2 ||
      d.nameEs.toLowerCase() === stripped2 ||
      (d.aliases ?? []).some((a) => a.toLowerCase() === stripped2),
  );
}

// ---------------------------------------------------------------------------
// AC-12a: N_LOCKED=7 raw-query locked-denominator fixtures
// ---------------------------------------------------------------------------

describe('F-CATALOG-COV-001 AC-12a: seed-layer fidelity gate (N_LOCKED=7)', () => {
  /**
   * Fixtures: raw QA query → expected externalId target.
   * All 7 are NEW_ALIAS verdicts from the Step 2 pre-analysis table.
   * These tests are RED until Commit 3.5 adds the 7 aliases to spanish-dishes.json.
   */
  const fixtures: Array<[string, string]> = [
    ['una ración de croquetas de jamón ibérico', 'CE-026'],
    ['crema de calabazin', 'CE-072'],
    ['macarrrones con tomate', 'CE-139'],
    ['flam casero', 'CE-171'],
    ['tortiya de patatas', 'CE-028'],
    ['espaguettis carbonara', 'CE-140'],
    ['tarta de quesso', 'CE-173'],
  ];

  it.each(fixtures)(
    'raw "%s" resolves to %s (seed-layer)',
    (raw, expectedEid) => {
      const hits = seedLayerLookup(raw);
      expect(hits.length, `Expected at least one hit for "${raw}"`).toBeGreaterThan(0);
      expect(hits.map((d) => d.externalId)).toContain(expectedEid);
    },
  );

  it('pass criterion: ≥6 of 7 fixtures resolve (⌈0.75 × N_LOCKED⌉ = 6)', () => {
    const resolved = fixtures.filter(([raw]) => seedLayerLookup(raw).length > 0);
    expect(
      resolved.length,
      `Only ${resolved.length} of 7 fixtures resolved — need ≥6`,
    ).toBeGreaterThanOrEqual(6);
  });
});
