'use client';

// DeleteEntryButton — trash icon + inline confirm row for single history entry deletion.
// Design spec: W21. Inline confirm (not modal), 5s auto-revert, Escape cancels.
// AC41 (idle→confirming), AC42 (5s auto-revert), AC50 (trackEvent history_entry_deleted).

import { useState, useEffect, useRef } from 'react';
import { trackEvent } from '@/lib/metrics';

interface DeleteEntryButtonProps {
  /** Stable entry ID (search_history UUID for persisted entries). */
  entryId: string;
  /** Query text for aria-label and telemetry. */
  queryText: string;
  /** Input modality — forwarded to history_entry_deleted event. */
  inputMode: 'text' | 'voice';
  /** Called when the user confirms deletion. */
  onConfirm: (entryId: string) => void;
}

type State = 'idle' | 'confirming';

export function DeleteEntryButton({
  entryId,
  queryText,
  inputMode,
  onConfirm,
}: DeleteEntryButtonProps) {
  const [state, setState] = useState<State>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arm the 5s auto-revert whenever confirming state starts.
  useEffect(() => {
    if (state === 'confirming') {
      timerRef.current = setTimeout(() => {
        setState('idle');
      }, 5000);
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state]);

  // Escape key cancels the confirm row.
  useEffect(() => {
    if (state !== 'confirming') return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setState('idle');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  function handleTrashClick() {
    setState('confirming');
  }

  function handleCancel() {
    setState('idle');
  }

  function handleConfirm() {
    trackEvent('history_entry_deleted', { entryId, inputMode });
    setState('idle');
    onConfirm(entryId);
  }

  const truncatedQuery = queryText.length > 40 ? `${queryText.slice(0, 40)}…` : queryText;

  if (state === 'confirming') {
    return (
      <div
        className="flex items-center gap-2 text-sm"
        role="group"
        aria-label="Confirmar eliminación"
      >
        <span className="text-slate-500 text-xs whitespace-nowrap">¿Eliminar?</span>
        <button
          type="button"
          className="text-slate-500 text-xs underline underline-offset-2 hover:opacity-80"
          onClick={handleCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="text-red-600 text-xs font-semibold underline underline-offset-2 hover:opacity-80"
          onClick={handleConfirm}
        >
          Eliminar
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Eliminar consulta: ${truncatedQuery}`}
      className="p-1.5 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 opacity-60 md:opacity-0 md:group-hover:opacity-100"
      onClick={handleTrashClick}
    >
      {/* Trash icon — 16px, stroke 1.5, aria-hidden */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );
}
