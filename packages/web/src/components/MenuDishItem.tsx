// MenuDishItem — single row in the MenuDishList.
// F-WEB-MENU-VISION-001: part of multi-dish menu photo analysis results.
// Pure presentational — no 'use client' needed.

import type { MenuAnalysisDish } from '@foodxplorer/shared';

type MenuDishItemProps = {
  dish: MenuAnalysisDish;
  onSelect: () => void;
};

export function MenuDishItem({ dish, onSelect }: MenuDishItemProps) {
  const kcal =
    dish.estimate?.result?.nutrients.calories != null
      ? Math.round(dish.estimate.result.nutrients.calories)
      : null;

  const ariaLabel =
    kcal !== null
      ? `${dish.dishName}, ${kcal} kcal — ver información nutricional`
      : `${dish.dishName}, sin datos de calorías — ver información nutricional`;

  return (
    <button
      type="button"
      className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 w-full text-left cursor-pointer active:bg-slate-50 transition-colors duration-100 min-h-[56px]"
      onClick={onSelect}
      aria-label={ariaLabel}
    >
      <span className="text-base font-semibold text-slate-800 flex-1 leading-snug">
        {dish.dishName}
      </span>
      {kcal !== null ? (
        <span className="text-sm font-medium text-slate-500 whitespace-nowrap">
          {kcal} kcal
        </span>
      ) : (
        <span className="text-sm italic text-slate-400 whitespace-nowrap">
          Sin datos
        </span>
      )}
      <span className="text-slate-300 flex-shrink-0 ml-2" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
