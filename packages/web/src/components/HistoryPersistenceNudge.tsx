'use client';

// HistoryPersistenceNudge — inline feed card nudging anonymous users to register.
// Design spec: W20. Shown when entries.length >= 2 and user is null.
// AC37: shown only when showPersistenceNudge condition met.
// AC52: trackEvent for shown/cta/dismissed.

import { useEffect } from 'react';
import { trackEvent } from '@/lib/metrics';

interface HistoryPersistenceNudgeProps {
  onDismiss: () => void;
}

export function HistoryPersistenceNudge({ onDismiss }: HistoryPersistenceNudgeProps) {
  // Fire history_persistence_nudge_shown on mount
  useEffect(() => {
    trackEvent('history_persistence_nudge_shown');
  }, []);

  function handleCtaClick() {
    trackEvent('history_persistence_nudge_cta');
    // Navigate to auth page — using window.location to stay framework-agnostic
    // (same pattern as LoginCta component)
    window.location.href = '/login';
  }

  function handleDismiss() {
    trackEvent('history_persistence_nudge_dismissed');
    onDismiss();
  }

  return (
    <div className="relative rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4">
      {/* Dismiss button */}
      <button
        type="button"
        aria-label="Cerrar sugerencia"
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 p-1 rounded focus-visible:ring-2 focus-visible:ring-brand-green"
        onClick={handleDismiss}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <h3 className="text-sm font-semibold text-slate-700 mb-1 pr-6">
        Guarda tu historial entre sesiones
      </h3>
      <p className="text-sm text-slate-500 leading-relaxed mb-3">
        Regístrate para no perder tus consultas.
      </p>

      <button
        type="button"
        className="bg-brand-green text-white text-sm font-semibold rounded-lg px-4 py-2"
        onClick={handleCtaClick}
      >
        Crear cuenta gratis
      </button>
    </div>
  );
}
