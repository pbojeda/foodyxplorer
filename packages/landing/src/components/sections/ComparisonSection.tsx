import type { Dictionary } from '@/lib/i18n';

interface ComparisonSectionProps {
  dict: Dictionary['comparison'];
}

export function ComparisonSection({ dict }: ComparisonSectionProps) {
  return (
    <section
      aria-labelledby="comparison-heading"
      data-section="comparison"
      className="bg-slate-50 py-16 md:py-20"
    >
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        {/* Centered headline — intentional contrast with ForWho's left-aligned */}
        <div className="text-center mb-10 md:mb-12">
          <h2
            id="comparison-heading"
            className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-slate-900 max-w-[640px] mx-auto"
          >
            {dict.headline}
          </h2>
        </div>

        {/* 4 comparison cards — NOT a table, intentionally card layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {dict.cards.map((card) => (
            <div
              key={card.title}
              className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6 md:p-8 flex flex-col"
            >
              {/* Title + versus label */}
              <div className="mb-5">
                <h3 className="text-lg md:text-xl font-semibold text-slate-900 mb-1">
                  {card.title}
                </h3>
                <p className="text-[13px] md:text-sm text-slate-500 font-medium italic">
                  {card.versus}
                </p>
              </div>

              {/* What they offer and lack */}
              <p className="text-base leading-relaxed text-slate-600 mb-5 grow">
                {card.description}
              </p>

              {/* What nutriXplorer adds — the differentiator */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-brand-green/10 flex items-center justify-center"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-brand-green"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <p className="text-sm font-medium text-brand-green leading-relaxed">
                    {card.advantage}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
