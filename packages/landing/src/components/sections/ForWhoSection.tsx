import type { Dictionary } from '@/lib/i18n';
import { AudienceGrid } from '@/components/AudienceGrid';

interface ForWhoSectionProps {
  dict: Dictionary['forWho'];
}

export function ForWhoSection({ dict }: ForWhoSectionProps) {
  return (
    <section
      aria-labelledby="for-who-heading"
      data-section="for-who"
      id="para-quien"
      className="bg-ivory py-16 md:py-20"
    >
      <div className="section-shell">
        {/* Header — left-aligned */}
        <div className="mb-10 md:mb-12">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-brand-orange md:text-sm">
            {dict.eyebrow}
          </p>
          <h2
            id="for-who-heading"
            className="max-w-[640px] text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-[44px]"
          >
            {dict.headline}
          </h2>
        </div>

        {/* AudienceGrid — 4-card grid */}
        <AudienceGrid />
      </div>
    </section>
  );
}
