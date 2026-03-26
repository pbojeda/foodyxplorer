import type { Dictionary } from '@/lib/i18n';
import { Badge } from '@/components/ui/Badge';

interface TrustEngineSectionProps {
  dict: Dictionary['trustEngine'];
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

const levelIcons: Record<ConfidenceLevel, React.ReactNode> = {
  high: (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-400"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  medium: (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-400"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  low: (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-rose-400"
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  ),
};

const darkCardBorderByLevel: Record<ConfidenceLevel, string> = {
  high: 'border-emerald-800/40',
  medium: 'border-amber-800/40',
  low: 'border-rose-800/40',
};

const darkBadgeByLevel: Record<ConfidenceLevel, string> = {
  high: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
  medium: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  low: 'bg-rose-900/50 text-rose-300 border-rose-700/50',
};

export function TrustEngineSection({ dict }: TrustEngineSectionProps) {
  return (
    <section
      aria-labelledby="trust-engine-heading"
      data-section="trust-engine"
      className="bg-slate-950 py-20 md:py-28"
      style={{
        backgroundImage:
          'radial-gradient(ellipse at 50% 0%, rgba(45,90,39,0.15) 0%, transparent 50%)',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <p className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-orange-300 mb-3">
            {dict.eyebrow}
          </p>
          <h2
            id="trust-engine-heading"
            className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-white mb-5 max-w-[640px] mx-auto"
          >
            {dict.headline}
          </h2>
          <p className="text-lg md:text-xl leading-relaxed text-slate-300 max-w-[580px] mx-auto">
            {dict.subtitle}
          </p>
        </div>

        {/* Confidence level cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {dict.levels.map((level) => {
            const lvl = level.badge as ConfidenceLevel;
            return (
              <div
                key={level.badge}
                className={`rounded-2xl border bg-white/5 p-6 md:p-8 border-white/10 ${darkCardBorderByLevel[lvl]}`}
              >
                <div className="mb-4">{levelIcons[lvl]}</div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold mb-4 ${darkBadgeByLevel[lvl]}`}
                >
                  {level.badgeLabel}
                </span>
                <h3 className="text-lg md:text-xl font-semibold text-white mb-3">
                  {level.title}
                </h3>
                <p className="text-base leading-relaxed text-slate-300">
                  {level.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Allergen guardrail callout — integrated, not separate */}
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-6 md:p-8">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className="shrink-0 mt-0.5">
              <svg
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-orange-400"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-orange-300 mb-2">
                {dict.allergenTitle}
              </h3>
              <p className="text-base leading-relaxed text-slate-300">
                {dict.allergenDescription}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
