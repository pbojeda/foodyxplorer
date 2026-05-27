'use client';

// ClearHistoryButton — "Borrar todo el historial" text link + modal confirmation dialog.
// Design spec: W21 (clear all UX), W23 (focus trap, ARIA).
// AC43: dialog opens with role="alertdialog", aria-modal, focus on Cancel.
// AC44: focus trap (Tab/Shift+Tab cycle), Escape closes.
// AC51: trackEvent('history_cleared') on confirm.

import { useState, useRef, useEffect, useId } from 'react';
import { trackEvent } from '@/lib/metrics';

interface ClearHistoryButtonProps {
  onConfirm: () => void;
}

export function ClearHistoryButton({ onConfirm }: ClearHistoryButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus management: on dialog open, focus Cancel button.
  useEffect(() => {
    if (isOpen) {
      // Use setTimeout to ensure the DOM has updated
      const timer = setTimeout(() => {
        cancelRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    } else {
      // Return focus to trigger on close
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  // Escape key closes dialog
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus trap: Tab / Shift+Tab cycle between the two focusables (Cancel and
  // Confirm). Direction is irrelevant for a 2-button dialog — both directions
  // toggle between the same two elements.
  function handleKeyDownDialog(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const focused = document.activeElement;
    if (focused === cancelRef.current) {
      confirmRef.current?.focus();
    } else {
      cancelRef.current?.focus();
    }
  }

  function handleCancel() {
    setIsOpen(false);
  }

  function handleConfirm() {
    trackEvent('history_cleared');
    setIsOpen(false);
    onConfirm();
  }

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 min-h-[44px] flex items-center"
        onClick={() => setIsOpen(true)}
      >
        Borrar todo el historial
      </button>

      {/* Confirmation modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={handleKeyDownDialog}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={handleCancel}
            aria-hidden="true"
          />

          {/* Dialog card */}
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative bg-white rounded-2xl shadow-layered px-6 py-5 max-w-sm mx-4 w-full"
          >
            <h2
              id={titleId}
              className="text-base font-semibold text-slate-800 mb-2"
            >
              Borrar todo el historial
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5">
              Vas a eliminar todo tu historial de búsqueda. Esta acción no se puede deshacer.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                ref={cancelRef}
                type="button"
                className="border border-slate-200 text-slate-700 text-sm font-medium rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors duration-150"
                onClick={handleCancel}
              >
                Cancelar
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="bg-red-500 text-white text-sm font-semibold rounded-xl px-4 py-2 hover:opacity-90 active:scale-[0.98] transition-all duration-150"
                onClick={handleConfirm}
              >
                Borrar todo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
