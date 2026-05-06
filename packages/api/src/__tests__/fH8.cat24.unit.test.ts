// F-H8 — Unit tests for Cat D trailing dietary/state inquiry suffix strip.
//
// Tests pure function applyH8CatDStrip from h7TrailingStrip.ts:
//   - tag-question strip: ", verdad?" / ", no?" / ", cierto?" / ", seguro?"
//   - state inquiry strip: " está [adjective phrase]?"
//   - qualifier inquiry strip: " es [phrase]?"
//   - ingredient inquiry strip: " lleva [ingredient]?"
//   - chained: tag-question + state inquiry
//   - empty-strip guard
//   - no-match identity
//
// Also tests integration with applyH7TrailingStrip (Cat A → B → C → D priority).
//
// Pure function calls — no DB, no mocks needed.
// Vitest globals NOT enabled — import everything explicitly.

import { describe, it, expect } from 'vitest';
import {
  applyH8CatDStrip,
  applyH7TrailingStrip,
  applyH7CatAStrip,
  applyH7CatBStrip,
  applyH7CatCStrip,
} from '../estimation/h7TrailingStrip.js';

// ---------------------------------------------------------------------------
// Cat D — tag-question strip
// ---------------------------------------------------------------------------

describe('H8 Cat D — tag-question strip', () => {
  it('"pollo al ajillo, verdad?" → "pollo al ajillo"', () => {
    expect(applyH8CatDStrip('pollo al ajillo, verdad?')).toBe('pollo al ajillo');
  });

  it('"gazpacho, no?" → "gazpacho"', () => {
    expect(applyH8CatDStrip('gazpacho, no?')).toBe('gazpacho');
  });

  it('"paella valenciana, cierto?" → "paella valenciana"', () => {
    expect(applyH8CatDStrip('paella valenciana, cierto?')).toBe('paella valenciana');
  });

  it('"tortilla española, seguro?" → "tortilla española"', () => {
    expect(applyH8CatDStrip('tortilla española, seguro?')).toBe('tortilla española');
  });

  it('"croquetas, verdad" → "croquetas" (no trailing ?)', () => {
    expect(applyH8CatDStrip('croquetas, verdad')).toBe('croquetas');
  });

  it('"croquetas verdad?" → unchanged (requires comma before tag-word)', () => {
    expect(applyH8CatDStrip('croquetas verdad?')).toBe('croquetas verdad?');
  });
});

// ---------------------------------------------------------------------------
// Cat D — state inquiry strip ("está [adjective]?")
// ---------------------------------------------------------------------------

describe('H8 Cat D — "está [adjective]?" strip', () => {
  it('"el pollo al ajillo está muy guisado?" → "el pollo al ajillo"', () => {
    expect(applyH8CatDStrip('el pollo al ajillo está muy guisado?')).toBe('el pollo al ajillo');
  });

  it('"gazpacho está frío?" → "gazpacho"', () => {
    expect(applyH8CatDStrip('gazpacho está frío?')).toBe('gazpacho');
  });

  it('"croquetas están calientes?" → unchanged (plural "están" not in pattern)', () => {
    // Conservative: only "está" singular form
    expect(applyH8CatDStrip('croquetas están calientes?')).toBe('croquetas están calientes?');
  });
});

// ---------------------------------------------------------------------------
// Cat D — qualifier inquiry strip ("es [phrase]?")
// ---------------------------------------------------------------------------

describe('H8 Cat D — "es [phrase]?" strip', () => {
  it('"el pulpo es a la brasa?" → "el pulpo"', () => {
    expect(applyH8CatDStrip('el pulpo es a la brasa?')).toBe('el pulpo');
  });

  it('"el gazpacho es ecológico?" → "el gazpacho"', () => {
    expect(applyH8CatDStrip('el gazpacho es ecológico?')).toBe('el gazpacho');
  });

  it('"el bonito en escabeche es de lata o casero?" → "el bonito en escabeche"', () => {
    expect(applyH8CatDStrip('el bonito en escabeche es de lata o casero?'))
      .toBe('el bonito en escabeche');
  });

  it('"el pescado es a la brasa o frito?" → "el pescado"', () => {
    expect(applyH8CatDStrip('el pescado es a la brasa o frito?')).toBe('el pescado');
  });
});

// ---------------------------------------------------------------------------
// Cat D — ingredient inquiry strip ("lleva [ingredient]?")
// ---------------------------------------------------------------------------

describe('H8 Cat D — "lleva [ingredient]?" strip', () => {
  it('"la salsa de los chipirones lleva lactosa?" → "la salsa de los chipirones"', () => {
    expect(applyH8CatDStrip('la salsa de los chipirones lleva lactosa?'))
      .toBe('la salsa de los chipirones');
  });

  it('"el flan lleva huevo?" → "el flan"', () => {
    expect(applyH8CatDStrip('el flan lleva huevo?')).toBe('el flan');
  });
});

// ---------------------------------------------------------------------------
// Cat D — chained: tag-question + state inquiry
// ---------------------------------------------------------------------------

describe('H8 Cat D — chained suffixes', () => {
  it('"el tartar de atún es crudo, verdad?" → "el tartar de atún" (chains tag + es)', () => {
    expect(applyH8CatDStrip('el tartar de atún es crudo, verdad?')).toBe('el tartar de atún');
  });

  it('"el pollo está frito, no?" → "el pollo" (chains tag + está)', () => {
    expect(applyH8CatDStrip('el pollo está frito, no?')).toBe('el pollo');
  });
});

// ---------------------------------------------------------------------------
// Cat D — empty-strip guard
// ---------------------------------------------------------------------------

describe('H8 Cat D — empty-strip guard', () => {
  it('", verdad?" → ", verdad?" (would empty — return original)', () => {
    expect(applyH8CatDStrip(', verdad?')).toBe(', verdad?');
  });

  it('"verdad?" alone → unchanged (no comma)', () => {
    expect(applyH8CatDStrip('verdad?')).toBe('verdad?');
  });
});

// ---------------------------------------------------------------------------
// Cat D — identity (no match)
// ---------------------------------------------------------------------------

describe('H8 Cat D — identity (no-match)', () => {
  it('"pollo al ajillo" → "pollo al ajillo" (no Cat D suffix)', () => {
    expect(applyH8CatDStrip('pollo al ajillo')).toBe('pollo al ajillo');
  });

  it('"arroz con leche" → "arroz con leche" (no Cat D suffix)', () => {
    expect(applyH8CatDStrip('arroz con leche')).toBe('arroz con leche');
  });

  it('"gazpacho andaluz" → unchanged', () => {
    expect(applyH8CatDStrip('gazpacho andaluz')).toBe('gazpacho andaluz');
  });

  it('empty string → "" (empty input)', () => {
    expect(applyH8CatDStrip('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// applyH7TrailingStrip — Cat A → B → C → D priority order
// ---------------------------------------------------------------------------

describe('applyH7TrailingStrip — Cat D appended to priority order', () => {
  it('Cat A still fires before Cat D for "talo con chistorra, por favor"', () => {
    expect(applyH7TrailingStrip('talo con chistorra, por favor')).toBe('talo con chistorra');
  });

  it('Cat B still fires before Cat D for "salmón a la plancha"', () => {
    expect(applyH7TrailingStrip('salmón a la plancha')).toBe('salmón');
  });

  it('Cat C still fires before Cat D for "foo con bar"', () => {
    expect(applyH7TrailingStrip('foo bar con baz')).toBe('foo bar');
  });

  it('Cat D fires when A/B/C do not match: "el gazpacho es ecológico?"', () => {
    expect(applyH7TrailingStrip('el gazpacho es ecológico?')).toBe('el gazpacho');
  });

  it('Cat D fires for tag-question: "pollo al ajillo, verdad?"', () => {
    expect(applyH7TrailingStrip('pollo al ajillo, verdad?')).toBe('pollo al ajillo');
  });

  it('No category matches → identity for "tortilla francesa"', () => {
    expect(applyH7TrailingStrip('tortilla francesa')).toBe('tortilla francesa');
  });

  it('Cat A precedence preserved: "tiramisú casero de postre" (would also match Cat D " es" but no "es" present)', () => {
    expect(applyH7TrailingStrip('tiramisú casero de postre')).toBe('tiramisú');
  });
});

// ---------------------------------------------------------------------------
// F-H7 Cat A/B/C regression — verify no behavior change after Cat D added
// ---------------------------------------------------------------------------

describe('F-H7 Cat A/B/C regression after Cat D addition', () => {
  it('Cat A still strips "por favor"', () => {
    expect(applyH7CatAStrip('paella, por favor')).toBe('paella');
  });

  it('Cat B still strips "a la plancha"', () => {
    expect(applyH7CatBStrip('sepia a la plancha')).toBe('sepia');
  });

  it('Cat C still strips "con [tail]" with ≥2 pre-con tokens', () => {
    expect(applyH7CatCStrip('foo bar con baz')).toBe('foo bar');
  });

  it('Cat C still preserves "arroz con leche" (1 pre-con token)', () => {
    expect(applyH7CatCStrip('arroz con leche')).toBe('arroz con leche');
  });
});
