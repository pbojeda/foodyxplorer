import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';

interface EmotionalBlockProps {
  dict: Dictionary['emotionalBlock'];
}

export function EmotionalBlock({ dict }: EmotionalBlockProps) {
  return (
    <section
      aria-labelledby="emotional-heading"
      data-section="emotional"
      className="bg-mist py-12 lg:py-16"
    >
      <div className="section-shell">
        <div className="mx-auto max-w-2xl text-center mb-10">
          <h2
            id="emotional-heading"
            className="text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-[44px]"
          >
            {dict.headline}
          </h2>
        </div>

        {/* Asymmetric layout: left large photo, right content */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12 lg:items-center">
          {/* Left — food photo in card-surface frame */}
          <div className="card-surface overflow-hidden p-0">
            <div className="relative h-72 lg:h-[480px]">
              <Image
                src="/images/emotional-friends-dining.jpg"
                alt="Amigos disfrutando de una cena en restaurante, usando nutriXplorer para consultar información nutricional"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
          </div>

          {/* Right — headline, bullet scenarios, quote */}
          <div className="flex flex-col gap-5">
            {dict.scenarios.map((scenario) => (
              <div
                key={scenario.scene}
                className="card-surface flex items-start gap-5 p-6"
              >
                <CheckCircle2
                  data-testid="icon-CheckCircle2"
                  className="mt-0.5 h-6 w-6 shrink-0 text-botanical"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{scenario.scene}</h3>
                  <p className="mt-2 text-base leading-relaxed text-slate-600">
                    {scenario.description}
                  </p>
                </div>
              </div>
            ))}

            {/* Quote block */}
            <blockquote className="border-l-4 border-botanical pl-5 text-base italic leading-relaxed text-slate-600">
              {dict.quote}
              {dict.quoteAuthor && (
                <cite className="mt-2 block text-sm font-semibold not-italic text-botanical">
                  — {dict.quoteAuthor}
                </cite>
              )}
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
