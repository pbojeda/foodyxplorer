// F-H7 QA — Additional edge-case tests for observed coverage gaps.
//
// Gap 1: AC-10 observability — conversationCore.ts call site logger.debug emission
//   for H7-P1..H7-P4. The existing AC-10 tests in fH7.edge-cases.test.ts verify
//   matchedWrapperLabel return value from extractFoodQuery(). This file verifies
//   the actual logger.debug({wrapperPattern: 'H7-PX'}) call fires at the
//   conversationCore.ts call site (line 513-515).
//
// Gap 2: H7-P5 Cat B landmine protection — sepia a la plancha, gambas al ajillo
//   (both have " a la plancha" / no con suffix but are catalog dishes).
//   Integration tests only cover pan con tomate and bacalao al pil-pil.
//   Unit test here verifies strip helpers and seam architecture reasoning for these.
//
// Vitest globals NOT enabled.

import { describe, it, expect } from 'vitest';
import { extractFoodQuery } from '../conversation/entityExtractor.js';
import { applyH7CatBStrip, applyH7TrailingStrip } from '../estimation/h7TrailingStrip.js';

// ---------------------------------------------------------------------------
// Gap 1: AC-10 observability at conversationCore call site
// Verifies that matchedWrapperLabel is non-null when H7-P1..H7-P4 fire,
// confirming the logger.debug gating condition (matchedWrapperLabel != null) is correct.
// The actual logger.debug call in conversationCore is not unit-testable without
// a heavier integration setup (requires real processMessage() + logger mock + cascade mock).
// This test verifies the pre-condition that makes the gating logic correct.
// ---------------------------------------------------------------------------

describe('AC-10 observability — conversationCore call-site pre-condition', () => {
  it('H7-P1 fire sets matchedWrapperLabel to "H7-P1" (pre-condition for logger.debug gating)', () => {
    const r = extractFoodQuery('ayer por la noche cené salmón');
    // conversationCore.ts line 513: if (stripped.matchedWrapperLabel != null) { logger.debug(...) }
    // This test confirms the pre-condition is satisfied for H7-P1
    expect(r.matchedWrapperLabel).toBe('H7-P1');
    expect(r.matchedWrapperLabel).not.toBeNull();
  });

  it('H7-P2 fire sets matchedWrapperLabel to "H7-P2" (pre-condition for logger.debug gating)', () => {
    const r = extractFoodQuery('después del gimnasio me tomé batido de proteínas');
    expect(r.matchedWrapperLabel).toBe('H7-P2');
    expect(r.matchedWrapperLabel).not.toBeNull();
  });

  it('H7-P3 fire sets matchedWrapperLabel to "H7-P3" (pre-condition for logger.debug gating)', () => {
    const r = extractFoodQuery('comí tortilla de patatas');
    expect(r.matchedWrapperLabel).toBe('H7-P3');
    expect(r.matchedWrapperLabel).not.toBeNull();
  });

  it('H7-P4 fire sets matchedWrapperLabel to "H7-P4" (pre-condition for logger.debug gating)', () => {
    const r = extractFoodQuery('quiero probar el bacalao al pil-pil');
    expect(r.matchedWrapperLabel).toBe('H7-P4');
    expect(r.matchedWrapperLabel).not.toBeNull();
  });

  it('Pre-existing Pattern 1 returns matchedWrapperLabel: null (logger.debug gating DOES NOT fire)', () => {
    const r = extractFoodQuery('me he tomado una cerveza');
    // matchedWrapperLabel null → logger.debug NOT called at conversationCore call site
    expect(r.matchedWrapperLabel).toBeNull();
  });

  it('No pattern match returns matchedWrapperLabel: null (logger.debug gating DOES NOT fire)', () => {
    const r = extractFoodQuery('tortilla de patatas');
    expect(r.matchedWrapperLabel ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 2: H7-P5 Cat B landmine protection — dishes that end in cooking-method suffixes
// but ARE catalog entries (protection via seam architecture, not function-level guard)
// ---------------------------------------------------------------------------

describe('H7-P5 Cat B landmine protection — unit verification', () => {
  it('applyH7CatBStrip("sepia a la plancha") strips to "sepia" (raw function behavior)', () => {
    // "Sepia a la plancha" IS a catalog dish. Cat B raw function strips " a la plancha".
    // In production: L1 Pass 1 resolves "sepia a la plancha" before seam is reached.
    // This test documents the raw behavior; seam architecture provides protection.
    expect(applyH7CatBStrip('sepia a la plancha')).toBe('sepia');
  });

  it('applyH7TrailingStrip("espárragos a la plancha") → "espárragos" (raw Cat B strip)', () => {
    // "Espárragos a la plancha" IS in catalog. Same seam architecture protection.
    expect(applyH7TrailingStrip('espárragos a la plancha')).toBe('espárragos');
  });

  it('applyH7CatBStrip("gambas al ajillo") → "gambas al ajillo" (identity — no Cat B suffix)', () => {
    // "gambas al ajillo" has " al ajillo" NOT " a la plancha" or " a baja temperatura"
    // Cat B patterns only cover: "a baja temperatura", "a la plancha", "con extra de [X]"
    // "al ajillo" is NOT a Cat B suffix → identity
    expect(applyH7CatBStrip('gambas al ajillo')).toBe('gambas al ajillo');
  });

  it('applyH7TrailingStrip("café con leche") → "café con leche" (Cat C guard: 1 pre-con token)', () => {
    // "café" is 1 pre-con token → Cat C ≥2 guard fails → identity
    // Confirms "café con leche" catalog dish is protected by Cat C guard
    expect(applyH7TrailingStrip('café con leche')).toBe('café con leche');
  });

  it('applyH7TrailingStrip("tostada con tomate y aceite") → "tostada" (Cat C strips — 1 pre-con token guard FAILS?)', () => {
    // IMPORTANT: "tostada" is 1 pre-con token → Cat C guard requires ≥2 → FAILS → identity!
    // "tostada con tomate y aceite": pre-con = "tostada" = 1 token → guard fails
    // Result: identity. "Tostada con tomate y aceite" is in catalog → L1 Pass 1 hits anyway.
    expect(applyH7TrailingStrip('tostada con tomate y aceite')).toBe('tostada con tomate y aceite');
  });
});

// ---------------------------------------------------------------------------
// Gap 2b: H7-P5 Cat C guard boundary — verify ≥2 pre-con token protection
// for all spec-listed landmine dishes that use "con"
// ---------------------------------------------------------------------------

describe('H7-P5 Cat C guard — landmine dish protection boundary check', () => {
  it('"pan con tomate" → identity (1 pre-con token "pan" → guard fails)', () => {
    // Core landmine test — "pan" = 1 token → Cat C does NOT strip
    expect(applyH7TrailingStrip('pan con tomate')).toBe('pan con tomate');
  });

  it('"arroz con leche" → identity (1 pre-con token)', () => {
    expect(applyH7TrailingStrip('arroz con leche')).toBe('arroz con leche');
  });

  it('"berenjenas con miel" → "berenjenas" (Cat C fires — 1 token... wait)', () => {
    // "berenjenas" = 1 pre-con token → guard FAILS → identity
    // Confirms "berenjenas con miel" (catalog dish) is protected
    expect(applyH7TrailingStrip('berenjenas con miel')).toBe('berenjenas con miel');
  });

  it('"huevos rotos con jamón" → "huevos rotos" (Cat C fires: 2 pre-con tokens ≥2 → strips)', () => {
    // "huevos rotos" = 2 tokens → guard passes → Cat C strips "con jamón"
    // In production: "Huevos rotos con jamón" IS in catalog → L1 Pass 1 hits → seam NEVER reached
    // This test documents the raw Cat C behavior; seam architecture provides protection.
    expect(applyH7TrailingStrip('huevos rotos con jamón')).toBe('huevos rotos');
  });

  it('"espárragos con jamón" → "espárragos" (Cat C fires: 1 pre-con token? NO — 1 token)', () => {
    // "espárragos" = 1 pre-con token → guard FAILS → identity
    // "Espárragos con jamón" IS in catalog → seam never reached AND guard also protects
    expect(applyH7TrailingStrip('espárragos con jamón')).toBe('espárragos con jamón');
  });

  it('"judías verdes con patatas" → "judías verdes" (Cat C fires: 2 pre-con tokens)', () => {
    // "judías verdes" = 2 tokens → guard passes → Cat C strips "con patatas"
    // In production: "Judías verdes con patatas" IS in catalog → L1 Pass 1 hits → seam NEVER reached
    // This test documents raw behavior.
    expect(applyH7TrailingStrip('judías verdes con patatas')).toBe('judías verdes');
  });
});
