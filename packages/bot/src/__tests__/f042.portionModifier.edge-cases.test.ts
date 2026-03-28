// F042 QA Edge Cases — extractPortionModifier
//
// Focuses on gaps NOT covered by portionModifier.test.ts:
//  - Standalone plural forms listed in the spec pattern table
//  - Modifier at the START of a phrase
//  - Modifier in the MIDDLE of a multi-word phrase
//  - 'peque' standalone (spec lists it explicitly)
//  - Whitespace-only / empty-ish input
//  - First-match-wins when 'grande' precedes a higher-priority 'doble'

import { describe, it, expect } from 'vitest';
import { extractPortionModifier } from '../lib/portionModifier.js';

describe('extractPortionModifier — F042 edge cases', () => {
  // -------------------------------------------------------------------------
  // Standalone plural forms (spec table, not in original tests)
  // -------------------------------------------------------------------------

  it('"pizza medias" → standalone "medias" → multiplier: 0.5', () => {
    // 'medias' without 'raciones' falls through to the medias? catch-all
    expect(extractPortionModifier('pizza medias')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 0.5,
    });
  });

  it('"pizzas medios" → standalone "medios" → multiplier: 0.5', () => {
    // 'medios' is listed in the spec pattern table
    expect(extractPortionModifier('pizzas medios')).toEqual({
      cleanQuery: 'pizzas',
      portionMultiplier: 0.5,
    });
  });

  it('"tacos dobles" → standalone "dobles" plural → multiplier: 2.0', () => {
    expect(extractPortionModifier('tacos dobles')).toEqual({
      cleanQuery: 'tacos',
      portionMultiplier: 2.0,
    });
  });

  it('"nachos triples" → standalone "triples" plural → multiplier: 3.0', () => {
    expect(extractPortionModifier('nachos triples')).toEqual({
      cleanQuery: 'nachos',
      portionMultiplier: 3.0,
    });
  });

  // -------------------------------------------------------------------------
  // 'peque' standalone (spec lists it explicitly as a colloquial abbreviation)
  // -------------------------------------------------------------------------

  it('"ración peque" → "peque" standalone → multiplier: 0.7', () => {
    expect(extractPortionModifier('ración peque')).toEqual({
      cleanQuery: 'ración',
      portionMultiplier: 0.7,
    });
  });

  it('"pizza peque" → cleanQuery: "pizza", multiplier: 0.7', () => {
    expect(extractPortionModifier('pizza peque')).toEqual({
      cleanQuery: 'pizza',
      portionMultiplier: 0.7,
    });
  });

  // -------------------------------------------------------------------------
  // Modifier at the START of the query
  // -------------------------------------------------------------------------

  it('"grande big mac" → modifier at start → cleanQuery: "big mac", multiplier: 1.5', () => {
    expect(extractPortionModifier('grande big mac')).toEqual({
      cleanQuery: 'big mac',
      portionMultiplier: 1.5,
    });
  });

  it('"triple sandwich de pollo" → modifier at start → cleanQuery: "sandwich de pollo", multiplier: 3.0', () => {
    expect(extractPortionModifier('triple sandwich de pollo')).toEqual({
      cleanQuery: 'sandwich de pollo',
      portionMultiplier: 3.0,
    });
  });

  // -------------------------------------------------------------------------
  // Modifier in the MIDDLE of a multi-word phrase
  // -------------------------------------------------------------------------

  it('"menú grande del día" → modifier in middle → cleanQuery: "menú del día", multiplier: 1.5', () => {
    expect(extractPortionModifier('menú grande del día')).toEqual({
      cleanQuery: 'menú del día',
      portionMultiplier: 1.5,
    });
  });

  it('"café mini con leche" → modifier in middle → cleanQuery: "café con leche", multiplier: 0.7', () => {
    expect(extractPortionModifier('café mini con leche')).toEqual({
      cleanQuery: 'café con leche',
      portionMultiplier: 0.7,
    });
  });

  // -------------------------------------------------------------------------
  // First-match-wins: 'grande' before 'doble' — 'dobles?' pattern checked first
  // -------------------------------------------------------------------------

  it('"grande pizza doble" → "dobles?" pattern wins over "grandes?" → multiplier: 2.0', () => {
    // 'dobles?' is pattern index 6, 'grandes?' is pattern index 7.
    // First-match is 'doble', so cleanQuery keeps 'grande pizza'.
    expect(extractPortionModifier('grande pizza doble')).toEqual({
      cleanQuery: 'grande pizza',
      portionMultiplier: 2.0,
    });
  });

  // -------------------------------------------------------------------------
  // Whitespace-only input — treated like empty, returns original unchanged
  // -------------------------------------------------------------------------

  it('"   " (whitespace only) → fallback: cleanQuery "   ", multiplier: 1.0', () => {
    // No modifier pattern matches a whitespace-only string.
    expect(extractPortionModifier('   ')).toEqual({
      cleanQuery: '   ',
      portionMultiplier: 1.0,
    });
  });

  // -------------------------------------------------------------------------
  // Modifier-only input with whitespace (empty after strip → fallback)
  // -------------------------------------------------------------------------

  it('"  grande  " (padded modifier) → stripping "grande" leaves whitespace → fallback', () => {
    // After replace and trim: '' → empty → fallback to original.
    expect(extractPortionModifier('  grande  ')).toEqual({
      cleanQuery: '  grande  ',
      portionMultiplier: 1.0,
    });
  });

  // -------------------------------------------------------------------------
  // Spec note: 'medio' singular (not covered in original tests)
  // -------------------------------------------------------------------------

  it('"medio pollo asado" → "medio" singular → multiplier: 0.5', () => {
    expect(extractPortionModifier('medio pollo asado')).toEqual({
      cleanQuery: 'pollo asado',
      portionMultiplier: 0.5,
    });
  });

  // -------------------------------------------------------------------------
  // Regression: 'medias raciones' multi-word pattern still wins over standalone 'medias'
  // -------------------------------------------------------------------------

  it('"medias raciones de patatas" → multi-word pattern → multiplier: 0.5, cleanQuery: "de patatas"', () => {
    // The multi-word pattern /\bmedias\s+raciones\b/ is checked BEFORE /\bmedias?\b/.
    expect(extractPortionModifier('medias raciones de patatas')).toEqual({
      cleanQuery: 'de patatas',
      portionMultiplier: 0.5,
    });
  });

  // -------------------------------------------------------------------------
  // Word boundary: modifier substring NOT matched inside compound words
  // -------------------------------------------------------------------------

  it('"grandelarge" — "grande" substring → no match (word boundary)', () => {
    // Existing test, kept here as regression anchor for edge-cases file.
    expect(extractPortionModifier('grandelarge')).toEqual({
      cleanQuery: 'grandelarge',
      portionMultiplier: 1.0,
    });
  });

  it('"multimedia café" — "media" inside compound word → no match', () => {
    // 'multimedia': 'm' before 'edia' is a word char → no \b before 'media'
    expect(extractPortionModifier('multimedia café')).toEqual({
      cleanQuery: 'multimedia café',
      portionMultiplier: 1.0,
    });
  });
});
