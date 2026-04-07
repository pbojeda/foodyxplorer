import { describe, it, expect } from 'vitest';
import { formatReverseSearch } from '../formatters/reverseSearchFormatter.js';
import type { ReverseSearchData } from '@foodxplorer/shared';

describe('formatReverseSearch', () => {
  const baseData: ReverseSearchData = {
    chainSlug: 'burger-king',
    chainName: 'Burger King',
    maxCalories: 600,
    minProtein: null,
    results: [
      {
        name: 'Grilled Chicken Salad',
        nameEs: 'Ensalada de Pollo a la Parrilla',
        calories: 350,
        proteins: 40,
        fats: 12,
        carbohydrates: 20,
        portionGrams: 200,
        proteinDensity: 11.43,
      },
      {
        name: 'Whopper Jr',
        nameEs: null,
        calories: 310,
        proteins: 16,
        fats: 18,
        carbohydrates: 27,
        portionGrams: 150,
        proteinDensity: 5.16,
      },
    ],
    totalMatches: 5,
  };

  it('formats results with numbered list and macros', () => {
    const output = formatReverseSearch(baseData);

    expect(output).toContain('Burger King');
    expect(output).toContain('600');
    expect(output).toContain('1\\.');
    expect(output).toContain('Ensalada de Pollo a la Parrilla');
    expect(output).toContain('350 kcal');
    expect(output).toContain('40 g prot');
    expect(output).toContain('2\\.');
    expect(output).toContain('Whopper Jr');
    expect(output).toContain('5 platos');
  });

  it('formats with protein constraint', () => {
    const data: ReverseSearchData = {
      ...baseData,
      minProtein: 30,
    };

    const output = formatReverseSearch(data);
    expect(output).toContain('30g');
  });

  it('handles empty results', () => {
    const data: ReverseSearchData = {
      ...baseData,
      results: [],
      totalMatches: 0,
    };

    const output = formatReverseSearch(data);
    expect(output).toContain('No encontré platos');
  });

  it('uses name when nameEs is null', () => {
    const data: ReverseSearchData = {
      ...baseData,
      results: [
        {
          name: 'Whopper Jr',
          nameEs: null,
          calories: 310,
          proteins: 16,
          fats: 18,
          carbohydrates: 27,
          portionGrams: 150,
          proteinDensity: 5.16,
        },
      ],
      totalMatches: 1,
    };

    const output = formatReverseSearch(data);
    expect(output).toContain('Whopper Jr');
  });

  it('formats no chain context error message', () => {
    const output = formatReverseSearch(null);
    expect(output).toContain('cadena');
  });
});
