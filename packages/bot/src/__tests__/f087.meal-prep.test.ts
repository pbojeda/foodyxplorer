// Tests for F087 — "El Tupper" Meal Prep
//
// Tests: tupper detection + extraction, formatter with perPortion

import { describe, it, expect } from 'vitest';
import { extractPortions } from '../commands/tupperExtractor.js';

// ---------------------------------------------------------------------------
// extractPortions
// ---------------------------------------------------------------------------

describe('extractPortions (F087)', () => {
  it('"dividir en 5 tuppers" → portions=5, cleaned text', () => {
    const result = extractPortions('200g arroz, 300g pollo dividir en 5 tuppers');
    expect(result.portions).toBe(5);
    expect(result.cleanedText).toBe('200g arroz, 300g pollo');
  });

  it('"para 3 tuppers" → portions=3', () => {
    const result = extractPortions('1kg lentejas para 3 tuppers');
    expect(result.portions).toBe(3);
    expect(result.cleanedText).toBe('1kg lentejas');
  });

  it('"dividir en 10 porciones" → portions=10', () => {
    const result = extractPortions('500g pasta dividir en 10 porciones');
    expect(result.portions).toBe(10);
    expect(result.cleanedText).toBe('500g pasta');
  });

  it('"5 raciones" → portions=5', () => {
    const result = extractPortions('2kg arroz con pollo para 5 raciones');
    expect(result.portions).toBe(5);
    expect(result.cleanedText).toBe('2kg arroz con pollo');
  });

  it('"dividir en 4 partes" → portions=4', () => {
    const result = extractPortions('1kg potaje dividir en 4 partes');
    expect(result.portions).toBe(4);
    expect(result.cleanedText).toBe('1kg potaje');
  });

  it('no tupper phrase → portions undefined, text unchanged', () => {
    const result = extractPortions('200g arroz, 300g pollo');
    expect(result.portions).toBeUndefined();
    expect(result.cleanedText).toBe('200g arroz, 300g pollo');
  });

  it('phrase at start → cleaned correctly', () => {
    const result = extractPortions('para 6 tuppers 1kg lentejas');
    expect(result.portions).toBe(6);
    expect(result.cleanedText).toBe('1kg lentejas');
  });

  it('phrase with extra spaces → cleaned correctly', () => {
    const result = extractPortions('200g arroz   dividir en   5   tuppers  ');
    expect(result.portions).toBe(5);
    expect(result.cleanedText.trim()).toBe('200g arroz');
  });

  it('"repartir en 3 tuppers" → portions=3', () => {
    const result = extractPortions('500g carne repartir en 3 tuppers');
    expect(result.portions).toBe(3);
    expect(result.cleanedText).toBe('500g carne');
  });

  it('portions > 50 → capped at 50', () => {
    const result = extractPortions('200g arroz dividir en 100 tuppers');
    expect(result.portions).toBe(50);
  });

  it('portions = 0 → ignored (no portions)', () => {
    const result = extractPortions('200g arroz dividir en 0 tuppers');
    expect(result.portions).toBeUndefined();
    expect(result.cleanedText).toBe('200g arroz dividir en 0 tuppers');
  });
});

