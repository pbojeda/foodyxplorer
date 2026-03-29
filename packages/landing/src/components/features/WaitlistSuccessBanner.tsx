'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * WaitlistSuccessBanner — reads ?waitlist=success from URL params.
 *
 * Renders a dismissible green success banner when the URL contains
 * `?waitlist=success` (set by the API after a no-JS form POST redirect).
 *
 * IMPORTANT: This component uses useSearchParams() and must be wrapped
 * in <Suspense fallback={null}> in page.tsx to avoid disabling SSG.
 */
export function WaitlistSuccessBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const isSuccess = searchParams.get('waitlist') === 'success';

  if (!isSuccess || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-center justify-between gap-4 bg-emerald-600 px-5 py-3 text-white"
    >
      <p className="text-sm font-medium">
        ✓ ¡Te has apuntado a la waitlist! Te avisaremos cuando lancemos.
      </p>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-white/80 transition hover:text-white"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
