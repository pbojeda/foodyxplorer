import type { Dictionary } from '@/lib/i18n';

interface ProblemSectionProps {
  dict: Dictionary['problem'];
}

export function ProblemSection({ dict }: ProblemSectionProps) {
  return (
    <section
      aria-labelledby="problem-heading"
      data-section="problem"
      className="bg-ivory py-24 lg:py-32"
    >
      <div className="max-w-3xl mx-auto px-6 text-center">
        <p className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4">
          {dict.eyebrow}
        </p>
        <h2
          id="problem-heading"
          className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-slate-900 mb-8"
        >
          {dict.headline}
        </h2>
        <p className="text-lg md:text-xl leading-relaxed text-slate-600 mt-6">
          {dict.p1}
        </p>
        <p className="text-lg md:text-xl leading-relaxed text-slate-600 mt-6">
          {dict.p2}
        </p>
        <p className="text-lg md:text-xl leading-relaxed text-slate-600 mt-6">
          {dict.p3}
        </p>
      </div>
    </section>
  );
}
