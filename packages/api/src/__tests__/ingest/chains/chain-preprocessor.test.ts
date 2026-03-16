// Chain text preprocessor unit tests.
// Tests preprocessChainText for each supported chain.

import { describe, it, expect } from 'vitest';
import { preprocessChainText } from '../../../ingest/chainTextPreprocessor.js';

describe('preprocessChainText', () => {
  describe('unknown chain — passthrough', () => {
    it('returns lines unchanged for unknown chainSlug', () => {
      const lines = ['header line', 'data line'];
      const result = preprocessChainText('unknown-chain', lines);
      expect(result).toEqual(lines);
    });
  });

  describe('subway-es — passthrough', () => {
    it('returns lines unchanged (standard EU table format, no preprocessing needed)', () => {
      const lines = [
        'Product',
        'Energy (kcal)',
        'Fat (g)',
        'Saturates (g)',
        'Carbohydrate (g)',
        'Sugars (g)',
        'Fibre (g)',
        'Protein (g)',
        'Salt (g)',
        'Italian B.M.T. 6" \t 302 \t 7.0 \t 2.5 \t 43.0 \t 6.0 \t 2.5 \t 18.0 \t 1.3',
      ];
      const result = preprocessChainText('subway-es', lines);
      expect(result).toEqual(lines);
    });

    it('returns empty array unchanged for empty input', () => {
      const result = preprocessChainText('subway-es', []);
      expect(result).toEqual([]);
    });
  });

  describe('burger-king-es', () => {
    const BK_LINES = [
      'Peso (g)',
      '/ Serving Size (g)',
      'Valor',
      'Energético (KJ)',
      '/ Calories',
      'Valor',
      'Energético (Kcal.)',
      '/ Calories',
      'Grasas (g)',
      '/ Total Fat (g)',
      'Grasas',
      'saturadas (g)',
      '/ Saturated Fat (g)',
      'Hidratos de Carbono (g)',
      '/ Carbohydrates (g)',
      'Azucares (g)',
      '/ Sugars (g)',
      'Fibra Alimentaria (g)',
      '/ Dietary Fiber (g)',
      'Proteínas (g)',
      '/ Protein (g)',
      'Sal (g)',
      '/ Salt (g)',
      'Sodio (mg)',
      '/ Sodium (mg)',
      'Hamburguesas / Hamburgers',
      'Whopper® \t289 \t2698 \t643 \t36,0 \t10,2 \t48,9 \t14,6 \t5,2 \t30,4 \t2,6 \t1066,6',
      'Big King® \t200 \t2195 \t525 \t27,3 \t9,0 \t42,9 \t7,5 \t1,8 \t25,7 \t2,3 \t943',
    ];

    it('injects synthetic header and strips weight + kJ columns', () => {
      const result = preprocessChainText('burger-king-es', BK_LINES);

      // Should have a synthetic header
      expect(result[0]).toContain('Calorías');
      expect(result[0]).toContain('Proteínas');

      // Whopper line should have 643 (kcal) as first value, not 289 (weight)
      const whopperLine = result.find((l) => l.includes('Whopper'));
      expect(whopperLine).toBeDefined();
      expect(whopperLine).toContain('643');
      expect(whopperLine).not.toMatch(/\t289\b/);
    });

    it('data rows have 9 values (kcal, fat, sat, carbs, sugars, fiber, protein, salt, sodium)', () => {
      const result = preprocessChainText('burger-king-es', BK_LINES);
      const dataLines = result.filter((l) => l.includes('Whopper') || l.includes('Big King'));
      expect(dataLines.length).toBeGreaterThanOrEqual(1);

      for (const line of dataLines) {
        const parts = line.split('\t');
        // name + 9 values = 10 parts
        expect(parts.length).toBe(10);
      }
    });
  });

  describe('kfc-es', () => {
    const KFC_LINES = [
      '100g Porción 100g Porción 100g Porción 100g Porción 100g Porción 100g Porción 100g Porción',
      'Actimel 75.00 75.00 2.70 2.70 1.50 1.50 1.00 1.00 11.80 11.80 0.00 0.00 0.15 0.15',
      'Chick&Share ( 9 tiras de pechuga CR) 240.00 864.00 19.00 68.40 8.40 30.24 0.88 3.17 12.90 46.44 0.00 0.002 1.66 5.98',
      'Bucket para 3 per.(9 piezas OR) 241.00 2103.93 20.00 174.60 14.00 122.22 4.00 34.92 9.00 78.57 1.00 <0,1 1.69 14.73',
    ];

    it('injects synthetic header and keeps only per-100g values', () => {
      const result = preprocessChainText('kfc-es', KFC_LINES);

      expect(result[0]).toContain('Calorías');
      expect(result[0]).toContain('Proteínas');

      // Actimel should have 7 values (per-100g only)
      const actimelLine = result.find((l) => l.includes('Actimel'));
      expect(actimelLine).toBeDefined();
      const actimelValues = actimelLine?.match(/\d+\.\d+/g);
      expect(actimelValues?.length).toBe(7);
    });

    it('removes digits from names containing quantities', () => {
      const result = preprocessChainText('kfc-es', KFC_LINES);

      // "Chick&Share ( 9 tiras ...)" should become "Chick&Share (tiras ...)"
      const chickLine = result.find((l) => l.includes('Chick&Share'));
      expect(chickLine).toBeDefined();
      expect(chickLine).not.toMatch(/\b9\b/); // no standalone "9" in name
      expect(chickLine).toContain('tiras de pechuga CR');
    });

    it('skips 100g/Porción header line', () => {
      const result = preprocessChainText('kfc-es', KFC_LINES);
      const has100g = result.some((l) => l.startsWith('100g'));
      expect(has100g).toBe(false);
    });

    it('handles <0,1 notation in paired data', () => {
      const result = preprocessChainText('kfc-es', KFC_LINES);
      // "Bucket para 3 per.(9 piezas OR)" has <0,1 as sugars-per-portion
      // After preprocessing: name cleaned, per-100g values kept
      const bucketLine = result.find((l) => l.includes('Bucket'));
      expect(bucketLine).toBeDefined();
    });
  });

  describe('telepizza-es', () => {
    const TP_LINES = [
      'Valores nutricionales por 100 g',
      'PIZZAS - ESPECIALIDADES',
      'Barbacoa \t897 / 213 \t7,9 \t5,1 \t25,3 \t3,7 \t8,4 \t1,6',
      'Hawaiana \t827 / 197 \t7,0 \t5,2 \t24,8 \t2,1 \t8,0 \t1,6',
    ];

    it('injects synthetic header and removes kJ from data rows', () => {
      const result = preprocessChainText('telepizza-es', TP_LINES);

      expect(result[0]).toBe('PIZZAS - ESPECIALIDADES');

      const headerLine = result.find((l) => l.includes('Calorías'));
      expect(headerLine).toBeDefined();

      // Barbacoa should have 213 (kcal) as first value, not 897 (kJ)
      const barbacoaLine = result.find((l) => l.includes('Barbacoa'));
      expect(barbacoaLine).toBeDefined();
      expect(barbacoaLine).toContain('213');
      expect(barbacoaLine).not.toContain('897');
    });

    it('skips meta lines (Valores nutricionales, Información nutricional)', () => {
      const result = preprocessChainText('telepizza-es', TP_LINES);
      const hasMeta = result.some((l) => l.toLowerCase().includes('valores nutricionales'));
      expect(hasMeta).toBe(false);
    });

    it('preserves category labels', () => {
      const result = preprocessChainText('telepizza-es', TP_LINES);
      const hasCategory = result.some((l) => l.includes('PIZZAS - ESPECIALIDADES'));
      expect(hasCategory).toBe(true);
    });
  });
});
