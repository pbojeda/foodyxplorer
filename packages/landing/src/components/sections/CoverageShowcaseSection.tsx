// F105 — Landing Coverage Showcase
// Quantitative trust signal: four real catalog numbers from
// `src/lib/coverage-counts.ts`. Static, no API, no animations.

import type { Dictionary } from '@/lib/i18n';
import { COVERAGE_COUNTS } from '@/lib/coverage-counts';

interface CoverageShowcaseSectionProps {
  dict: Dictionary['coverageShowcase'];
}

// Order mirrors the `stats` array in the i18n dictionary.
const STAT_ORDER: ReadonlyArray<keyof typeof COVERAGE_COUNTS> = [
  'dishes',
  'foods',
  'categories',
  'confidenceLevels',
];

export function CoverageShowcaseSection({ dict }: CoverageShowcaseSectionProps) {
  return (
    <section
      aria-labelledby="coverage-showcase-heading"
      aria-label={dict.headline}
      data-section="coverage-showcase"
      className="bg-paper py-12 lg:py-16"
    >
      <div className="section-shell">
        <div className="card-surface p-6 md:p-10">
          {/* Header */}
          <div className="mb-8 max-w-2xl">
            <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-brand-orange">
              {dict.eyebrow}
            </p>
            <h2
              id="coverage-showcase-heading"
              className="mb-3 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl"
            >
              {dict.headline}
            </h2>
            <p className="text-base leading-relaxed text-slate-600">{dict.subtitle}</p>
          </div>

          {/* Stat grid — mobile 2×2, tablet/desktop single row */}
          <dl className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {STAT_ORDER.map((key, idx) => {
              const stat = dict.stats[idx];
              if (!stat) return null;
              const value = COVERAGE_COUNTS[key];
              return (
                <div
                  key={key}
                  className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft"
                >
                  <dt className="text-sm font-medium text-slate-500">{stat.label}</dt>
                  <dd className="mt-1 text-4xl font-bold tracking-tight text-brand-green md:text-5xl">
                    {value}
                  </dd>
                  <p className="mt-2 text-xs text-botanical sm:text-sm">{stat.note}</p>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}
