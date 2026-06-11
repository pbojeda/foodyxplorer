'use client';

// ResultBody — extracted from TranscriptEntry.tsx for reuse in admin panel.
// F-ADMIN-ANALYTICS-UI: Plan F4 (Path a extraction).
//
// Renders the result body for a settled conversation entry.
// Handles the 8 ConversationIntent shapes — the same switch block previously
// internal to TranscriptEntry's ResultBody function.
//
// Props:
//   data: ConversationMessageData (or AdminResultData — actorId optional)
//   onDishSelect?: (dishName: string) => void — passed to MenuDishList
//
// Does NOT handle entry.error, entry.isLoading, or entry.photoData branches —
// those belong to the TranscriptEntry shell and remain there.

import type { ConversationMessageData } from '@foodxplorer/shared';
import { NutritionCard } from './NutritionCard';
import { ContextConfirmation } from './ContextConfirmation';
import { MenuDishList } from './MenuDishList';

export interface ResultBodyProps {
  // Accept both ConversationMessageData (from TranscriptEntry) and AdminResultData
  // (which omits actorId). actorId is never used in result rendering.
  data: Omit<ConversationMessageData, 'actorId'>;
  onDishSelect?: (dishName: string) => void;
}

export function ResultBody({ data, onDishSelect }: ResultBodyProps): React.ReactElement | null {
  switch (data.intent) {
    case 'estimation': {
      const estimation = data.estimation;
      if (!estimation) return null;
      return <NutritionCard estimateData={estimation} />;
    }

    case 'comparison': {
      const comparison = data.comparison;
      if (!comparison) return null;
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <NutritionCard estimateData={comparison.dishA} />
          <NutritionCard estimateData={comparison.dishB} />
        </div>
      );
    }

    case 'menu_estimation': {
      const menu = data.menuEstimation;
      if (!menu) return null;
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {menu.items.map((item, index) => (
            <NutritionCard key={`${item.query}-${index}`} estimateData={item.estimation} />
          ))}
        </div>
      );
    }

    case 'context_set': {
      return (
        <ContextConfirmation
          contextSet={data.contextSet}
          ambiguous={data.ambiguous === true}
        />
      );
    }

    case 'reverse_search': {
      const reverseSearch = data.reverseSearch;
      if (!reverseSearch || reverseSearch.results.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center px-4 py-6 text-center">
            <p className="text-[15px] font-medium text-slate-500">
              No encontré platos con esas características.
            </p>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {reverseSearch.results.map((result, index) => (
            <NutritionCard key={`${result.name}-${index}`} reverseResult={result} />
          ))}
        </div>
      );
    }

    case 'follow_up_attribute': {
      const attr = data.followUpAttribute;
      if (!attr) return null;
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div
            data-testid="nutrient-answer-banner"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
              {attr.dishName}
            </p>
            <p className="mt-1 text-2xl font-extrabold leading-none text-amber-800">
              {attr.nutrientLabel}:{' '}
              <span className="text-brand-orange">{attr.value}</span>{' '}
              <span className="text-sm font-semibold">{attr.unit}</span>
            </p>
          </div>
          <NutritionCard estimateData={attr.priorEstimation} />
        </div>
      );
    }

    case 'follow_up_refinement': {
      const ref = data.followUpRefinement;
      if (!ref) return null;
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <p className="px-1 text-[12px] text-slate-400">
            <span className="font-semibold text-slate-500">Refinado:</span> {ref.mergedQuery}
          </p>
          <NutritionCard estimateData={ref.estimation} />
        </div>
      );
    }

    case 'text_too_long':
      return null;

    default:
      return null;
  }

  // onDishSelect is forwarded to MenuDishList if needed in future.
  // Currently menu_estimation renders NutritionCards directly.
  // The MenuDishList import is kept for completeness (used for photo mode in TranscriptEntry).
  void onDishSelect;
}
