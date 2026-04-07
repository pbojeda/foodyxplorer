import { describe, it, expect } from 'vitest';
import { detectPortionTerm, enrichWithPortionSizing } from '../estimation/portionSizing.js';

// ---------------------------------------------------------------------------
// detectPortionTerm — core detection
// ---------------------------------------------------------------------------

describe('detectPortionTerm', () => {
  // --- All portion terms ---

  it('detects "media ración"', () => {
    const result = detectPortionTerm('media ración de calamares');
    expect(result).toMatchObject({ term: 'media ración', gramsMin: 100, gramsMax: 125 });
  });

  it('detects "media racion" (no accent)', () => {
    const result = detectPortionTerm('media racion de patatas bravas');
    expect(result).toMatchObject({ term: 'media ración' });
  });

  it('detects "ración"', () => {
    const result = detectPortionTerm('una ración de croquetas');
    expect(result).toMatchObject({ term: 'ración', gramsMin: 200, gramsMax: 250 });
  });

  it('detects "ración para compartir"', () => {
    const result = detectPortionTerm('ración para compartir de jamón');
    expect(result).toMatchObject({ term: 'ración para compartir', gramsMin: 300, gramsMax: 400 });
  });

  it('detects "tapa"', () => {
    const result = detectPortionTerm('una tapa de tortilla');
    expect(result).toMatchObject({ term: 'tapa', gramsMin: 50, gramsMax: 80 });
  });

  it('detects "pintxo"', () => {
    const result = detectPortionTerm('un pintxo de tortilla');
    expect(result).toMatchObject({ term: 'pintxo', gramsMin: 30, gramsMax: 60 });
  });

  it('detects "pincho"', () => {
    const result = detectPortionTerm('un pincho de moruno');
    expect(result).toMatchObject({ term: 'pintxo' });
  });

  it('detects "montadito"', () => {
    const result = detectPortionTerm('un montadito de lomo');
    expect(result).toMatchObject({ term: 'montadito', gramsMin: 40, gramsMax: 60 });
  });

  it('detects "bocadillo"', () => {
    const result = detectPortionTerm('un bocadillo de jamón');
    expect(result).toMatchObject({ term: 'bocadillo', gramsMin: 200, gramsMax: 250 });
  });

  it('detects "bocata"', () => {
    const result = detectPortionTerm('un bocata de calamares');
    expect(result).toMatchObject({ term: 'bocadillo' });
  });

  it('detects "plato"', () => {
    const result = detectPortionTerm('un plato de lentejas');
    expect(result).toMatchObject({ term: 'plato', gramsMin: 250, gramsMax: 300 });
  });

  it('detects "caña"', () => {
    const result = detectPortionTerm('una caña');
    expect(result).toMatchObject({ term: 'caña', gramsMin: 200, gramsMax: 200 });
  });

  it('detects "cana" (no accent)', () => {
    const result = detectPortionTerm('una cana de cerveza');
    expect(result).toMatchObject({ term: 'caña' });
  });

  // --- Priority: longest match first ---

  it('"media ración" takes priority over "ración"', () => {
    const result = detectPortionTerm('media ración de boquerones');
    expect(result?.term).toBe('media ración');
  });

  it('"ración para compartir" takes priority over "ración"', () => {
    const result = detectPortionTerm('ración para compartir de ibérico');
    expect(result?.term).toBe('ración para compartir');
  });

  // --- Edge cases ---

  it('returns null for query without portion term', () => {
    expect(detectPortionTerm('pollo a la plancha')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectPortionTerm('')).toBeNull();
  });

  it('is case-insensitive', () => {
    const upper = detectPortionTerm('MEDIA RACIÓN DE CALAMARES');
    const lower = detectPortionTerm('media ración de calamares');
    expect(upper?.term).toBe(lower?.term);
  });

  it('includes description', () => {
    const result = detectPortionTerm('una tapa de tortilla');
    expect(result?.description).toContain('Tapa');
  });

  // --- First match wins ---

  it('returns first match only (no duplicates)', () => {
    // "una tapa de bocadillo" — tapa comes before bocadillo in rules
    const result = detectPortionTerm('una tapa de bocadillo');
    expect(result?.term).toBe('tapa');
  });
});

// ---------------------------------------------------------------------------
// enrichWithPortionSizing — DRY helper
// ---------------------------------------------------------------------------

describe('enrichWithPortionSizing', () => {
  it('returns portionSizing when term detected', () => {
    const result = enrichWithPortionSizing('media ración de calamares');
    expect(result.portionSizing).toBeDefined();
    expect(result.portionSizing?.term).toBe('media ración');
  });

  it('returns empty object when no term detected', () => {
    expect(enrichWithPortionSizing('pollo a la plancha')).toEqual({});
  });

  it('returns empty object for empty query', () => {
    expect(enrichWithPortionSizing('')).toEqual({});
  });
});
