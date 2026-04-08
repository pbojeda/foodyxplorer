'use client';

import { useState, useEffect } from 'react';
import { WaitlistForm } from '@/components/features/WaitlistForm';
import { trackEvent } from '@/lib/analytics';
import type { Dictionary } from '@/lib/i18n';
import type { Variant } from '@/types';

interface WaitlistCTASectionProps {
  dict: Dictionary['waitlistCta'];
  variant: Variant;
  hablarUrl?: string;
}

export function WaitlistCTASection({ dict, variant, hablarUrl }: WaitlistCTASectionProps) {
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${process.env['NEXT_PUBLIC_API_URL']}/waitlist/count`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { success: boolean; data?: { count: number } }) => {
        if (
          data?.success &&
          typeof data.data?.count === 'number' &&
          data.data.count >= 10
        ) {
          setWaitlistCount(data.data.count);
        }
      })
      .catch(() => {
        // Graceful degradation — counter stays null
      });
  }, []);

  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-cta-heading"
      data-section="waitlist-cta"
      className="py-20 md:py-28 relative overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      }}
    >
      {/* Subtle green atmospheric glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(45,90,39,0.12) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        <div className="max-w-xl mx-auto text-center">
          <h2
            id="waitlist-cta-heading"
            className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-white mb-5"
          >
            {dict.headline}
          </h2>
          <p className="text-lg md:text-xl leading-relaxed text-slate-300 mb-4">
            {dict.subtitle}
          </p>
          {/* Urgency copy */}
          <p className="text-sm font-semibold text-brand-orange mb-8 uppercase tracking-widest">
            {dict.urgency}
          </p>

          {/* Waitlist form — with phone (the ONLY place with phone field) */}
          <div className="mb-6">
            <WaitlistForm source="cta" variant={variant} showPhone={true} />
          </div>

          {/* Social proof counter — shown only when count >= 10 */}
          {waitlistCount !== null && (
            <p className="text-sm font-medium text-emerald-400 mb-4">
              Ya se han apuntado {waitlistCount} personas
            </p>
          )}

          {/* Hablar CTA — shown only when web URL is configured */}
          {hablarUrl && hablarUrl !== '#waitlist' && (
            <p className="mb-4">
              <a
                href={`${hablarUrl}?utm_source=landing&utm_medium=bottom_cta`}
                target="_blank"
                rel="noopener noreferrer"
                data-cta-source="bottom"
                onClick={() => {
                  trackEvent({
                    event: 'cta_hablar_click',
                    source: 'bottom',
                    variant,
                    lang: 'es',
                    utm_medium: 'bottom_cta',
                  });
                }}
                className="text-sm text-botanical hover:underline"
              >
                O pruébalo ahora gratis →
              </a>
            </p>
          )}

          {/* Trust note */}
          <p className="text-sm text-slate-500 text-center">
            {dict.trustNote}
          </p>

          {/* Open source badge */}
          <div className="mt-6 flex items-center justify-center gap-2 text-slate-500">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="16 12 12 8 8 12" />
              <line x1="12" y1="16" x2="12" y2="8" />
            </svg>
            <span className="text-xs">Proyecto open source. Transparente por diseño.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
