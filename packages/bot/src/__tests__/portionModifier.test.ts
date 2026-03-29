// Unit tests for extractPortionModifier — pure function, no mocks needed.

import { describe, it, expect } from 'vitest';
import { extractPortionModifier } from '../lib/portionModifier.js';

describe('extractPortionModifier', () => {
  // --- Single-word modifiers ---

  it('"big mac grande" → cleanQuery: "big mac", multiplier: 1.5', () => {
    expect(extractPortionModifier('big mac grande')).toEqual({
      cleanQuery: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('"ensalada pequeña" → cleanQuery: "ensalada", multiplier: 0.7', () => {
    expect(extractPortionModifier('ensalada pequeña')).toEqual({
      cleanQuery: 'ensalada',
      portionMultiplier: 0.7,
    });
  });

  it('"tortilla doble" → cleanQuery: "tortilla", multiplier: 2.0', () => {
    expect(extractPortionModifier('tortilla doble')).toEqual({
      cleanQuery: 'tortilla',
      portionMultiplier: 2.0,
    });
  });

  it('"pizza xl" → cleanQuery: "pizza", multiplier: 1.5', () => {
    expect(extractPortionModifier('pizza xl')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 1.5,
    });
  });

  it('"sandwich triple" → cleanQuery: "sandwich", multiplier: 3.0', () => {
    expect(extractPortionModifier('sandwich triple')).toEqual({
      cleanQuery: 'sandwich',
      portionMultiplier: 3.0,
    });
  });

  // --- Multi-word patterns ---

  it('"media ración de pollo" → cleanQuery: "de pollo", multiplier: 0.5', () => {
    expect(extractPortionModifier('media ración de pollo')).toEqual({
      cleanQuery: 'de pollo',
      portionMultiplier: 0.5,
    });
  });

  it('"ración doble de arroz" → cleanQuery: "de arroz", multiplier: 2.0', () => {
    expect(extractPortionModifier('ración doble de arroz')).toEqual({
      cleanQuery: 'de arroz',
      portionMultiplier: 2.0,
    });
  });

  it('"extra grande pizza" → cleanQuery: "pizza", multiplier: 1.5', () => {
    expect(extractPortionModifier('extra grande pizza')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 1.5,
    });
  });

  it('"big mac extra-grande" → cleanQuery: "big mac", multiplier: 1.5 (hyphenated)', () => {
    expect(extractPortionModifier('big mac extra-grande')).toEqual({
      cleanQuery: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  // --- No modifier ---

  it('"big mac" (no modifier) → cleanQuery unchanged, multiplier: 1.0', () => {
    expect(extractPortionModifier('big mac')).toEqual({
      cleanQuery: 'big mac',
      portionMultiplier: 1.0,
    });
  });

  // --- Empty-after-strip fallback ---

  it('"grande" (only modifier → empty) → falls back to original text, multiplier: 1.0', () => {
    expect(extractPortionModifier('grande')).toEqual({
      cleanQuery: 'grande',
      portionMultiplier: 1.0,
    });
  });

  // --- First match wins ---

  it('"pizza grande doble" → "doble" pattern checked before "grande" → multiplier: 2.0', () => {
    expect(extractPortionModifier('pizza grande doble')).toEqual({
      cleanQuery: 'pizza grande',
      portionMultiplier: 2.0,
    });
  });

  // --- Case insensitive ---

  it('"BIG MAC GRANDE" → case-insensitive → multiplier: 1.5', () => {
    expect(extractPortionModifier('BIG MAC GRANDE')).toEqual({
      cleanQuery: 'BIG MAC',
      portionMultiplier: 1.5,
    });
  });

  // --- Modifier before chain slug ---

  it('"pizza XL en burger-king-es" → modifier stripped, chain slug preserved', () => {
    expect(extractPortionModifier('pizza XL en burger-king-es')).toEqual({
      cleanQuery: 'pizza en burger-king-es',
      portionMultiplier: 1.5,
    });
  });

  // --- Plural forms ---

  it('"pizza minis" → plural → multiplier: 0.7', () => {
    expect(extractPortionModifier('pizza minis')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 0.7,
    });
  });

  it('"hamburguesa pequeños" → plural masculine → multiplier: 0.7', () => {
    expect(extractPortionModifier('hamburguesa pequeños')).toEqual({
      cleanQuery: 'hamburguesa',
      portionMultiplier: 0.7,
    });
  });

  it('"half burger" → English form → multiplier: 0.5', () => {
    expect(extractPortionModifier('half burger')).toEqual({
      cleanQuery: 'burger',
      portionMultiplier: 0.5,
    });
  });

  it('"pizzas grandes" → plural → multiplier: 1.5', () => {
    expect(extractPortionModifier('pizzas grandes')).toEqual({
      cleanQuery: 'pizzas',
      portionMultiplier: 1.5,
    });
  });

  it('"raciones dobles de arroz" → plural multi-word → multiplier: 2.0', () => {
    expect(extractPortionModifier('raciones dobles de arroz')).toEqual({
      cleanQuery: 'de arroz',
      portionMultiplier: 2.0,
    });
  });

  it('"extra grandes pizza" → plural multi-word → multiplier: 1.5', () => {
    expect(extractPortionModifier('extra grandes pizza')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 1.5,
    });
  });

  it('"medias raciones de ensalada" → plural multi-word → multiplier: 0.5', () => {
    expect(extractPortionModifier('medias raciones de ensalada')).toEqual({
      cleanQuery: 'de ensalada',
      portionMultiplier: 0.5,
    });
  });

  // --- Word boundary enforcement ---

  it('"grandelarge" does NOT match "grande"', () => {
    expect(extractPortionModifier('grandelarge')).toEqual({
      cleanQuery: 'grandelarge',
      portionMultiplier: 1.0,
    });
  });

  // --- Accented variants without accent ---

  it('"racion doble de arroz" → accent-less variant → multiplier: 2.0', () => {
    expect(extractPortionModifier('racion doble de arroz')).toEqual({
      cleanQuery: 'de arroz',
      portionMultiplier: 2.0,
    });
  });

  it('"media racion de pollo" → accent-less variant → multiplier: 0.5', () => {
    expect(extractPortionModifier('media racion de pollo')).toEqual({
      cleanQuery: 'de pollo',
      portionMultiplier: 0.5,
    });
  });
});
