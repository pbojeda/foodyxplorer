// MenuDishList — scrollable list of dishes from a multi-dish menu photo analysis.
// F-WEB-MENU-VISION-001: rendered in ResultsArea when dishCount > 1.
// Pure presentational — no 'use client' needed.

import type { MenuAnalysisDish } from '@foodxplorer/shared';
import { MenuDishItem } from './MenuDishItem';

type MenuDishListProps = {
  dishes: MenuAnalysisDish[];
  onDishSelect: (dishName: string) => void;
  partial?: boolean;
};

export function MenuDishList({ dishes, onDishSelect, partial = false }: MenuDishListProps) {
  const listWrapperClass =
    dishes.length > 6
      ? 'max-h-[420px] overflow-y-auto'
      : '';

  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-soft card-enter">
      {/* Header row */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/60">
        <span className="text-sm font-semibold text-slate-700">
          Se han encontrado {dishes.length} plato{dishes.length !== 1 ? 's' : ''}
        </span>
        {partial && (
          <span
            role="note"
            aria-label="Análisis parcial. Es posible que el menú tenga más platos."
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold px-2 py-0.5"
          >
            {/* Warning triangle icon — aria-hidden */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="text-amber-600"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Lista incompleta
          </span>
        )}
      </div>

      {/* Scrollable list of dishes */}
      <div
        role="list"
        aria-label={`Platos encontrados en el menú, ${dishes.length} resultados`}
        className={listWrapperClass}
      >
        {dishes.map((dish, index) => (
          <div key={`${dish.dishName}-${index}`} role="listitem">
            <MenuDishItem
              dish={dish}
              onSelect={() => onDishSelect(dish.dishName)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
