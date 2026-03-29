// F037 — contextDetector unit tests
// TDD: tests written BEFORE implementation

import { describe, it, expect } from 'vitest';
import { detectContextSet } from '../lib/contextDetector.js';

describe('detectContextSet', () => {
  it('"estoy en mcdonalds" → "mcdonalds"', () => {
    expect(detectContextSet('estoy en mcdonalds')).toBe('mcdonalds');
  });

  it('"estoy en el burger king de fuencarral" → "burger king de fuencarral"', () => {
    expect(detectContextSet('estoy en el burger king de fuencarral')).toBe('burger king de fuencarral');
  });

  it('"estoy en la casa" → "casa" (article stripped by optional group)', () => {
    expect(detectContextSet('estoy en la casa')).toBe('casa');
  });

  it('"estoy en los angeles" → "angeles" (los stripped by optional group)', () => {
    expect(detectContextSet('estoy en los angeles')).toBe('angeles');
  });

  it('"estoy en las ramblas" → "ramblas" (las stripped by optional group)', () => {
    expect(detectContextSet('estoy en las ramblas')).toBe('ramblas');
  });

  it('"estoy en mcdonalds, cuántas calorías" → null (comma present)', () => {
    expect(detectContextSet('estoy en mcdonalds, cuántas calorías')).toBeNull();
  });

  it('"¿estoy en mcdonalds?" → "mcdonalds" (leading ¿ and trailing ? stripped)', () => {
    expect(detectContextSet('¿estoy en mcdonalds?')).toBe('mcdonalds');
  });

  it('"" → null (empty string)', () => {
    expect(detectContextSet('')).toBeNull();
  });

  it('capture > 50 chars → null', () => {
    const longName = 'a'.repeat(51);
    expect(detectContextSet(`estoy en ${longName}`)).toBeNull();
  });

  it('"estoy aquí" → null (no match)', () => {
    expect(detectContextSet('estoy aquí')).toBeNull();
  });

  it('"ESTOY EN MCDONALDS" → "MCDONALDS" (case insensitive)', () => {
    expect(detectContextSet('ESTOY EN MCDONALDS')).toBe('MCDONALDS');
  });

  it('"estoy en mcdonalds." → "mcdonalds" (trailing period stripped)', () => {
    expect(detectContextSet('estoy en mcdonalds.')).toBe('mcdonalds');
  });

  it('"¡estoy en burger king!" → "burger king" (leading ¡ and trailing ! stripped)', () => {
    expect(detectContextSet('¡estoy en burger king!')).toBe('burger king');
  });

  it('capture exactly 50 chars → returns it (boundary)', () => {
    const name50 = 'a'.repeat(50);
    expect(detectContextSet(`estoy en ${name50}`)).toBe(name50);
  });

  it('"estoy en " (empty after en) → null', () => {
    expect(detectContextSet('estoy en ')).toBeNull();
  });
});
