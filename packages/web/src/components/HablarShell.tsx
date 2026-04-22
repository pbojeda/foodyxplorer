'use client';

// HablarShell — top-level client orchestrator for /hablar.
// Manages all page state: query, loading, results, error, inlineError.
// F092: adds photo analysis flow with executePhotoAnalysis.
// F091: adds voice flow (VoiceOverlay + useVoiceSession + TTS playback).
// Uses useRef<AbortController | null> for stale request guard (both text and photo flows).

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConversationMessageData, MenuAnalysisData } from '@foodxplorer/shared';
import type { VoiceBudgetData, VoiceErrorCode, VoiceState } from '@/types/voice';
import { getActorId } from '@/lib/actorId';
import { sendMessage, sendPhotoAnalysis, ApiError } from '@/lib/apiClient';
import { resizeImageForUpload } from '@/lib/imageResize';
import { trackEvent, flushMetrics } from '@/lib/metrics';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { useTtsPlayback } from '@/hooks/useTtsPlayback';
import { ConversationInput } from './ConversationInput';
import { ResultsArea } from './ResultsArea';
import { VoiceOverlay } from './VoiceOverlay';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const VALID_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function HablarShell() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ConversationMessageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');

  // Photo analysis state (F092)
  const [photoMode, setPhotoMode] = useState<'idle' | 'analyzing'>('idle');
  const [photoResults, setPhotoResults] = useState<MenuAnalysisData | null>(null);

  // Voice state (F091)
  const [isVoiceOverlayOpen, setIsVoiceOverlayOpen] = useState(false);
  const [budgetCapActive, setBudgetCapActive] = useState(false);
  const [voiceError, setVoiceError] = useState<VoiceErrorCode | null>(null);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem('hablar_voice');
    } catch {
      return null;
    }
  });
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('hablar_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const actorIdRef = useRef<string>('');
  if (!actorIdRef.current && typeof window !== 'undefined') {
    actorIdRef.current = getActorId();
  }
  const voiceSession = useVoiceSession(actorIdRef.current);
  const tts = useTtsPlayback({ enabled: ttsEnabled, voiceName: selectedVoiceName });

  const handleVoiceSelect = useCallback((name: string) => {
    setSelectedVoiceName(name);
    try {
      localStorage.setItem('hablar_voice', name);
    } catch {
      // localStorage unavailable — fall back to in-memory state for this session
    }
  }, []);

  const handleTtsToggle = useCallback((enabled: boolean) => {
    setTtsEnabled(enabled);
    try {
      localStorage.setItem('hablar_tts_enabled', String(enabled));
    } catch {
      // localStorage unavailable — fall back to in-memory state for this session
    }
  }, []);

  // Ref to track the current in-flight AbortController for stale request guard
  const currentRequestRef = useRef<AbortController | null>(null);
  // Ref to the input-bar MicButton so we can restore focus on overlay close (AC15)
  const micButtonRef = useRef<HTMLButtonElement>(null);

  // Flush metrics on page unload
  useEffect(() => {
    const handleUnload = () => flushMetrics();
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Fetch voice budget on mount — fail-open on error (F091)
  useEffect(() => {
    const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
    if (!baseUrl) return;
    const controller = new AbortController();
    fetch(`${baseUrl}/health/voice-budget`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<VoiceBudgetData>) : null))
      .then((data) => {
        if (data?.exhausted) setBudgetCapActive(true);
      })
      .catch(() => {
        // Fail-open: budget unknown → allow voice (API enforces the cap)
      });
    return () => controller.abort();
  }, []);

  // Sync voice session results → HablarShell results + speak summary via TTS (F091)
  useEffect(() => {
    if (voiceSession.state === 'done' && voiceSession.lastResponse) {
      const data = voiceSession.lastResponse.data;
      setResults(data);
      setError(null);
      setInlineError(null);
      setPhotoResults(null);
      setIsVoiceOverlayOpen(false);
      setVoiceError(null);
      trackEvent('voice_success', { intent: data.intent });

      // Speak a short summary — presentation layer only; engine already
      // calculated the numbers (ADR-001).
      if (data.intent === 'estimation' && data.estimation?.result) {
        const result = data.estimation.result;
        const name = result.nameEs ?? result.name ?? 'este plato';
        const kcal = Math.round(result.nutrients.calories);
        tts.play(`${name} tiene aproximadamente ${kcal} kilocalorías.`);
      }
    }
  }, [voiceSession.state, voiceSession.lastResponse, tts]);

  // Sync voice errors → UI error code (F091).
  // Persistent errors (rate limit, IP limit, budget cap, Whisper failure, network)
  // get promoted to ResultsArea as an ErrorState and close the overlay. Transient
  // errors (mic_permission, mic_hardware, empty_transcription, tts_unavailable)
  // stay in the overlay as auto-dismissing toasts.
  useEffect(() => {
    if (voiceSession.state === 'error' && voiceSession.error) {
      const code = voiceSession.error.code as VoiceErrorCode;
      setVoiceError(code);
      trackEvent('voice_error', { errorCode: voiceSession.error.code });
      if (code === 'budget_cap') {
        setBudgetCapActive(true);
      }
      const isPersistent =
        code === 'budget_cap' ||
        code === 'rate_limit' ||
        code === 'ip_limit' ||
        code === 'whisper_failure' ||
        code === 'network';
      if (isPersistent) {
        setIsVoiceOverlayOpen(false);
        // Focus return to the input-bar MicButton (AC15)
        requestAnimationFrame(() => micButtonRef.current?.focus());
      }
    }
  }, [voiceSession.state, voiceSession.error]);

  const openVoiceOverlay = useCallback(() => {
    if (budgetCapActive) return;
    trackEvent('voice_start');
    setVoiceError(null);
    setIsVoiceOverlayOpen(true);
  }, [budgetCapActive]);

  const closeVoiceOverlay = useCallback(() => {
    voiceSession.cancel();
    setIsVoiceOverlayOpen(false);
    setVoiceError(null);
    // Return focus to the input-bar mic button (AC15 / WCAG 2.4.3)
    requestAnimationFrame(() => micButtonRef.current?.focus());
  }, [voiceSession]);

  const clearVoiceError = useCallback(() => setVoiceError(null), []);

  const startVoiceRecording = useCallback(() => {
    void voiceSession.start();
  }, [voiceSession]);

  const stopVoiceRecording = useCallback(() => {
    voiceSession.stop();
  }, [voiceSession]);

  // Map VoiceSessionState → UI VoiceState for the overlay
  const uiVoiceState: VoiceState =
    voiceSession.state === 'recording'
      ? 'listening'
      : voiceSession.state === 'uploading'
      ? 'processing'
      : voiceSession.state === 'error'
      ? 'error'
      : voiceSession.state === 'done'
      ? 'results'
      : 'idle';

  const executeQuery = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Abort any in-flight request (supports rapid re-submit)
    currentRequestRef.current?.abort();
    const controller = new AbortController();
    currentRequestRef.current = controller;

    setLastQuery(text);
    setIsLoading(true);
    setError(null);
    setInlineError(null);
    // Cross-flow cleanup: text query clears photo results
    setPhotoResults(null);

    const startTime = Date.now();
    trackEvent('query_sent');

    try {
      const actorId = getActorId();
      const response = await sendMessage(text, actorId, controller.signal);

      // Stale response guard — controller may have been replaced by a newer request
      if (controller.signal.aborted) return;

      const data = response.data;

      // Handle text_too_long inline (not full-screen ErrorState)
      if (data.intent === 'text_too_long') {
        trackEvent('query_success', {
          intent: 'text_too_long',
          responseTimeMs: Date.now() - startTime,
        });
        setInlineError('Demasiado largo. Máx. 500 caracteres.');
        setResults(null);
        return;
      }

      trackEvent('query_success', {
        intent: data.intent,
        responseTimeMs: Date.now() - startTime,
      });
      setResults(data);
    } catch (err) {
      // AbortError from stale request guard or user-triggered abort — silently ignore
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      // TimeoutError from AbortSignal.timeout(15000) — show specific message
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        if (!controller.signal.aborted) {
          trackEvent('query_error', { errorCode: 'TIMEOUT_ERROR' });
          setError('La consulta ha tardado demasiado. Inténtalo de nuevo.');
          setResults(null);
        }
        return;
      }
      // Double-check for race condition
      if (controller.signal.aborted) return;

      // Map ApiError to user-friendly Spanish message
      if (err instanceof ApiError) {
        trackEvent('query_error', { errorCode: err.code });
        if (err.code === 'RATE_LIMIT_EXCEEDED') {
          setError('Has alcanzado el límite diario de 50 consultas. Vuelve mañana.');
        } else if (err.code === 'TIMEOUT_ERROR') {
          setError('La consulta ha tardado demasiado. Inténtalo de nuevo.');
        } else if (err.code === 'NETWORK_ERROR') {
          setError('Sin conexión. Comprueba tu red.');
        } else {
          setError(err.message || 'Algo salió mal. Inténtalo de nuevo.');
        }
      } else {
        trackEvent('query_error', { errorCode: 'UNKNOWN_ERROR' });
        setError('Algo salió mal. Inténtalo de nuevo.');
      }
      setResults(null);
    } finally {
      // Only clear loading state if this is still the active request
      if (currentRequestRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const executePhotoAnalysis = useCallback(async (file: File) => {
    // Client-side validation: MIME type
    // Allow empty file.type through (older mobile browsers — let API validate magic bytes)
    if (file.type !== '' && !VALID_MIME_TYPES.has(file.type)) {
      setInlineError('Formato no soportado. Usa JPEG, PNG o WebP.');
      trackEvent('photo_error', { errorCode: 'INVALID_FILE_TYPE' });
      return;
    }

    // Client-side validation: file size
    if (file.size > MAX_FILE_SIZE) {
      setInlineError('La foto es demasiado grande. Máximo 10 MB.');
      trackEvent('photo_error', { errorCode: 'FILE_TOO_LARGE' });
      return;
    }

    // Abort any in-flight request (stale request guard)
    currentRequestRef.current?.abort('stale_request');
    const controller = new AbortController();
    currentRequestRef.current = controller;

    // Cross-flow cleanup: photo analysis clears text results
    setResults(null);
    setPhotoMode('analyzing');
    setError(null);
    setInlineError(null);

    const startTime = Date.now();
    trackEvent('photo_sent');

    try {
      const actorId = getActorId();
      // Downscale before upload. Mobile photos routinely exceed the Vercel
      // Serverless Function body limit (~4.5 MB). The resize utility is a
      // no-op for files already below 1.5 MB and falls back gracefully on
      // any error (see BUG-PROD-001).
      const uploadFile = await resizeImageForUpload(file);
      // Emit telemetry when the resize actually shrunk the file, or when it
      // silently fell back (same identity) — the gap between these two in
      // production tells us whether the fix is working.
      if (uploadFile !== file) {
        trackEvent('photo_resize_ok', {
          originalKB: Math.round(file.size / 1024),
          resizedKB: Math.round(uploadFile.size / 1024),
        });
      } else if (file.size > 1.5 * 1024 * 1024) {
        // Resize was supposed to run (file > passthrough threshold) but the
        // returned File is the original → silent fallback path.
        trackEvent('photo_resize_fallback', {
          originalKB: Math.round(file.size / 1024),
        });
      }
      // Stale-request guard: if the user submitted another photo while we
      // were resizing, abort before touching the network.
      if (controller.signal.aborted) return;
      const response = await sendPhotoAnalysis(uploadFile, actorId, controller.signal);

      // Stale response guard
      if (controller.signal.aborted) return;

      const data = response.data;

      trackEvent('photo_success', {
        dishCount: data.dishCount,
        responseTimeMs: Date.now() - startTime,
      });
      setPhotoResults(data);
    } catch (err) {
      // Stale request abort — silently ignore
      if (
        err instanceof DOMException &&
        err.name === 'AbortError' &&
        controller.signal.reason === 'stale_request'
      ) {
        return;
      }

      // Stale response guard (race condition)
      if (controller.signal.aborted) return;

      // Client timeout (65s AbortError without stale_request reason)
      if (err instanceof DOMException && err.name === 'AbortError') {
        trackEvent('photo_error', { errorCode: 'CLIENT_TIMEOUT' });
        setInlineError('El análisis ha tardado demasiado. Inténtalo de nuevo.');
        return;
      }

      // Map ApiError to user-friendly Spanish message
      if (err instanceof ApiError) {
        trackEvent('photo_error', { errorCode: err.code });
        switch (err.code) {
          case 'INVALID_IMAGE':
            setInlineError('Formato no soportado. Usa JPEG, PNG o WebP.');
            break;
          case 'MENU_ANALYSIS_FAILED':
            setInlineError('No he podido identificar el plato. Intenta con otra foto.');
            break;
          case 'PAYLOAD_TOO_LARGE':
            setInlineError('La foto es demasiado grande. Máximo 10 MB.');
            break;
          case 'RATE_LIMIT_EXCEEDED':
            setInlineError('Has alcanzado el límite de análisis por foto. Inténtalo más tarde.');
            break;
          case 'UNAUTHORIZED':
            setInlineError('Error de configuración. Contacta con soporte.');
            break;
          case 'PROCESSING_TIMEOUT':
          case 'TIMEOUT_ERROR':
            setInlineError('El análisis ha tardado demasiado. Inténtalo de nuevo.');
            break;
          case 'NETWORK_ERROR':
            setInlineError('Sin conexión. Comprueba tu red.');
            break;
          default:
            setInlineError('No se pudo analizar la foto. Inténtalo de nuevo.');
        }
      } else {
        trackEvent('photo_error', { errorCode: 'UNKNOWN_ERROR' });
        setInlineError('No se pudo analizar la foto. Inténtalo de nuevo.');
      }
    } finally {
      // Only clear analyzing state if this is still the active request
      if (currentRequestRef.current === controller) {
        setPhotoMode('idle');
      }
    }
  }, []);

  function handleSubmit() {
    if (!query.trim()) return;
    // Push hablar_query_sent immediately on submit — no PII, no query text.
    // Uses init pattern to guarantee queue exists even before gtag loads.
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: 'hablar_query_sent' });
    executeQuery(query);
  }

  function handleRetry() {
    if (lastQuery) {
      trackEvent('query_retry');
      executeQuery(lastQuery);
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      {/* Minimal app bar */}
      <header className="flex h-[52px] flex-shrink-0 items-center border-b border-slate-100 bg-white px-4">
        <span className="text-base font-bold text-brand-green">nutriXplorer</span>
      </header>

      {/* Results area — scrollable */}
      <ResultsArea
        isLoading={isLoading}
        results={results}
        error={error}
        onRetry={handleRetry}
        isPhotoLoading={photoMode === 'analyzing'}
        photoResults={photoResults}
        voiceError={voiceError}
        onVoiceRetry={clearVoiceError}
      />

      {/* Fixed bottom input */}
      <ConversationInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        onPhotoSelect={executePhotoAnalysis}
        isLoading={isLoading}
        isPhotoLoading={photoMode === 'analyzing'}
        inlineError={inlineError}
        onVoiceTap={openVoiceOverlay}
        onVoiceHoldStart={() => {
          if (budgetCapActive) return;
          trackEvent('voice_start');
          setVoiceError(null);
          setIsVoiceOverlayOpen(true);
          // Gate first-time mic access behind the pre-permission screen
          // (consistent with the tap path). If consent wasn't granted yet,
          // the overlay will show the privacy screen and the user completes
          // via the "Permitir micrófono" button.
          let hasConsent = true;
          try {
            hasConsent = Boolean(localStorage.getItem('hablar_mic_consented'));
          } catch {
            // localStorage unavailable — err on the safe side and wait for consent tap
            hasConsent = false;
          }
          if (!hasConsent) return;
          startVoiceRecording();
        }}
        onVoiceHoldEnd={(cancelled: boolean) => {
          if (cancelled) {
            closeVoiceOverlay();
          } else {
            stopVoiceRecording();
          }
        }}
        voiceState={uiVoiceState}
        budgetCapActive={budgetCapActive}
        micButtonRef={micButtonRef}
      />

      {/* Voice overlay — F091 */}
      <VoiceOverlay
        isOpen={isVoiceOverlayOpen}
        voiceState={uiVoiceState}
        errorCode={voiceError}
        onClose={closeVoiceOverlay}
        onStartRecording={startVoiceRecording}
        onStopRecording={stopVoiceRecording}
        selectedVoiceName={selectedVoiceName}
        ttsEnabled={ttsEnabled}
        onVoiceSelect={handleVoiceSelect}
        onTtsToggle={handleTtsToggle}
      />
    </div>
  );
}
