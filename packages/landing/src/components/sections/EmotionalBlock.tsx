import Image from 'next/image';
import type { Dictionary } from '@/lib/i18n';

interface EmotionalBlockProps {
  dict: Dictionary['emotionalBlock'];
}

export function EmotionalBlock({ dict }: EmotionalBlockProps) {
  return (
    <section
      aria-labelledby="emotional-heading"
      data-section="emotional"
      className="bg-ivory py-20 md:py-24"
    >
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        {/* ASYMMETRIC layout: large image left, scenarios list right */}
        <div className="flex flex-col md:flex-row md:items-center gap-12 md:gap-16">
          {/* Left: Large food image — spans full width on mobile, 50% on desktop */}
          <div className="md:w-1/2 shrink-0">
            <div className="relative rounded-2xl overflow-hidden shadow-layered">
              <Image
                src="/images/emotional-pulpo-feira.png"
                alt="Pulpo a feira en un restaurante gallego, con información nutricional clara gracias a nutriXplorer"
                width={700}
                height={500}
                className="object-cover w-full aspect-[4/3]"
                sizes="(max-width: 768px) 100vw, 50vw"
                loading="lazy"
              />
              {/* Subtle overlay gradient at bottom */}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-slate-900/20 to-transparent pointer-events-none"
              />
            </div>
          </div>

          {/* Right: Scenarios list — deliberately NOT a card grid */}
          <div className="md:w-1/2">
            <h2
              id="emotional-heading"
              className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-slate-900 mb-10 max-w-[520px]"
            >
              {dict.headline}
            </h2>

            <div className="flex flex-col gap-8">
              {dict.scenarios.map((scenario, index) => (
                <div key={scenario.scene} className="flex gap-5">
                  {/* Index number — typographic element, not a badge */}
                  <div className="shrink-0 w-8 h-8 rounded-full bg-brand-green/10 flex items-center justify-center mt-0.5">
                    <span
                      className="text-sm font-bold text-brand-green"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      {scenario.scene}
                    </h3>
                    <p className="text-base leading-relaxed text-slate-600">
                      {scenario.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
