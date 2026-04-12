// NutritionCard — primary result unit for nutriXplorer.
// Renders a dish's nutritional information in a styled card.
// Accepts either EstimateData (standard) or ReverseSearchResult (filter results).
// Pure presentational — no 'use client' needed.

import type { EstimateData, ReverseSearchResult } from '@foodxplorer/shared';
import { formatPortionLabel } from '@foodxplorer/shared';
import { ConfidenceBadge } from './ConfidenceBadge';
import { AllergenChip } from './AllergenChip';

interface NutritionCardEstimateProps {
  estimateData: EstimateData;
  reverseResult?: never;
}

interface NutritionCardReverseProps {
  reverseResult: ReverseSearchResult;
  estimateData?: never;
}

type NutritionCardProps = NutritionCardEstimateProps | NutritionCardReverseProps;

export function NutritionCard({ estimateData, reverseResult }: NutritionCardProps) {
  // ReverseSearchResult rendering — simplified card (no badge, no source)
  if (reverseResult) {
    const displayName = reverseResult.nameEs ?? reverseResult.name;
    const kcal = Math.round(reverseResult.calories);
    return (
      <article
        className="card-enter overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-soft md:p-5"
        aria-label={`${displayName}: ${kcal} calorías`}
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-800">{displayName}</h2>
        </header>

        <div className="mt-3">
          <span className="text-[28px] font-extrabold leading-none text-brand-orange">{kcal}</span>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">KCAL</p>
        </div>

        <div className="mt-3 flex gap-4">
          <MacroItem value={Math.round(reverseResult.proteins)} label="PROTEÍNAS" colorClass="text-brand-green" />
          <MacroItem value={Math.round(reverseResult.carbohydrates)} label="CARBOHIDRATOS" colorClass="text-accent-gold" />
          <MacroItem value={Math.round(reverseResult.fats)} label="GRASAS" colorClass="text-slate-500" />
        </div>
      </article>
    );
  }

  // EstimateData rendering
  const { result, query, allergens } = estimateData;

  // No-match state
  if (!result) {
    return (
      <article
        className="card-enter overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-soft md:p-5"
        aria-label={`Sin resultados para ${query}`}
      >
        <p className="text-[15px] font-medium text-slate-500">
          No encontré información nutricional para &ldquo;{query}&rdquo;. Prueba con otro nombre.
        </p>
      </article>
    );
  }

  const displayName = result.nameEs ?? result.name;
  const kcal = Math.round(result.nutrients.calories);
  const proteins = Math.round(result.nutrients.proteins);
  const carbs = Math.round(result.nutrients.carbohydrates);
  const fats = Math.round(result.nutrients.fats);
  const hasAllergens = Array.isArray(allergens) && allergens.length > 0;

  // F-UX-A — Portion modifier display
  const portionMultiplier = estimateData.portionMultiplier;
  const hasModifier = portionMultiplier !== 1.0;
  const portionLabel = hasModifier ? formatPortionLabel(portionMultiplier) : '';
  const pillLabel = hasModifier
    ? portionLabel.startsWith('×')
      ? portionLabel // unmapped fallback — show the raw multiplier
      : `PORCIÓN ${portionLabel.toUpperCase()}`
    : '';
  const baseCalories =
    hasModifier && estimateData.baseNutrients !== undefined
      ? Math.round(estimateData.baseNutrients.calories)
      : null;

  const ariaLabel = hasModifier
    ? baseCalories !== null
      ? `${displayName}: ${kcal} calorías (${portionLabel}, base ${baseCalories})`
      : `${displayName}: ${kcal} calorías (${portionLabel})`
    : `${displayName}: ${kcal} calorías`;

  return (
    <article
      className="card-enter overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-soft md:p-5"
      aria-label={ariaLabel}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">{displayName}</h2>
        <ConfidenceBadge level={result.confidenceLevel} />
      </header>

      {hasModifier && (
        <p className="mt-1.5" aria-hidden="true">
          <span className="inline-block rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            {pillLabel}
          </span>
        </p>
      )}

      <div className="mt-3">
        <span className="text-[28px] font-extrabold leading-none text-brand-orange">{kcal}</span>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">KCAL</p>
        {baseCalories !== null && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            base: {baseCalories} kcal
          </p>
        )}
      </div>

      <div className="mt-3 flex gap-4">
        <MacroItem value={proteins} label="PROTEÍNAS" colorClass="text-brand-green" />
        <MacroItem value={carbs} label="CARBOHIDRATOS" colorClass="text-accent-gold" />
        <MacroItem value={fats} label="GRASAS" colorClass="text-slate-500" />
      </div>

      {hasAllergens && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allergens!.map((a) => (
            <AllergenChip key={a.allergen} allergen={a.allergen} />
          ))}
        </div>
      )}

      {result.source && (
        <footer className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          {result.source.name}
        </footer>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// MacroItem — internal subcomponent
// ---------------------------------------------------------------------------

function MacroItem({
  value,
  label,
  colorClass,
}: {
  value: number;
  label: string;
  colorClass: string;
}) {
  return (
    <div>
      <p className={`text-lg font-bold leading-none ${colorClass}`}>{value}<span className="text-slate-500 text-sm">g</span></p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
