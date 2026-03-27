import Image from 'next/image';
import type { Dictionary } from '@/lib/i18n';

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
      className="text-emerald-600"
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
      className="text-amber-500"
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
      className="text-rose-500"
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  ),
};

const lightBadgeByLevel: Record<ConfidenceLevel, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-rose-50 text-rose-700 border-rose-200',
};

const lightCardBorderByLevel: Record<ConfidenceLevel, string> = {
  high: 'border-emerald-100',
  medium: 'border-amber-100',
  low: 'border-rose-100',
};

export function TrustEngineSection({ dict }: TrustEngineSectionProps) {
  return (
    <section
      aria-labelledby="trust-engine-heading"
      data-section="trust-engine"
      className="bg-paper py-20 md:py-28"
    >
      <div className="section-shell">
        {/* Header */}
        <div className="mx-auto mb-12 max-w-[640px] text-center md:mb-16">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-brand-orange md:text-sm">
            {dict.eyebrow}
          </p>
          <h2
            id="trust-engine-heading"
            className="mb-5 text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-[44px]"
          >
            {dict.headline}
          </h2>
          <p className="text-lg leading-relaxed text-slate-600 md:text-xl">{dict.subtitle}</p>
        </div>

        {/* Confidence level cards — lighter style */}
        <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {dict.levels.map((level) => {
            const lvl = level.badge as ConfidenceLevel;
            return (
              <div
                key={level.badge}
                className={`rounded-2xl border bg-white p-6 shadow-soft md:p-8 ${lightCardBorderByLevel[lvl]}`}
              >
                <div className="mb-4">{levelIcons[lvl]}</div>
                <span
                  className={`mb-4 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${lightBadgeByLevel[lvl]}`}
                >
                  {level.badgeLabel}
                </span>
                <h3 className="mb-3 text-lg font-semibold text-slate-900 md:text-xl">
                  {level.title}
                </h3>
                <p className="text-base leading-relaxed text-slate-600">{level.description}</p>
              </div>
            );
          })}
        </div>

        {/* Allergen guardrail callout — 2-column: text left, image right */}
        <div className="rounded-2xl border border-orange-200 bg-orange-50 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
            {/* Text */}
            <div className="p-6 md:p-8">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 shrink-0">
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
                    className="text-orange-500"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <h3 className="mb-2 text-base font-semibold text-orange-700">
                    {dict.allergenTitle}
                  </h3>
                  <p className="text-base leading-relaxed text-slate-700">{dict.allergenDescription}</p>
                </div>
              </div>
            </div>
            {/* Image */}
            <div className="relative hidden lg:block">
              <Image
                src="/images/trust-allergen-family.png"
                alt="Familia disfrutando de una comida segura gracias a alérgenos verificados"
                fill
                className="object-cover"
                sizes="280px"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
