import { describe, it, expect } from 'vitest';
import { detectReverseSearch } from '../conversation/entityExtractor.js';

describe('detectReverseSearch', () => {
  // ---------------------------------------------------------------------------
  // Calorie-only patterns
  // ---------------------------------------------------------------------------

  it('detects "qué como con 600 kcal"', () => {
    expect(detectReverseSearch('qué como con 600 kcal')).toEqual({ maxCalories: 600 });
  });

  it('detects "que como con 600 kcal" (no accent)', () => {
    expect(detectReverseSearch('que como con 600 kcal')).toEqual({ maxCalories: 600 });
  });

  it('detects "qué pido con 500 kcal"', () => {
    expect(detectReverseSearch('qué pido con 500 kcal')).toEqual({ maxCalories: 500 });
  });

  it('detects "me quedan 400 kcal"', () => {
    expect(detectReverseSearch('me quedan 400 kcal')).toEqual({ maxCalories: 400 });
  });

  it('detects "me quedan 350 calorías"', () => {
    expect(detectReverseSearch('me quedan 350 calorías')).toEqual({ maxCalories: 350 });
  });

  it('detects "me quedan 350 calorias" (no accent)', () => {
    expect(detectReverseSearch('me quedan 350 calorias')).toEqual({ maxCalories: 350 });
  });

  it('detects "600 kcal qué pido"', () => {
    expect(detectReverseSearch('600 kcal qué pido')).toEqual({ maxCalories: 600 });
  });

  it('detects "500 calorías qué como"', () => {
    expect(detectReverseSearch('500 calorías qué como')).toEqual({ maxCalories: 500 });
  });

  it('detects "tengo 700 kcal"', () => {
    expect(detectReverseSearch('tengo 700 kcal')).toEqual({ maxCalories: 700 });
  });

  it('detects "con 600 kcal qué puedo comer"', () => {
    expect(detectReverseSearch('con 600 kcal qué puedo comer')).toEqual({ maxCalories: 600 });
  });

  // ---------------------------------------------------------------------------
  // With protein
  // ---------------------------------------------------------------------------

  it('detects calories + protein: "qué como con 600 kcal necesito 30g proteína"', () => {
    expect(detectReverseSearch('qué como con 600 kcal necesito 30g proteína')).toEqual({
      maxCalories: 600,
      minProtein: 30,
    });
  });

  it('detects protein: "me quedan 500 kcal mínimo 25g proteínas"', () => {
    expect(detectReverseSearch('me quedan 500 kcal mínimo 25g proteínas')).toEqual({
      maxCalories: 500,
      minProtein: 25,
    });
  });

  it('detects protein: "me quedan 500 kcal minimo 25g proteinas" (no accents)', () => {
    expect(detectReverseSearch('me quedan 500 kcal minimo 25g proteinas')).toEqual({
      maxCalories: 500,
      minProtein: 25,
    });
  });

  it('detects protein with "al menos": "me quedan 600 kcal al menos 20g proteína"', () => {
    expect(detectReverseSearch('me quedan 600 kcal al menos 20g proteína')).toEqual({
      maxCalories: 600,
      minProtein: 20,
    });
  });

  // ---------------------------------------------------------------------------
  // With Spanish punctuation
  // ---------------------------------------------------------------------------

  it('handles leading ¿ and trailing ?', () => {
    expect(detectReverseSearch('¿qué como con 600 kcal?')).toEqual({ maxCalories: 600 });
  });

  it('handles leading ¡ and trailing !', () => {
    expect(detectReverseSearch('¡me quedan 400 kcal!')).toEqual({ maxCalories: 400 });
  });

  // ---------------------------------------------------------------------------
  // Case insensitivity
  // ---------------------------------------------------------------------------

  it('is case insensitive', () => {
    expect(detectReverseSearch('QUÉ COMO CON 600 KCAL')).toEqual({ maxCalories: 600 });
  });

  // ---------------------------------------------------------------------------
  // Non-matching patterns
  // ---------------------------------------------------------------------------

  it('returns null for regular food query', () => {
    expect(detectReverseSearch('big mac')).toBeNull();
  });

  it('returns null for context-set intent', () => {
    expect(detectReverseSearch('estoy en mcdonalds')).toBeNull();
  });

  it('returns null for comparison query', () => {
    expect(detectReverseSearch('qué tiene más calorías big mac vs whopper')).toBeNull();
  });

  it('returns null when no number found', () => {
    expect(detectReverseSearch('qué como con muchas kcal')).toBeNull();
  });
});
