// ResultsArea — renders the correct state/component based on intent.
// Handles: loading, error, empty, all 6 intents.
// Pure presentational — no 'use client' needed.

import type { ConversationMessageData } from '@foodxplorer/shared';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { NutritionCard } from './NutritionCard';
import { ContextConfirmation } from './ContextConfirmation';

interface ResultsAreaProps {
  isLoading: boolean;
  results: ConversationMessageData | null;
  error: string | null;
  onRetry: () => void;
}

export function ResultsArea({ isLoading, results, error, onRetry }: ResultsAreaProps) {
  // Loading state takes priority
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
        <LoadingState />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 overflow-y-auto">
        <ErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }

  // No results yet (initial state) or text_too_long (inline error handled in shell)
  if (!results || results.intent === 'text_too_long') {
    return (
      <div className="flex flex-1 overflow-y-auto">
        <EmptyState />
      </div>
    );
  }

  // Intent-based rendering
  switch (results.intent) {
    case 'estimation': {
      const estimation = results.estimation;
      if (!estimation) return <EmptyStateWrapper />;
      return (
        <CardGrid>
          <NutritionCard estimateData={estimation} />
        </CardGrid>
      );
    }

    case 'comparison': {
      const comparison = results.comparison;
      if (!comparison) return <EmptyStateWrapper />;
      return (
        <CardGrid>
          <NutritionCard estimateData={comparison.dishA} />
          <NutritionCard estimateData={comparison.dishB} />
        </CardGrid>
      );
    }

    case 'menu_estimation': {
      const menu = results.menuEstimation;
      if (!menu) return <EmptyStateWrapper />;
      return (
        <CardGrid>
          {menu.items.map((item, index) => (
            <NutritionCard key={`${item.query}-${index}`} estimateData={item.estimation} />
          ))}
        </CardGrid>
      );
    }

    case 'context_set': {
      return (
        <div className="flex flex-1 overflow-y-auto">
          <ContextConfirmation
            contextSet={results.contextSet}
            ambiguous={results.ambiguous === true}
          />
        </div>
      );
    }

    case 'reverse_search': {
      const reverseSearch = results.reverseSearch;
      if (!reverseSearch || reverseSearch.results.length === 0) {
        return (
          <div className="flex flex-1 overflow-y-auto">
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <p className="text-[15px] font-medium text-slate-500">
                No encontré platos con esas características.
              </p>
            </div>
          </div>
        );
      }
      return (
        <CardGrid>
          {reverseSearch.results.map((result, index) => (
            <NutritionCard key={`${result.name}-${index}`} reverseResult={result} />
          ))}
        </CardGrid>
      );
    }

    default:
      return <EmptyStateWrapper />;
  }
}

// ---------------------------------------------------------------------------
// Internal layout helpers
// ---------------------------------------------------------------------------

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:mx-auto lg:max-w-2xl">
        {children}
      </div>
    </div>
  );
}

function EmptyStateWrapper() {
  return (
    <div className="flex flex-1 overflow-y-auto">
      <EmptyState />
    </div>
  );
}
