// Tests for F089 — diners extraction from menu text

import { describe, it, expect } from 'vitest';
import { extractDiners } from '../conversation/dinersExtractor.js';

describe('extractDiners (F089)', () => {
  it('"para 3 personas" → diners=3, cleaned text', () => {
    const result = extractDiners('patatas bravas, croquetas, tortilla para 3 personas');
    expect(result.diners).toBe(3);
    expect(result.cleanedText).toBe('patatas bravas, croquetas, tortilla');
  });

  it('"para 2 comensales" → diners=2', () => {
    const result = extractDiners('menú tapas para 2 comensales');
    expect(result.diners).toBe(2);
    expect(result.cleanedText).toBe('menú tapas');
  });

  it('"entre 4 personas" → diners=4', () => {
    const result = extractDiners('bravas y croquetas entre 4 personas');
    expect(result.diners).toBe(4);
    expect(result.cleanedText).toBe('bravas y croquetas');
  });

  it('"compartir entre 5" → diners=5', () => {
    const result = extractDiners('menú tapas para compartir entre 5');
    expect(result.diners).toBe(5);
    expect(result.cleanedText).toBe('menú tapas');
  });

  it('"para 1 persona" → diners=1', () => {
    const result = extractDiners('tapas para 1 persona');
    expect(result.diners).toBe(1);
    expect(result.cleanedText).toBe('tapas');
  });

  it('"para 20 personas" → diners=20 (max)', () => {
    const result = extractDiners('tapas para 20 personas');
    expect(result.diners).toBe(20);
  });

  it('"para 25 personas" → capped at 20', () => {
    const result = extractDiners('tapas para 25 personas');
    expect(result.diners).toBe(20);
  });

  it('no diners phrase → undefined, text unchanged', () => {
    const result = extractDiners('patatas bravas, croquetas');
    expect(result.diners).toBeUndefined();
    expect(result.cleanedText).toBe('patatas bravas, croquetas');
  });

  it('"para 0 personas" → ignored', () => {
    const result = extractDiners('tapas para 0 personas');
    expect(result.diners).toBeUndefined();
    expect(result.cleanedText).toBe('tapas para 0 personas');
  });

  it('"para 3 gente" → diners=3', () => {
    const result = extractDiners('menú bravas y tortilla para 3 gente');
    expect(result.diners).toBe(3);
    expect(result.cleanedText).toBe('menú bravas y tortilla');
  });

  it('"3 personas" at end → diners=3', () => {
    const result = extractDiners('croquetas y bravas 3 personas');
    expect(result.diners).toBe(3);
    expect(result.cleanedText).toBe('croquetas y bravas');
  });

  it('phrase at start → cleaned correctly', () => {
    const result = extractDiners('para 4 personas patatas bravas y croquetas');
    expect(result.diners).toBe(4);
    expect(result.cleanedText).toBe('patatas bravas y croquetas');
  });
});
