'use client';

// RateLimitNudge — F-WEB-TIER (AC22–AC24)
// Inline upgrade prompt shown below the rate-limit error message when an
// anonymous user hits their daily quota (429 RATE_LIMIT_EXCEEDED).
//
// NOT a modal or toast — an inline green card rendered as a sibling below
// ResultsArea in HablarShell (P-I2: NOT inside ErrorState — it has no slot).
//
// Fires rate_limit_nudge_shown on mount, rate_limit_nudge_clicked on CTA click.
// role="status" for polite screen-reader live region announcement.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trackEvent } from '@/lib/metrics';

interface RateLimitNudgeProps {
  onSignUpClick: () => void;
}

export function RateLimitNudge({ onSignUpClick }: RateLimitNudgeProps): JSX.Element {
  const router = useRouter();

  useEffect(() => {
    trackEvent('rate_limit_nudge_shown');
  }, []);

  function handleSignUp() {
    trackEvent('rate_limit_nudge_clicked');
    onSignUpClick();
    router.push('/login');
  }

  return (
    <div
      role="status"
      className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
    >
      <p className="text-sm text-slate-700 leading-relaxed mb-3">
        Regístrate gratis y obtén el doble de consultas diarias (100 en lugar de 50).
      </p>
      <button
        type="button"
        onClick={handleSignUp}
        className="bg-brand-green text-white text-sm font-semibold rounded-lg px-4 py-2 hover:opacity-90 active:scale-[0.98] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
      >
        Crear cuenta gratis
      </button>
    </div>
  );
}
