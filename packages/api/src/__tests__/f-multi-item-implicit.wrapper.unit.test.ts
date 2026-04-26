// F-MULTI-ITEM-IMPLICIT — Unit tests for wrapper pattern extensions (AC17, AC18).
//
// Tests Pattern 4b (esta mañana/tarde/noche he + participle) and
// Pattern 7b (he entrado/estado en X y me he pedido) inserted into
// CONVERSATIONAL_WRAPPER_PATTERNS in entityExtractor.ts.
//
// These are pure extractFoodQuery() calls — no DB, no mocks needed.
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect } from 'vitest';
import { extractFoodQuery } from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// Phase 3 Step 3.1 — Pattern 4b: esta mañana/tarde/noche he + participle (AC17)
// ---------------------------------------------------------------------------

describe('Pattern 4b — esta mañana/tarde/noche he + participle (AC17)', () => {
  it('"esta mañana he tomado café con leche" → query "café con leche"', () => {
    const result = extractFoodQuery('esta mañana he tomado café con leche');
    expect(result.query).toBe('café con leche');
  });

  it('"esta tarde he bebido agua" → query "agua"', () => {
    const result = extractFoodQuery('esta tarde he bebido agua');
    expect(result.query).toBe('agua');
  });

  it('"esta noche he cenado paella" → query "paella"', () => {
    const result = extractFoodQuery('esta noche he cenado paella');
    expect(result.query).toBe('paella');
  });

  it('"hoy he comido paella" → query "paella" (Pattern 4 fires, NOT 4b — non-regression)', () => {
    // Pattern 4: /^(?:hoy\s+)?he\s+(?:tomado|bebido|comido|...)\s+/i
    // Pattern 4b should NOT intercept this (Pattern 4 is at index 3, before 4b at index 4)
    const result = extractFoodQuery('hoy he comido paella');
    expect(result.query).toBe('paella');
  });

  it('"me he tomado una cerveza" → query "cerveza" (Pattern 1 fires, NOT 4b — non-regression)', () => {
    // Pattern 1: /^me\s+he\s+(?:tomado|...)\s+/i fires before 4b
    const result = extractFoodQuery('me he tomado una cerveza');
    expect(result.query).toBe('cerveza');
  });

  it('"esta mañana he desayunado tostada" → query "tostada"', () => {
    const result = extractFoodQuery('esta mañana he desayunado tostada');
    expect(result.query).toBe('tostada');
  });

  it('"esta mañana he almorzado bocadillo" → query "bocadillo"', () => {
    const result = extractFoodQuery('esta mañana he almorzado bocadillo');
    expect(result.query).toBe('bocadillo');
  });
});

// ---------------------------------------------------------------------------
// Phase 3 Step 3.2 — Pattern 7b: he entrado/estado en X y me he pedido (AC18)
// ---------------------------------------------------------------------------

describe('Pattern 7b — he entrado/estado en X y me he pedido (AC18)', () => {
  it('"he entrado en un bar y me he pedido una caña y unas bravas" → query "caña y unas bravas"', () => {
    // Pattern 7b strips "he entrado en un bar y me he pedido "
    // Then ARTICLE_PATTERN strips "una " → "caña y unas bravas"
    const result = extractFoodQuery('he entrado en un bar y me he pedido una caña y unas bravas');
    expect(result.query).toBe('caña y unas bravas');
  });

  it('"he estado en un restaurante y me he pedido croquetas" → query "croquetas"', () => {
    const result = extractFoodQuery('he estado en un restaurante y me he pedido croquetas');
    expect(result.query).toBe('croquetas');
  });

  it('"he entrado en un bar y me he pedido un chuletón" → query "chuletón"', () => {
    const result = extractFoodQuery('he entrado en un bar y me he pedido un chuletón');
    expect(result.query).toBe('chuletón');
  });

  it('"me voy a pedir paella" → query "paella" (Pattern 7 fires, NOT 7b — non-regression)', () => {
    // Pattern 7: /^me\s+(?:voy\s+a\s+(?:pedir|...))\s+/i
    const result = extractFoodQuery('me voy a pedir paella');
    expect(result.query).toBe('paella');
  });

  it('"he estado en un bar y me he pedido una ración de patatas bravas" → query "patatas bravas"', () => {
    // Pattern 7b strips the wrapper; then serving format "ración de" + article "una" is stripped
    const result = extractFoodQuery('he estado en un bar y me he pedido una ración de patatas bravas');
    expect(result.query).toBe('patatas bravas');
  });
});
