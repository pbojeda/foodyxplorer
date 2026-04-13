'use client';
// NutritionCard — primary result unit for nutriXplorer.
// Renders a dish's nutritional information in a styled card.
// Accepts either EstimateData (standard) or ReverseSearchResult (filter results).
// Requires 'use client' for useId() (portion section heading id, unique per card instance).

import React, { useId } from 'react';
import type { EstimateData, PortionAssumption, ReverseSearchResult } from '@foodxplorer/shared';
import { formatPortionLabel, formatPortionTermLabel } from '@foodxplorer/shared';
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
  // Unique id per card instance for aria-labelledby (prevents duplicate ids in
  // multi-card pages like comparison view). Requires 'use client'.
  const instanceId = useId();
  const portionHeadingId = `portion-heading-${instanceId}`;

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
  const portionLabel = formatPortionLabel(portionMultiplier); // empty when ≈1.0
  const hasModifier = portionLabel !== '';
  // Unify the pill vocabulary: mapped words are uppercased with the
  // "PORCIÓN" prefix; unmapped `×N` values get the same prefix so the two
  // states don't look like different components.
  const pillLabel = hasModifier ? `PORCIÓN ${portionLabel.toUpperCase()}` : '';
  const baseCalories =
    hasModifier && estimateData.baseNutrients !== undefined
      ? Math.round(estimateData.baseNutrients.calories)
      : null;

  // F-UX-B — Per-dish portion assumption
  const portionAssumption = estimateData.portionAssumption;

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

      {/* Portion section — wraps F-UX-A pill + F-UX-B line when either is present */}
      {(hasModifier || portionAssumption) && (
        <section aria-labelledby={portionHeadingId} className="mt-1.5">
          <h3 id={portionHeadingId} className="sr-only">Información de porción</h3>

          {/* F-UX-A pill — moved inside section, mt-1.5 now on section itself */}
          {hasModifier && (
            <p aria-hidden="true">
              <span className="inline-block rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                {pillLabel}
              </span>
            </p>
          )}

          {/* F-UX-B portion assumption line */}
          {portionAssumption && (
            <div
              role="note"
              aria-label={buildPortionAssumptionAriaLabel(portionAssumption)}
              className="mt-1 text-[12px] leading-snug"
            >
              {renderPortionAssumptionContent(portionAssumption)}
            </div>
          )}
        </section>
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
// F-UX-B helpers — pure functions colocated with the component
// ---------------------------------------------------------------------------

/**
 * Derive the display label for the portion term.
 * Primary: user's literal wording from termDisplay (first-letter uppercased).
 * Fallback: canonical term mapped via the shared helper (handles 'media_racion' → 'Media ración').
 */
function getTermLabel(pa: PortionAssumption): string {
  if (pa.termDisplay) {
    return pa.termDisplay.charAt(0).toUpperCase() + pa.termDisplay.slice(1);
  }
  return formatPortionTermLabel(pa.term);
}

/**
 * Render the visible text content for the portion assumption line.
 * Returns a React node (plain string for per_dish paths, JSX for generic).
 * Uses <span className="italic"> (not <em>) for "estimado genérico" — purely
 * visual italic to avoid screen-reader stress-emphasis announcement.
 */
function renderPortionAssumptionContent(pa: PortionAssumption): React.ReactNode {
  const term = getTermLabel(pa);
  switch (pa.source) {
    case 'per_dish':
      return pa.pieces !== null ? (
        <>
          <span className="font-semibold text-slate-600">{term} ≈ </span>
          <span className="font-normal text-slate-500">~{pa.pieces} {pa.pieceName} (≈ {pa.grams} g)</span>
        </>
      ) : (
        <>
          <span className="font-semibold text-slate-600">{term} ≈ </span>
          <span className="font-normal text-slate-500">{pa.grams} g</span>
        </>
      );
    case 'generic': {
      // superRefine guarantees gramsRange is non-null when source === 'generic'
      const [min, max] = pa.gramsRange!;
      return (
        <>
          <span className="font-semibold text-slate-600">{term} estándar: </span>
          <span className="font-normal text-slate-500">{min}–{max} g (</span>
          <span className="italic text-slate-500">estimado genérico</span>
          <span className="font-normal text-slate-500">)</span>
        </>
      );
    }
  }
}

/**
 * Build the aria-label for the portion assumption note element.
 * MUST contain "aproximadamente" in every render path.
 */
function buildPortionAssumptionAriaLabel(pa: PortionAssumption): string {
  switch (pa.source) {
    case 'per_dish':
      return pa.pieces !== null
        ? `aproximadamente ${pa.pieces} ${pa.pieceName}, unos ${pa.grams} gramos`
        : `aproximadamente ${pa.grams} gramos`;
    case 'generic': {
      // superRefine guarantees gramsRange is non-null when source === 'generic'
      const [min, max] = pa.gramsRange!;
      return `aproximadamente entre ${min} y ${max} gramos, estimado genérico`;
    }
  }
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
