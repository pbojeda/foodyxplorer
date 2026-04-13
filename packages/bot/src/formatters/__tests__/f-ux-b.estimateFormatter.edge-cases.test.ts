// F-UX-B — Edge-case tests for estimateFormatter (QA-authored).
//
// Covers gaps not exercised by the TDD suite:
// 1. M1: Unescaped ~ in MarkdownV2 output — the tilde in "~N pieceName" MUST be
//    escaped as \~ for Telegram MarkdownV2. An unescaped ~ causes a 400 Bad Request
//    or garbled strikethrough rendering.
// 2. Multi-word pieceName: the copy-discipline regex only covers single-word piece
//    names; a pieceName with spaces (e.g., "gambas peladas") would not match.
//    Test that the formatter still produces correct copy and that the regex
//    gap is documented.
// 3. Accented single-word pieceName (piñones, jalapeños, cañitas): verifies the
//    bot Markdown escaping works correctly for ñ and accented chars.
// 4. Very large pieces count (pieces=50, pieceName='aceitunas'): layout sanity
//    check — formatter should emit the count without truncation.
// 5. pieceName with Markdown special chars (e.g., 'croquetas_frías'): verifies
//    that pieceName is passed through escapeMarkdown.

import { describe, it, expect } from 'vitest';
import { formatEstimate } from '../estimateFormatter.js';
import type { EstimateData, PortionAssumption } from '@foodxplorer/shared';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function baseNutrients() {
  return {
    calories: 300,
    proteins: 10,
    carbohydrates: 25,
    sugars: 1,
    fats: 15,
    saturatedFats: 5,
    fiber: 1,
    salt: 0.9,
    sodium: 360,
    transFats: 0,
    cholesterol: 0,
    potassium: 0,
    monounsaturatedFats: 0,
    polyunsaturatedFats: 0,
    alcohol: 0,
    referenceBasis: 'per_serving' as const,
  };
}

function makeData(portionAssumption: PortionAssumption): EstimateData {
  return {
    query: 'tapa de prueba',
    chainSlug: null,
    portionMultiplier: 1,
    level1Hit: true,
    level2Hit: false,
    level3Hit: false,
    level4Hit: false,
    matchType: 'exact_dish',
    cachedAt: null,
    result: {
      entityType: 'dish',
      entityId: '00000000-0000-f-ux-b-qa-000000000099',
      name: 'Dish QA',
      nameEs: 'Plato QA',
      restaurantId: null,
      chainSlug: null,
      portionGrams: 100,
      nutrients: baseNutrients(),
      confidenceLevel: 'high' as const,
      estimationMethod: 'scraped' as const,
      source: {
        id: '00000000-0000-f-ux-b-qa-000000000100',
        name: 'QA Source',
        type: 'official' as const,
        url: null,
      },
      similarityDistance: null,
    },
    portionAssumption,
  };
}

// ---------------------------------------------------------------------------
// M1 — Unescaped ~ in MarkdownV2
// ---------------------------------------------------------------------------

describe('F-UX-B formatter edge-cases — MarkdownV2 tilde escaping (M1)', () => {
  it('M1: the ~ before the piece count MUST be escaped as \\~ for MarkdownV2 compliance', () => {
    // In Telegram MarkdownV2, ~ is a reserved char (strikethrough delimiter).
    // An unescaped ~ causes a 400 Bad Request from the Telegram Bot API.
    // The formatter should emit \\~ (escaped tilde) not a bare ~.
    const pa: PortionAssumption = {
      term: 'tapa',
      termDisplay: 'tapa',
      source: 'per_dish',
      grams: 50,
      pieces: 2,
      pieceName: 'croquetas',
      gramsRange: null,
      confidence: 'high',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));

    // The ~ before pieces MUST be escaped in MarkdownV2
    // Correct:   ...tapa \(\\~2 croquetas, ≈ 50 g\)
    // Incorrect: ...tapa \(~2 croquetas, ≈ 50 g\)
    //
    // CURRENT BEHAVIOR (failing): formatter emits bare ~ (not escaped)
    // This test documents the bug and will fail until the fix is applied.
    expect(output).toMatch(/\\~\d+ croquetas/); // escaped tilde: \~2
    expect(output).not.toMatch(/[^\\]~\d+ croquetas/); // no bare ~ before digit
  });
});

// ---------------------------------------------------------------------------
// Accented pieceName — MarkdownV2 safety for ñ, accented vowels
// ---------------------------------------------------------------------------

describe('F-UX-B formatter edge-cases — accented pieceName', () => {
  it('piñones: ñ in pieceName passes through correctly (not a MarkdownV2 reserved char)', () => {
    const pa: PortionAssumption = {
      term: 'tapa',
      termDisplay: 'tapa',
      source: 'per_dish',
      grams: 20,
      pieces: 5,
      pieceName: 'piñones',
      gramsRange: null,
      confidence: 'medium',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));
    // piñones should appear in output without mangling
    expect(output).toContain('piñones');
    // ñ must NOT be double-escaped or stripped
    expect(output).not.toContain('pi\\~ones');
    expect(output).not.toContain('pinones');
  });

  it('jalapeños: ñ and accented ó in pieceName appear correctly', () => {
    const pa: PortionAssumption = {
      term: 'tapa',
      termDisplay: 'tapa',
      source: 'per_dish',
      grams: 30,
      pieces: 3,
      pieceName: 'jalapeños',
      gramsRange: null,
      confidence: 'medium',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));
    expect(output).toContain('jalapeños');
  });
});

// ---------------------------------------------------------------------------
// Multi-word pieceName
// ---------------------------------------------------------------------------

describe('F-UX-B formatter edge-cases — multi-word pieceName', () => {
  it('multi-word pieceName renders correctly in bot output', () => {
    // Analyst may seed pieceName as "gambas peladas" — two words.
    // The formatter should emit "~5 gambas peladas, ≈ 80 g" without truncation.
    const pa: PortionAssumption = {
      term: 'tapa',
      termDisplay: 'tapa',
      source: 'per_dish',
      grams: 80,
      pieces: 5,
      pieceName: 'gambas peladas',
      gramsRange: null,
      confidence: 'medium',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));
    expect(output).toContain('gambas peladas');
    // NOTE: the spec copy-discipline regex /~\d+ [a-záéíóúñ]+ \(≈ \d+ g\)/ covers
    // only SINGLE-word piece names. Multi-word names will NOT match this regex.
    // This is a known gap (M3) — the regex in the spec needs to be updated to
    // /~\d+ [a-záéíóúñ ]+\(≈ \d+ g\)/ to allow spaces in the piece name.
    // This test asserts correct functional rendering (content) even if the spec
    // regex doesn't match multi-word names.
  });

  it('pieceName with Markdown special chars is escaped', () => {
    // Edge case: analyst seeds pieceName='croquetas_frías' (underscore = italic in MarkdownV2)
    // The formatter calls escapeMarkdown(pa.pieceName) — this should escape the underscore.
    const pa: PortionAssumption = {
      term: 'tapa',
      termDisplay: 'tapa',
      source: 'per_dish',
      grams: 50,
      pieces: 2,
      pieceName: 'croquetas_frías',
      gramsRange: null,
      confidence: 'high',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));
    // Underscore must be escaped as \_ in MarkdownV2 output
    expect(output).toContain('croquetas\\_frías');
    expect(output).not.toMatch(/croquetas_frías/); // bare underscore NOT allowed in MarkdownV2
  });
});

// ---------------------------------------------------------------------------
// Very large pieces count
// ---------------------------------------------------------------------------

describe('F-UX-B formatter edge-cases — large pieces count', () => {
  it('pieces=50 renders correctly without truncation', () => {
    const pa: PortionAssumption = {
      term: 'racion',
      termDisplay: 'ración',
      source: 'per_dish',
      grams: 200,
      pieces: 50,
      pieceName: 'aceitunas',
      gramsRange: null,
      confidence: 'low',
      fallbackReason: null,
    };
    const output = formatEstimate(makeData(pa));
    // All 50 should appear, not truncated to e.g. "~5" or "~5+"
    expect(output).toContain('50');
    expect(output).toContain('aceitunas');
  });
});
