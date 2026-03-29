import type { Dictionary } from '@/lib/i18n';

interface FAQSectionProps {
  dict: Dictionary['faq'];
}

export function FAQSection({ dict }: FAQSectionProps) {
  if (!dict.items.length) return null;

  return (
    <section
      aria-labelledby="faq-heading"
      data-section="faq"
      className="bg-paper py-16 md:py-20"
    >
      <div className="section-shell">
        <div className="mb-10 md:mb-12">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-brand-orange md:text-sm">
            {dict.eyebrow}
          </p>
          <h2
            id="faq-heading"
            className="max-w-[640px] text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-[44px]"
          >
            {dict.headline}
          </h2>
        </div>

        <div className="space-y-3">
          {dict.items.map((item) => (
            <details
              key={item.question}
              name="faq"
              className="group rounded-2xl border border-slate-100 bg-white shadow-soft"
            >
              <summary className="cursor-pointer select-none px-6 py-5 text-base font-semibold text-slate-900 md:text-lg">
                {item.question}
              </summary>
              <p className="px-6 pb-5 text-base leading-relaxed text-slate-600">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
