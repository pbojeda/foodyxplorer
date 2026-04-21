// ResultsArea — renders the correct state/component based on intent.
// Handles: loading, error, empty, all 6 intents, and photo results (F092).
// Pure presentational — no 'use client' needed.

import type { ConversationMessageData, MenuAnalysisData } from '@foodxplorer/shared';
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
  isPhotoLoading?: boolean;
  photoResults?: MenuAnalysisData | null;
}

export function ResultsArea({
  isLoading,
  results,
  error,
  onRetry,
  isPhotoLoading = false,
  photoResults = null,
}: ResultsAreaProps) {
  // Loading state takes priority (text or photo)
  if (isLoading || isPhotoLoading) {
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

  // Photo results (F092) — render NutritionCard per dish identified from photo
  if (photoResults) {
    return (
      <CardGrid>
        {photoResults.dishes.map((dish, index) => {
          if (dish.estimate !== null) {
            return (
              <NutritionCard
                key={`${dish.dishName}-${index}`}
                estimateData={dish.estimate}
              />
            );
          }
          // Null estimate — dish identified but no nutritional data found
          return (
            <article
              key={`${dish.dishName}-${index}`}
              className="rounded-2xl border border-slate-100 bg-white p-4 shadow-soft"
            >
              <h2 className="text-base font-semibold text-slate-700">{dish.dishName}</h2>
              <p className="mt-1 text-sm text-slate-500">Sin datos nutricionales disponibles.</p>
            </article>
          );
        })}
      </CardGrid>
    );
  }

  // No results yet (initial state).
  // text_too_long is handled exclusively by HablarShell (inline error, sets results=null).
  // The guard below is a defensive safety net — it should never be reached in practice.
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
  // role="region" + aria-live="polite" — results update in place (voice/photo/text).
  // Not role="status" to avoid colliding with LoadingState's role="status".
  return (
    <div
      className="flex-1 overflow-y-auto px-4 pb-24 pt-4"
      role="region"
      aria-live="polite"
      aria-label="Resultados de la consulta"
    >
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
