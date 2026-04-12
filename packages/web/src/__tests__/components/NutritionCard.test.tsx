import React from 'react';
import { render, screen } from '@testing-library/react';
import { NutritionCard } from '../../components/NutritionCard';
import { createEstimateData, createEstimateResult, createReverseSearchResult } from '../fixtures';

describe('NutritionCard', () => {
  describe('with EstimateData (standard estimation)', () => {
    it('renders the dish name', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    it('renders the aria-label including name and kcal', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      const article = screen.getByRole('article');
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('Big Mac'));
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('550'));
    });

    it('renders the kcal value', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('550')).toBeInTheDocument();
    });

    it('renders proteins value', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('25')).toBeInTheDocument();
    });

    it('renders carbohydrates value', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('46')).toBeInTheDocument();
    });

    it('renders fats value', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('28')).toBeInTheDocument();
    });

    it('renders ConfidenceBadge with correct level', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText('Verificado')).toBeInTheDocument();
    });

    it('renders allergen chips when allergens are present', () => {
      const data = createEstimateData({
        allergens: [
          { allergen: 'Gluten', keyword: 'pan' },
          { allergen: 'Sésamo', keyword: 'semillas' },
        ],
      });
      render(<NutritionCard estimateData={data} />);
      expect(screen.getByText(/Gluten/i)).toBeInTheDocument();
      expect(screen.getByText(/Sésamo/i)).toBeInTheDocument();
    });

    it('does NOT render allergen row when allergens array is empty', () => {
      const data = createEstimateData({ allergens: [] });
      render(<NutritionCard estimateData={data} />);
      expect(screen.queryByText('⚠')).not.toBeInTheDocument();
    });

    it('does NOT render allergen row when allergens is undefined', () => {
      const data = createEstimateData({ allergens: undefined });
      render(<NutritionCard estimateData={data} />);
      expect(screen.queryByText('⚠')).not.toBeInTheDocument();
    });

    it('renders source name in footer', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.getByText(/McDonald's España/i)).toBeInTheDocument();
    });
  });

  describe('with null result (no-match state)', () => {
    it('renders a no-match inline message', () => {
      const data = createEstimateData({ result: null, matchType: null });
      render(<NutritionCard estimateData={data} />);
      expect(screen.getByText(/No encontré información nutricional/i)).toBeInTheDocument();
    });

    it('includes the query in the no-match message', () => {
      const data = createEstimateData({ query: 'platillo desconocido', result: null, matchType: null });
      render(<NutritionCard estimateData={data} />);
      expect(screen.getByText(/platillo desconocido/i)).toBeInTheDocument();
    });
  });

  describe('with ReverseSearchResult', () => {
    it('renders the dish name', () => {
      render(<NutritionCard reverseResult={createReverseSearchResult()} />);
      expect(screen.getByText('Ensalada César')).toBeInTheDocument();
    });

    it('renders the kcal value', () => {
      render(<NutritionCard reverseResult={createReverseSearchResult()} />);
      expect(screen.getByText('350')).toBeInTheDocument();
    });

    it('does NOT render ConfidenceBadge for reverse search results', () => {
      render(<NutritionCard reverseResult={createReverseSearchResult()} />);
      expect(screen.queryByText('Verificado')).not.toBeInTheDocument();
      expect(screen.queryByText('Estimado')).not.toBeInTheDocument();
      expect(screen.queryByText('Aproximado')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // F-UX-A — Size modifier display
  // ---------------------------------------------------------------------------

  describe('F-UX-A — size modifier display', () => {
    function dataWithModifier(
      multiplier: number,
      {
        withBase = true,
      }: { withBase?: boolean } = {},
    ) {
      const result = createEstimateResult({
        nutrients: {
          calories: 825, // 550 * 1.5
          proteins: 37.5,
          carbohydrates: 69,
          sugars: 13.5,
          fats: 42,
          saturatedFats: 15,
          fiber: 4.5,
          salt: 3.3,
          sodium: 1.32,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_serving',
        },
        portionGrams: 300,
      });

      const override: Partial<import('@foodxplorer/shared').EstimateData> = {
        portionMultiplier: multiplier,
        result,
      };

      if (withBase) {
        override.baseNutrients = {
          calories: 550,
          proteins: 25,
          carbohydrates: 46,
          sugars: 9,
          fats: 28,
          saturatedFats: 10,
          fiber: 3,
          salt: 2.2,
          sodium: 0.88,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_serving',
        };
        override.basePortionGrams = 200;
      }

      return createEstimateData(override);
    }

    it('does NOT render the modifier pill when portionMultiplier is 1.0', () => {
      render(<NutritionCard estimateData={createEstimateData()} />);
      expect(screen.queryByText(/PORCIÓN/)).not.toBeInTheDocument();
      expect(screen.queryByText(/base:/)).not.toBeInTheDocument();
    });

    it('renders PORCIÓN GRANDE pill for multiplier 1.5', () => {
      render(<NutritionCard estimateData={dataWithModifier(1.5)} />);
      expect(screen.getByText('PORCIÓN GRANDE')).toBeInTheDocument();
    });

    it('renders PORCIÓN MEDIA pill for multiplier 0.5', () => {
      render(<NutritionCard estimateData={dataWithModifier(0.5, { withBase: false })} />);
      expect(screen.getByText('PORCIÓN MEDIA')).toBeInTheDocument();
    });

    it('renders PORCIÓN ×2.5 pill for unmapped multiplier (unified prefix)', () => {
      render(<NutritionCard estimateData={dataWithModifier(2.5, { withBase: false })} />);
      // M2 review fix: unmapped labels also get the PORCIÓN prefix so the
      // pill vocabulary is visually consistent between mapped and fallback.
      expect(screen.getByText('PORCIÓN ×2.5')).toBeInTheDocument();
    });

    it('renders the base: N kcal subtitle when baseNutrients is present', () => {
      render(<NutritionCard estimateData={dataWithModifier(1.5)} />);
      expect(screen.getByText('base: 550 kcal')).toBeInTheDocument();
    });

    it('does NOT render the base subtitle when baseNutrients is absent (graceful degradation)', () => {
      render(<NutritionCard estimateData={dataWithModifier(1.5, { withBase: false })} />);
      expect(screen.getByText('PORCIÓN GRANDE')).toBeInTheDocument();
      expect(screen.queryByText(/base:/)).not.toBeInTheDocument();
    });

    it('includes the modifier and base in the aria-label', () => {
      render(<NutritionCard estimateData={dataWithModifier(1.5)} />);
      const article = screen.getByRole('article');
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('grande'));
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('550'));
    });

    it('aria-label omits base when baseNutrients is absent', () => {
      render(<NutritionCard estimateData={dataWithModifier(1.5, { withBase: false })} />);
      const article = screen.getByRole('article');
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('grande'));
      // Without base, the aria-label still mentions the modifier but not "base"
      expect(article.getAttribute('aria-label')).not.toMatch(/base/);
    });
  });
});
