'use client';

// VoiceOverlay — full-screen dialog for voice recording flow.
//
// Pre-permission screen shown on first use (hablar_mic_consented absent).
// Error toasts with role="alert" auto-dismiss after 2.5-3s.
// Voice settings pill (idle/ready only) opens VoicePickerDrawer.
// aria-live="polite" on dialog container.
// Escape key closes overlay.

import { useState, useEffect, useRef } from 'react';
import type { VoiceState, VoiceErrorCode } from '@/types/voice';
import { VoicePickerDrawer } from './VoicePickerDrawer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VoiceOverlayProps {
  isOpen: boolean;
  voiceState: VoiceState;
  onClose: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  errorCode: VoiceErrorCode | null;
  // Voice picker props (optional for test isolation)
  selectedVoiceName?: string | null;
  ttsEnabled?: boolean;
  onVoiceSelect?: (voiceName: string) => void;
  onTtsToggle?: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Error copy map
// ---------------------------------------------------------------------------

const ERROR_COPY: Record<VoiceErrorCode, { headline: string; autoDismissMs: number }> = {
  mic_permission: { headline: 'Micrófono bloqueado. Comprueba los permisos del navegador.', autoDismissMs: 3000 },
  mic_hardware: { headline: 'No se pudo acceder al micrófono. Comprueba que esté conectado.', autoDismissMs: 2500 },
  empty_transcription: { headline: 'No detectamos ninguna voz. Habla más fuerte o prueba de nuevo.', autoDismissMs: 2500 },
  network: { headline: 'Error de red. Inténtalo de nuevo.', autoDismissMs: 2500 },
  rate_limit: { headline: 'Límite de búsquedas por voz alcanzado. Inténtalo mañana.', autoDismissMs: 3000 },
  ip_limit: { headline: 'Límite de minutos de voz alcanzado por hoy.', autoDismissMs: 3000 },
  whisper_failure: { headline: 'Error al procesar la voz. Inténtalo de nuevo.', autoDismissMs: 2500 },
  budget_cap: { headline: 'Servicio de voz temporalmente no disponible.', autoDismissMs: 3000 },
  tts_unavailable: { headline: 'La voz del asistente no está disponible en este navegador.', autoDismissMs: 3000 },
};

// ---------------------------------------------------------------------------
// State text map
// ---------------------------------------------------------------------------

function getStateText(voiceState: VoiceState): string {
  switch (voiceState) {
    case 'ready': return 'Toca para hablar';
    case 'listening': return 'Habla ahora';
    case 'processing': return 'Procesando...';
    case 'speaking': return 'Respondiendo...';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceOverlay({
  isOpen,
  voiceState,
  onClose,
  onStartRecording,
  onStopRecording,
  errorCode,
  selectedVoiceName = null,
  ttsEnabled = true,
  onVoiceSelect = () => {},
  onTtsToggle = () => {},
}: VoiceOverlayProps) {
  const [showPrePermission, setShowPrePermission] = useState(false);
  const [dismissedError, setDismissedError] = useState<VoiceErrorCode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  // Check mic consent on open
  useEffect(() => {
    if (!isOpen) return;
    const consented = localStorage.getItem('hablar_mic_consented');
    setShowPrePermission(!consented);
    setDismissedError(null);
    setDrawerOpen(false);
  }, [isOpen]);

  // Auto-focus dismiss button on open
  useEffect(() => {
    if (isOpen && initialFocusRef.current) {
      initialFocusRef.current.focus();
    }
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawerOpen) {
          setDrawerOpen(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, drawerOpen]);

  // Auto-dismiss error toast
  useEffect(() => {
    if (!errorCode || errorCode === dismissedError) return;
    setDismissedError(null);

    const dismissMs = ERROR_COPY[errorCode]?.autoDismissMs ?? 2500;
    errorTimerRef.current = setTimeout(() => {
      setDismissedError(errorCode);
    }, dismissMs);

    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [errorCode, dismissedError]);

  function handleAllowMic() {
    localStorage.setItem('hablar_mic_consented', 'shown');
    setShowPrePermission(false);
    onStartRecording();
  }

  if (!isOpen) return null;

  const showError = errorCode && errorCode !== dismissedError;
  const showSettingsPill = !showPrePermission && (voiceState === 'idle' || voiceState === 'ready');
  const stateText = getStateText(voiceState);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      {/* Dismiss button (initial focus target) */}
      <button
        ref={initialFocusRef}
        type="button"
        data-initial-focus
        aria-label="Cerrar búsqueda por voz"
        onClick={onClose}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        {showPrePermission ? (
          // Pre-permission screen
          <div className="flex flex-col items-center">
            <svg className="h-12 w-12 text-[#2D5A27]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>

            <h2 className="mt-4 text-center text-[18px] font-semibold text-slate-700">
              ¿Podemos escucharte?
            </h2>

            <p className="mt-3 max-w-xs text-center text-[14px] leading-normal text-slate-500">
              Cuando uses la búsqueda por voz, tu audio se envía a OpenAI Whisper para convertirlo
              en texto. El audio se procesa y descarta inmediatamente — no lo almacenamos.
            </p>
            <p className="mt-2 max-w-xs text-center text-[14px] leading-normal text-slate-500">
              Consulta nuestra{' '}
              <a
                href="/privacidad"
                target="_blank"
                rel="noopener"
                className="text-[#2D5A27] underline"
              >
                política de privacidad
              </a>{' '}
              para más detalles.
            </p>

            <button
              type="button"
              onClick={handleAllowMic}
              className="mt-6 w-full max-w-xs rounded-2xl bg-[#2D5A27] py-3 text-[15px] font-semibold text-white"
            >
              Permitir micrófono
            </button>

            <button
              type="button"
              onClick={onClose}
              className="mt-3 text-center text-[13px] text-slate-400 underline"
            >
              Cancelar
            </button>
          </div>
        ) : (
          // Main voice UI
          <div className="flex flex-col items-center">
            {/* State text */}
            {stateText && (
              <p className="text-[18px] font-medium text-slate-700">{stateText}</p>
            )}

            {/* Mic button area (in overlay, tapping toggles record) */}
            <button
              type="button"
              aria-label={voiceState === 'listening' ? 'Detener grabación' : 'Comenzar grabación'}
              onClick={voiceState === 'listening' ? onStopRecording : onStartRecording}
              className="mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#2D5A27] text-white shadow-lg"
            >
              <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Error toast */}
      {showError && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute bottom-24 left-4 right-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700 shadow-md"
        >
          {ERROR_COPY[errorCode]?.headline ?? 'Error desconocido.'}
        </div>
      )}

      {/* Voice settings pill */}
      {showSettingsPill && (
        <button
          type="button"
          aria-label="Cambiar voz del asistente"
          onClick={() => setDrawerOpen(true)}
          className="absolute bottom-[calc(48px+env(safe-area-inset-bottom))] left-6 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-200"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
          {selectedVoiceName ?? 'Voz'}
        </button>
      )}

      {/* Voice picker drawer */}
      <VoicePickerDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onVoiceSelect={onVoiceSelect}
        onTtsToggle={onTtsToggle}
        ttsEnabled={ttsEnabled}
        selectedVoiceName={selectedVoiceName}
      />
    </div>
  );
}
