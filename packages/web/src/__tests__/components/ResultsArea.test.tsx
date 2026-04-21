import React from 'react';
import { render, screen } from '@testing-library/react';
import { ResultsArea } from '../../components/ResultsArea';
import {
  createConversationMessageData,
  createEstimateData,
  createEstimateResult,
  createReverseSearchResult,
  createMenuAnalysisData,
  createMenuAnalysisDish,
} from '../fixtures';

describe('ResultsArea', () => {
  describe('empty/loading states', () => {
    it('renders EmptyState when isLoading=false and results=null', () => {
      render(<ResultsArea isLoading={false} results={null} onRetry={() => {}} error={null} />);
      expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
    });

    it('renders LoadingState when isLoading=true', () => {
      render(<ResultsArea isLoading={true} results={null} onRetry={() => {}} error={null} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders ErrorState when error is set', () => {
      render(<ResultsArea isLoading={false} results={null} onRetry={() => {}} error="Sin conexión." />);
      expect(screen.getByText('Sin conexión.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
    });

    it('CardGrid region exposes aria-live=polite for screen-reader updates (F091)', () => {
      const results = createConversationMessageData('estimation');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      const region = screen.getByRole('region', { name: /Resultados de la consulta/i });
      expect(region).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('estimation intent', () => {
    it('renders one NutritionCard for estimation', () => {
      const results = createConversationMessageData('estimation');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    it('renders no-match message when estimation result is null', () => {
      const results = createConversationMessageData('estimation', {
        estimation: createEstimateData({ result: null, matchType: null }),
      });
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText(/No encontré información nutricional/i)).toBeInTheDocument();
    });
  });

  describe('comparison intent', () => {
    it('renders two NutritionCards for comparison', () => {
      const results = createConversationMessageData('comparison');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
      expect(screen.getByText('Whopper')).toBeInTheDocument();
    });

    it('renders no-match for null dishA result', () => {
      const results = createConversationMessageData('comparison', {
        comparison: {
          dishA: createEstimateData({ result: null, matchType: null }),
          dishB: createEstimateData({ query: 'whopper', result: createEstimateResult({ name: 'Whopper', nameEs: 'Whopper' }) }),
        },
      });
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText(/No encontré información nutricional/i)).toBeInTheDocument();
      expect(screen.getByText('Whopper')).toBeInTheDocument();
    });
  });

  describe('menu_estimation intent', () => {
    it('renders one NutritionCard per item', () => {
      const results = createConversationMessageData('menu_estimation');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      // Two items from fixture
      const bigMacCards = screen.getAllByText('Big Mac');
      expect(bigMacCards.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('context_set intent', () => {
    it('renders ContextConfirmation for context_set', () => {
      const results = createConversationMessageData('context_set');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText(/Contexto activo:/i)).toBeInTheDocument();
    });

    it('renders ambiguity message when ambiguous is true', () => {
      const results = createConversationMessageData('context_set', {
        contextSet: undefined,
        ambiguous: true,
      });
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText(/No encontré ese restaurante/i)).toBeInTheDocument();
    });
  });

  describe('reverse_search intent', () => {
    it('renders cards from reverseSearch.results', () => {
      const results = createConversationMessageData('reverse_search');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText('Ensalada César')).toBeInTheDocument();
    });

    it('shows empty state message when reverseSearch has no results', () => {
      const results = createConversationMessageData('reverse_search', {
        reverseSearch: {
          chainSlug: 'mcdonalds-es',
          chainName: "McDonald's España",
          maxCalories: 600,
          minProtein: null,
          results: [],
          totalMatches: 0,
        },
      });
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      expect(screen.getByText(/No encontré platos con esas características/i)).toBeInTheDocument();
    });
  });

  describe('photo loading and results (F092)', () => {
    it('renders LoadingState when isPhotoLoading=true', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          isPhotoLoading={true}
        />
      );
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders NutritionCard for each dish in photoResults with estimate', () => {
      const photoResults = createMenuAnalysisData({
        dishes: [
          createMenuAnalysisDish({
            dishName: 'Big Mac',
            estimate: createEstimateData({ query: 'big mac' }),
          }),
        ],
      });
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          photoResults={photoResults}
        />
      );
      // NutritionCard renders the dish name from estimateData.result.name
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    it('renders "not found" card when dish.estimate is null', () => {
      const photoResults = createMenuAnalysisData({
        dishes: [
          createMenuAnalysisDish({
            dishName: 'Plato desconocido',
            estimate: null,
          }),
        ],
      });
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          photoResults={photoResults}
        />
      );
      expect(screen.getByText('Plato desconocido')).toBeInTheDocument();
      expect(screen.getByText('Sin datos nutricionales disponibles.')).toBeInTheDocument();
    });

    it('renders EmptyState when photoResults is null and isPhotoLoading is false', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          photoResults={null}
        />
      );
      expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
    });
  });

  describe('text_too_long intent', () => {
    it('does not render ErrorState for text_too_long (inline only)', () => {
      const results = createConversationMessageData('text_too_long');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      // text_too_long shows EmptyState (no ErrorState — error is inline in ConversationInput)
      expect(screen.queryByRole('button', { name: /Intentar de nuevo/i })).not.toBeInTheDocument();
    });
  });
});
