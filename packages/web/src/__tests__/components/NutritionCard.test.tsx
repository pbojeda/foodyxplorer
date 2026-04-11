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
});
