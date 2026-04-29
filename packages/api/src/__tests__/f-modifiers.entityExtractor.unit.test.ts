// F-MODIFIERS-001 — Extend extractPortionModifier with mediano/gigante/casero patterns.
//
// Tests added per ticket F-MODIFIERS-001-extend-extractPortionModifier.md:
//   - Bare `mediano/a/s/as` → 1.0× (informational size)
//   - Bare `gigantes?` → 2.0× (parallel to enorme)
//   - Bare `casero/a/s/as` → 1.0× (informational quality, standalone)
//   - Compound `ración mediana` → 1.0× + leading `de` consumed
//   - Compound `ración gigante` → 2.0× + leading `de` consumed
//   - Regression assertions for unchanged behaviour (no interference with H7 Cat A
//     `casero de postre` flow, no regression on existing `enorme/extra/grande/...`)

import { describe, it, expect } from 'vitest';
import { extractPortionModifier } from '../conversation/entityExtractor.js';

// ---------------------------------------------------------------------------
// AC1 — Bare `mediano/a/s/as` → 1.0
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — bare `mediano/a/s/as` → 1.0', () => {
  it('mediano (masc sing) → 1.0', () => {
    const r = extractPortionModifier('plato mediano');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('plato');
  });

  it('mediana (fem sing) → 1.0', () => {
    const r = extractPortionModifier('paella mediana');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('paella');
  });

  it('medianos (masc plural) → 1.0', () => {
    const r = extractPortionModifier('platos medianos');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('platos');
  });

  it('medianas (fem plural) → 1.0', () => {
    const r = extractPortionModifier('paellas medianas');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('paellas');
  });
});

// ---------------------------------------------------------------------------
// AC2 — Bare `gigantes?` → 2.0
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — bare `gigantes?` → 2.0', () => {
  it('gigante (sing) → 2.0', () => {
    const r = extractPortionModifier('pizza gigante');
    expect(r.portionMultiplier).toBe(2.0);
    expect(r.cleanQuery).toBe('pizza');
  });

  it('gigantes (plural) → 2.0', () => {
    const r = extractPortionModifier('pizzas gigantes');
    expect(r.portionMultiplier).toBe(2.0);
    expect(r.cleanQuery).toBe('pizzas');
  });
});

// ---------------------------------------------------------------------------
// AC3 — Bare `casero/a/s/as` → 1.0 (standalone)
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — bare `casero/a/s/as` → 1.0 (standalone)', () => {
  it('casero (masc sing) → 1.0', () => {
    const r = extractPortionModifier('flan casero');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('flan');
  });

  it('casera (fem sing) → 1.0 — addresses F-H10-FU2 over-rejection scenario', () => {
    // Concrete failure mode from spec: "tarta de queso casera" → L1 every-HI rejects
    // because "casera" not in canonical "Tarta de queso". Strip alleviates.
    const r = extractPortionModifier('tarta de queso casera');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('tarta de queso');
  });

  it('caseros (masc plural) → 1.0', () => {
    const r = extractPortionModifier('flanes caseros');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('flanes');
  });

  it('caseras (fem plural) → 1.0', () => {
    const r = extractPortionModifier('natillas caseras');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('natillas');
  });
});

// ---------------------------------------------------------------------------
// AC4 — Compound `ración mediana de` → 1.0 + leading `de` consumed
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — compound `ración mediana` → 1.0', () => {
  it('ración mediana de paella → 1.0, query="paella"', () => {
    const r = extractPortionModifier('ración mediana de paella');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('paella');
  });

  it('ración mediano de croquetas → 1.0 (masc form accepted)', () => {
    const r = extractPortionModifier('ración mediano de croquetas');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('croquetas');
  });
});

// ---------------------------------------------------------------------------
// AC5 — Compound `ración gigante de` → 2.0 + leading `de` consumed
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — compound `ración gigante` → 2.0', () => {
  it('ración gigante de pizza → 2.0, query="pizza"', () => {
    const r = extractPortionModifier('ración gigante de pizza');
    expect(r.portionMultiplier).toBe(2.0);
    expect(r.cleanQuery).toBe('pizza');
  });
});

// ---------------------------------------------------------------------------
// AC6 — Regression: existing patterns unchanged
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — regression: existing patterns unchanged', () => {
  it('grande → 1.5 (no interference from new mediano)', () => {
    const r = extractPortionModifier('pizza grande');
    expect(r.portionMultiplier).toBe(1.5);
    expect(r.cleanQuery).toBe('pizza');
  });

  it('enorme → 2.0 (no interference from new gigante)', () => {
    const r = extractPortionModifier('pizza enorme');
    expect(r.portionMultiplier).toBe(2.0);
    expect(r.cleanQuery).toBe('pizza');
  });

  it('extra → 1.5 (no interference from gigante which precedes it in array)', () => {
    const r = extractPortionModifier('porción extra');
    expect(r.portionMultiplier).toBe(1.5);
    expect(r.cleanQuery).toBe('porción');
  });

  it('media → 0.5 (no interference from new mediano)', () => {
    // \bmedias?\b matches "media", \bmedian[oa]s?\b matches "mediana" — no overlap
    const r = extractPortionModifier('media porción');
    expect(r.portionMultiplier).toBe(0.5);
    expect(r.cleanQuery).toBe('porción');
  });

  it('medio → 0.5 (no interference from new mediano)', () => {
    const r = extractPortionModifier('medio bocadillo');
    expect(r.portionMultiplier).toBe(0.5);
    expect(r.cleanQuery).toBe('bocadillo');
  });

  it('ración enorme de paella → 2.0 (compound still wins via longest-first)', () => {
    const r = extractPortionModifier('ración enorme de paella');
    expect(r.portionMultiplier).toBe(2.0);
    expect(r.cleanQuery).toBe('paella');
  });

  it('ración generosa de pollo → 1.0 (compound unchanged)', () => {
    const r = extractPortionModifier('ración generosa de pollo');
    expect(r.portionMultiplier).toBe(1.0);
    expect(r.cleanQuery).toBe('pollo');
  });
});

// ---------------------------------------------------------------------------
// AC7 — Bare modifiers don't interfere with each other
// ---------------------------------------------------------------------------

describe('F-MODIFIERS-001 — modifier interaction', () => {
  it('only first matched modifier wins (extractor is single-pass)', () => {
    // Both "casera" and "mediana" present — first match in PATTERNS order wins.
    // Per array order: gigante > extra > buen > generoso > MEDIANO > CASERO.
    // So "mediana" matches first.
    const r = extractPortionModifier('paella mediana casera');
    expect(r.portionMultiplier).toBe(1.0);
    // cleanQuery contains the un-stripped portion
    expect(r.cleanQuery.toLowerCase()).toContain('paella');
  });
});
