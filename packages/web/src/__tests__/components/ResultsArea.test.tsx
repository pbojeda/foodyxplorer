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

    it('CardGrid region exposes aria-live=polite and aria-atomic=false for screen-reader updates (F091)', () => {
      const results = createConversationMessageData('estimation');
      render(<ResultsArea isLoading={false} results={results} onRetry={() => {}} error={null} />);
      const region = screen.getByRole('region', { name: /Resultados de la consulta/i });
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'false');
    });
  });

  describe('voice error variants (F091)', () => {
    it('renders persistent ErrorState with budget-cap copy when voiceError="budget_cap"', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          voiceError="budget_cap"
        />,
      );
      expect(screen.getByText(/temporalmente desactivada este mes/i)).toBeInTheDocument();
    });

    it('renders persistent ErrorState with rate-limit copy when voiceError="rate_limit"', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          voiceError="rate_limit"
        />,
      );
      expect(screen.getByText(/límite de búsquedas por voz por hoy/i)).toBeInTheDocument();
    });

    it('renders persistent ErrorState with IP-limit copy when voiceError="ip_limit"', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          voiceError="ip_limit"
        />,
      );
      expect(screen.getByText(/límite diario de voz desde esta red/i)).toBeInTheDocument();
    });

    it('invokes onVoiceRetry when the retry button is tapped on a recoverable voice error', () => {
      const onVoiceRetry = jest.fn();
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          voiceError="network"
          onVoiceRetry={onVoiceRetry}
        />,
      );
      const retryBtn = screen.getByRole('button', { name: /Intentar de nuevo/i });
      retryBtn.click();
      expect(onVoiceRetry).toHaveBeenCalledTimes(1);
    });

    it('ignores transient voiceError codes — they stay in the overlay (not in ResultsArea)', () => {
      const results = createConversationMessageData('estimation');
      render(
        <ResultsArea
          isLoading={false}
          results={results}
          onRetry={() => {}}
          error={null}
          voiceError="mic_permission"
        />,
      );
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
      expect(screen.queryByText(/temporalmente desactivada/i)).not.toBeInTheDocument();
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

    // F-WEB-MENU-VISION-001: multi-dish branch
    it('renders MenuDishList when photoResults.dishCount > 1', () => {
      const dish1 = createMenuAnalysisDish({ dishName: 'Paella valenciana', estimate: null });
      const dish2 = createMenuAnalysisDish({ dishName: 'Fideuà', estimate: null });
      const photoResults = createMenuAnalysisData({
        mode: 'auto',
        dishCount: 2,
        dishes: [dish1, dish2],
        partial: false,
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

      expect(screen.getByText('Se han encontrado 2 platos')).toBeInTheDocument();
    });

    it('renders existing CardGrid/NutritionCard path when photoResults.dishCount === 1', () => {
      const photoResults = createMenuAnalysisData({
        mode: 'identify',
        dishCount: 1,
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

      // NutritionCard renders dish name; MenuDishList header should NOT be present
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
      expect(screen.queryByText(/Se han encontrado/)).not.toBeInTheDocument();
    });

    it('calls onDishSelect with dishName when a dish row is clicked in MenuDishList', async () => {
      const onDishSelect = jest.fn();
      const dish1 = createMenuAnalysisDish({ dishName: 'Paella valenciana', estimate: null });
      const dish2 = createMenuAnalysisDish({ dishName: 'Fideuà', estimate: null });
      const photoResults = createMenuAnalysisData({
        mode: 'auto',
        dishCount: 2,
        dishes: [dish1, dish2],
      });

      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          photoResults={photoResults}
          onDishSelect={onDishSelect}
        />
      );

      // Click on the first dish button
      const dishBtn = screen.getByRole('button', { name: /Paella valenciana/i });
      dishBtn.click();

      expect(onDishSelect).toHaveBeenCalledWith('Paella valenciana');
    });
  });

  describe('loading states (F-WEB-MENU-VISION-001)', () => {
    it('renders single shimmer bar with "Analizando el menú..." when isPhotoLoading=true and photoAnalysisMode="auto"', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          isPhotoLoading={true}
          photoAnalysisMode="auto"
        />
      );

      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Analizando el menú...');
      expect(screen.queryAllByTestId('skeleton-card')).toHaveLength(0);
    });

    it('renders two SkeletonCard when isPhotoLoading=true and photoAnalysisMode="identify"', () => {
      render(
        <ResultsArea
          isLoading={false}
          results={null}
          onRetry={() => {}}
          error={null}
          isPhotoLoading={true}
          photoAnalysisMode="identify"
        />
      );

      expect(screen.getAllByTestId('skeleton-card')).toHaveLength(2);
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
