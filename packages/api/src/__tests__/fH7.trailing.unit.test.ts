// F-H7 — Unit tests for H7-P5 trailing conversational modifier strip helpers.
//
// Tests pure functions from h7TrailingStrip.ts:
//   applyH7CatAStrip  — conversational suffix strip (por favor, para merendar, etc.)
//   applyH7CatBStrip  — cooking/serving method suffix strip (a la plancha, a baja temperatura, etc.)
//   applyH7CatCStrip  — trailing "con [tail]" strip with ≥2 pre-con tokens guard
//   applyH7TrailingStrip — combined Cat A → B → C priority-order strip
//
// Pure function calls — no DB, no mocks needed.
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect } from 'vitest';
import {
  applyH7CatAStrip,
  applyH7CatBStrip,
  applyH7CatCStrip,
  applyH7TrailingStrip,
} from '../estimation/h7TrailingStrip.js';

// ---------------------------------------------------------------------------
// Cat A — conversational suffix strip
// ---------------------------------------------------------------------------

describe('H7-P5 Cat A — conversational suffix strip', () => {
  it('"gazpachuelo malagueño bien caliente" → "gazpachuelo malagueño"', () => {
    expect(applyH7CatAStrip('gazpachuelo malagueño bien caliente')).toBe('gazpachuelo malagueño');
  });

  it('"tiramisú casero de postre" → "tiramisú" (strips "casero de postre" as a unit)', () => {
    expect(applyH7CatAStrip('tiramisú casero de postre')).toBe('tiramisú');
  });

  it('"talo con chistorra, por favor" → "talo con chistorra" (strips ", por favor")', () => {
    expect(applyH7CatAStrip('talo con chistorra, por favor')).toBe('talo con chistorra');
  });

  it('"michirones para picar" → "michirones"', () => {
    expect(applyH7CatAStrip('michirones para picar')).toBe('michirones');
  });

  it('"ceviche de corvina clásico" → "ceviche de corvina"', () => {
    expect(applyH7CatAStrip('ceviche de corvina clásico')).toBe('ceviche de corvina');
  });

  it('"arroz con leche" → "arroz con leche" (no Cat A suffix — identity)', () => {
    expect(applyH7CatAStrip('arroz con leche')).toBe('arroz con leche');
  });

  it('empty string → "" (empty-input guard)', () => {
    expect(applyH7CatAStrip('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Cat B — cooking/serving method suffix strip
// ---------------------------------------------------------------------------

describe('H7-P5 Cat B — cooking/serving method suffix strip', () => {
  it('"bao de panceta a baja temperatura" → "bao de panceta"', () => {
    expect(applyH7CatBStrip('bao de panceta a baja temperatura')).toBe('bao de panceta');
  });

  it('"gyozas a la plancha" → "gyozas"', () => {
    expect(applyH7CatBStrip('gyozas a la plancha')).toBe('gyozas');
  });

  it('"burrito de cochinita pibil con extra de picante" → "burrito de cochinita pibil"', () => {
    expect(applyH7CatBStrip('burrito de cochinita pibil con extra de picante')).toBe('burrito de cochinita pibil');
  });

  it('"sepia a la plancha" — raw function strips to "sepia" (protection comes from seam architecture, not the function)', () => {
    // IMPORTANT: applyH7CatBStrip itself strips "a la plancha" as a trailing pattern.
    // "sepia a la plancha" IS a catalog dish — protection comes from the retry-seam architecture:
    // L1 Pass 1 hits "sepia a la plancha" before the seam is reached, so Cat B never fires in production.
    // This unit test verifies the raw function behavior; the seam-level protection is integration-tested.
    expect(applyH7CatBStrip('sepia a la plancha')).toBe('sepia');
  });

  it('"pollo al horno" → "pollo al horno" (no Cat B suffix — identity)', () => {
    expect(applyH7CatBStrip('pollo al horno')).toBe('pollo al horno');
  });
});

// ---------------------------------------------------------------------------
// Cat C — trailing "con [tail]" strip with ≥2 pre-con tokens guard
// ---------------------------------------------------------------------------

describe('H7-P5 Cat C — trailing con [tail] strip with ≥2 pre-con tokens guard', () => {
  it('"tataki de atún con sésamo" → "tataki de atún" (3 pre-con tokens → strips)', () => {
    expect(applyH7CatCStrip('tataki de atún con sésamo')).toBe('tataki de atún');
  });

  it('"tacos al pastor con cilantro y piña" → "tacos al pastor"', () => {
    expect(applyH7CatCStrip('tacos al pastor con cilantro y piña')).toBe('tacos al pastor');
  });

  it('"carpaccio de buey con parmesano" → "carpaccio de buey"', () => {
    expect(applyH7CatCStrip('carpaccio de buey con parmesano')).toBe('carpaccio de buey');
  });

  it('"hamburguesa gourmet con queso de cabra y cebolla caramelizada" → "hamburguesa gourmet"', () => {
    expect(applyH7CatCStrip('hamburguesa gourmet con queso de cabra y cebolla caramelizada')).toBe('hamburguesa gourmet');
  });

  it('"foo con bar" → "foo con bar" (1 pre-con token → ≥2 guard fails → identity)', () => {
    // Synthetic non-catalog input: "foo" is 1 token, guard requires ≥2 → no strip
    expect(applyH7CatCStrip('foo con bar')).toBe('foo con bar');
  });

  it('"arroz con leche" → "arroz con leche" (1 pre-con token "arroz" → guard fails → identity)', () => {
    // "arroz" is 1 whitespace-delimited token before "con"
    expect(applyH7CatCStrip('arroz con leche')).toBe('arroz con leche');
  });

  it('"foo bar con baz con qux" → "foo bar con baz" (strips LAST con [tail]; pre-fragment "foo bar con baz" ≥2 tokens)', () => {
    // Use lastIndexOf to find rightmost " con " boundary.
    // Pre-fragment "foo bar con baz" has ≥2 tokens → strip the last " con qux"
    expect(applyH7CatCStrip('foo bar con baz con qux')).toBe('foo bar con baz');
  });

  it('"bacalao al pil-pil con tomate" → "bacalao al pil-pil" (≥2 pre-con tokens → strips; seam arch protects catalog entries)', () => {
    // Pure function strips. In production: "bacalao al pil-pil" is a catalog dish that hits
    // L1 Pass 1 before the seam is reached — Cat C never fires for it.
    expect(applyH7CatCStrip('bacalao al pil-pil con tomate')).toBe('bacalao al pil-pil');
  });

  it('"con sésamo" → "con sésamo" (0 pre-con tokens → identity)', () => {
    expect(applyH7CatCStrip('con sésamo')).toBe('con sésamo');
  });
});

// ---------------------------------------------------------------------------
// Combined applyH7TrailingStrip — Cat A > B > C priority order
// ---------------------------------------------------------------------------

describe('H7-P5 combined applyH7TrailingStrip — Cat A > B > C priority order', () => {
  it('"gazpachuelo malagueño bien caliente" → "gazpachuelo malagueño" (Cat A fires)', () => {
    expect(applyH7TrailingStrip('gazpachuelo malagueño bien caliente')).toBe('gazpachuelo malagueño');
  });

  it('"bao de panceta a baja temperatura" → "bao de panceta" (Cat B fires)', () => {
    expect(applyH7TrailingStrip('bao de panceta a baja temperatura')).toBe('bao de panceta');
  });

  it('"tataki de atún con sésamo" → "tataki de atún" (Cat C fires)', () => {
    expect(applyH7TrailingStrip('tataki de atún con sésamo')).toBe('tataki de atún');
  });

  it('"paella valenciana" → "paella valenciana" (identity — no strip applies)', () => {
    expect(applyH7TrailingStrip('paella valenciana')).toBe('paella valenciana');
  });

  it('"talo con chistorra, por favor" → "talo con chistorra" (Cat A fires; Cat C does NOT also strip "con chistorra")', () => {
    // Cat A strips ", por favor" → "talo con chistorra". Function returns after first successful strip.
    // Cat C would strip "con chistorra" if called — but priority order stops at Cat A.
    expect(applyH7TrailingStrip('talo con chistorra, por favor')).toBe('talo con chistorra');
  });
});
