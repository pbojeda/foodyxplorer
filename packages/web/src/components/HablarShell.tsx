'use client';

// HablarShell — top-level client orchestrator for /hablar.
// F-WEB-HISTORY: singleton results state replaced with append-only entries feed.
//   - results/photoResults/error/isLoading/photoMode/voiceError/lastQuery/inlineError
//     replaced by entries: TranscriptEntryData[] (TranscriptFeed renders the feed).
//   - useSearchHistory provides persistedEntries for logged-in users.
//   - HistoryPersistenceNudge shown after ≥2 entries for anonymous users.
//   - Preserved unchanged: LoginCta/UsageMeter/RateLimitNudge/usageRefreshRef/
//     dynamic-429/VoiceOverlay/ConversationInput/header auth slot.
// F-WEB-HISTORY-FU6: state split — sessionEntries (local) + persistedEntries (hook).
//   - allEntries = useMemo([persistedEntries, sessionEntries]) — synchronous derivation.
//   - Mount gate: TranscriptFeed not mounted while authLoading||(user&&isLoadingHistory).
//   - handleClearAll: only clearPersistedHistory() — sessionEntries preserved (AC2 sub-bullet).

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ConversationMessageData, MenuAnalysisData } from '@foodxplorer/shared';
import type { VoiceBudgetData, VoiceErrorCode, VoiceState } from '@/types/voice';
import type { TranscriptEntryData } from '@/types/history';
import { getActorId } from '@/lib/actorId';
import { sendMessage, sendPhotoAnalysis, setAuthToken, ApiError } from '@/lib/apiClient';
import { resizeImageForUpload } from '@/lib/imageResize';
import { trackEvent, flushMetrics } from '@/lib/metrics';
import { useAuth } from '@/hooks/useAuth';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { useTtsPlayback } from '@/hooks/useTtsPlayback';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { ConversationInput } from './ConversationInput';
import { TranscriptFeed } from './TranscriptFeed';
import { UserMenu } from './UserMenu';
import { VoiceOverlay } from './VoiceOverlay';
import { LoginCta } from './LoginCta';
import { UsageMeter } from './UsageMeter';
import { RateLimitNudge } from './RateLimitNudge';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const VALID_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------

function createPendingEntry(
  queryText: string,
  inputMode: 'text' | 'voice' | 'photo',
): TranscriptEntryData {
  return {
    entryId: crypto.randomUUID(),
    queryText,
    inputMode,
    timestamp: new Date(),
    isLoading: true,
    result: null,
    photoData: null,
    error: null,
    isPersisted: false,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HablarShell() {
  const [query, setQuery] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  // F-WEB-HISTORY-FU6 state split: session-owned slice only.
  // persistedEntries come directly from useSearchHistory (no local mirror).
  // allEntries = useMemo([persistedEntries, sessionEntries]) — synchronous derivation.
  const [sessionEntries, setSessionEntries] = useState<TranscriptEntryData[]>([]);

  // Persistence nudge dismissed state
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // F-WEB-MENU-VISION-001 — photo analysis mode toggle (session-only, not persisted)
  // F-WEB-HISTORY-FU1 (item D): default mode is 'identify' (single-dish path is the common case).
  const [photoAnalysisMode, setPhotoAnalysisMode] = useState<'auto' | 'identify'>('identify');

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

  // F107a — auth integration (ADR-025 R3 §4+§6)
  const { user, session, loading: authLoading } = useAuth();

  // F-WEB-TIER: rate-limit nudge state (anonymous 429 prompt)
  const [showRateLimitNudge, setShowRateLimitNudge] = useState(false);

  // F-WEB-TIER: ref to UsageMeter refresh callback — registered by UsageMeter via onRefreshReady
  const usageRefreshRef = useRef<(() => void) | null>(null);

  // Sync Supabase session token to apiClient module state.
  useEffect(() => {
    setAuthToken(session?.access_token ?? null);
  }, [session]);

  // F-WEB-HISTORY: persisted history for logged-in users.
  const {
    persistedEntries,
    hasMoreHistory,
    isLoadingMore,
    isLoadingHistory,
    loadMore,
    deleteEntry: deletePersistedEntry,
    clearAll: clearPersistedHistory,
  } = useSearchHistory({ authToken: session?.access_token ?? null });

  // F-WEB-HISTORY-FU6: synchronous derivation of allEntries.
  // persistedEntries (oldest-first, hook contract W16) come first;
  // sessionEntries follow below so newest query stays at the bottom.
  const allEntries = useMemo(
    () => [...persistedEntries, ...sessionEntries],
    [persistedEntries, sessionEntries],
  );

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

  // Sync voice session results → feed entry (F091 + F-WEB-HISTORY)
  useEffect(() => {
    if (voiceSession.state === 'done' && voiceSession.lastResponse) {
      const data = voiceSession.lastResponse.data;
      setIsVoiceOverlayOpen(false);
      setVoiceError(null);
      trackEvent('voice_success', { intent: data.intent });
      // F-WEB-TIER: refresh usage meter after successful voice query (BUG-001)
      usageRefreshRef.current?.();

      // Append a new entry for the voice result.
      // Use transcribedText from the response if available (G-IMP/X2);
      // fall back to "Consulta por voz" placeholder.
      const queryText =
        (data as ConversationMessageData & { transcribedText?: string }).transcribedText ??
        'Consulta por voz';

      const newEntry: TranscriptEntryData = {
        entryId: crypto.randomUUID(),
        queryText,
        inputMode: 'voice',
        timestamp: new Date(),
        isLoading: false,
        result: data,
        photoData: null,
        error: null,
        isPersisted: false,
      };
      setSessionEntries((prev) => [...prev, newEntry]);

      // Speak a short summary — presentation layer only
      if (data.intent === 'estimation' && data.estimation?.result) {
        const result = data.estimation.result;
        const name = result.nameEs ?? result.name ?? 'este plato';
        const kcal = Math.round(result.nutrients.calories);
        tts.play(`${name} tiene aproximadamente ${kcal} kilocalorías.`);
      }
    }
  }, [voiceSession.state, voiceSession.lastResponse, tts]);

  // Sync voice errors → UI error code (F091).
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
        requestAnimationFrame(() => micButtonRef.current?.focus());

        // Add an error entry to the feed for persistent voice errors
        const errorEntry: TranscriptEntryData = {
          entryId: crypto.randomUUID(),
          queryText: 'Consulta por voz',
          inputMode: 'voice',
          timestamp: new Date(),
          isLoading: false,
          result: null,
          photoData: null,
          error: getVoiceErrorMessage(code),
          isPersisted: false,
        };
        setSessionEntries((prev) => [...prev, errorEntry]);
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

  // ---------------------------------------------------------------------------
  // executeQuery — text query flow (appends a new entry)
  // ---------------------------------------------------------------------------
  const executeQuery = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Abort any in-flight request
    currentRequestRef.current?.abort();
    const controller = new AbortController();
    currentRequestRef.current = controller;

    setInlineError(null);
    setShowRateLimitNudge(false);

    const startTime = Date.now();
    trackEvent('query_sent', { authenticated: !!user });

    // Append optimistic pending entry
    const pendingEntry = createPendingEntry(text, 'text');
    setSessionEntries((prev) => [...prev, pendingEntry]);

    try {
      const actorId = getActorId();
      const response = await sendMessage(text, actorId, controller.signal);

      if (controller.signal.aborted) return;

      const data = response.data;

      // Handle text_too_long inline (NOT as a TranscriptEntry — cross-model G-CRIT)
      if (data.intent === 'text_too_long') {
        trackEvent('query_success', {
          intent: 'text_too_long',
          responseTimeMs: Date.now() - startTime,
        });
        setInlineError('Demasiado largo. Máx. 500 caracteres.');
        // Remove the pending entry since no result is created for text_too_long
        setSessionEntries((prev) => prev.filter((e) => e.entryId !== pendingEntry.entryId));
        return;
      }

      trackEvent('query_success', {
        intent: data.intent,
        responseTimeMs: Date.now() - startTime,
        authenticated: !!user,
      });
      // Settle the pending entry with the result
      setSessionEntries((prev) =>
        prev.map((e) =>
          e.entryId === pendingEntry.entryId
            ? { ...e, isLoading: false, result: data }
            : e
        )
      );
      // F-WEB-TIER: refresh usage meter after successful query
      usageRefreshRef.current?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        if (!controller.signal.aborted) {
          trackEvent('query_error', { errorCode: 'TIMEOUT_ERROR' });
          setSessionEntries((prev) =>
            prev.map((e) =>
              e.entryId === pendingEntry.entryId
                ? { ...e, isLoading: false, error: 'La consulta ha tardado demasiado. Inténtalo de nuevo.' }
                : e
            )
          );
        }
        return;
      }
      if (controller.signal.aborted) return;

      let errorMessage = 'Algo salió mal. Inténtalo de nuevo.';
      if (err instanceof ApiError) {
        trackEvent('query_error', { errorCode: err.code });
        if (err.code === 'RATE_LIMIT_EXCEEDED') {
          // BUG-API-RATELIMIT-BEARER-001: the daily per-actor quota (actorRateLimit)
          // carries details.limit/resetAt; the global 15-min abuse limiter does NOT.
          // Only the daily case is a "límite diario … vuelve mañana"; a global hit is
          // transient ("espera unos minutos"). They share the RATE_LIMIT_EXCEEDED code.
          const limit = typeof err.details?.['limit'] === 'number' ? err.details['limit'] : null;
          if (limit !== null) {
            errorMessage = `Has alcanzado el límite diario de ${limit} consultas. Vuelve mañana.`;
          } else {
            errorMessage = 'Demasiadas peticiones en poco tiempo. Espera unos minutos e inténtalo de nuevo.';
          }
          if (user === null) {
            setShowRateLimitNudge(true);
          }
        } else if (err.code === 'TIMEOUT_ERROR') {
          errorMessage = 'La consulta ha tardado demasiado. Inténtalo de nuevo.';
        } else if (err.code === 'NETWORK_ERROR') {
          errorMessage = 'Sin conexión. Comprueba tu red.';
        } else {
          errorMessage = err.message || 'Algo salió mal. Inténtalo de nuevo.';
        }
      } else {
        trackEvent('query_error', { errorCode: 'UNKNOWN_ERROR' });
      }

      // Settle the pending entry with the error
      if (currentRequestRef.current === controller) {
        setSessionEntries((prev) =>
          prev.map((e) =>
            e.entryId === pendingEntry.entryId
              ? { ...e, isLoading: false, error: errorMessage }
              : e
          )
        );
      }
    }
  }, [user]);

  // ---------------------------------------------------------------------------
  // executePhotoAnalysis — photo flow (appends a new entry)
  // ---------------------------------------------------------------------------
  const executePhotoAnalysis = useCallback(async (file: File) => {
    if (authLoading) return;
    if (file.type !== '' && !VALID_MIME_TYPES.has(file.type)) {
      setInlineError('Formato no soportado. Usa JPEG, PNG o WebP.');
      trackEvent('photo_error', { errorCode: 'INVALID_FILE_TYPE' });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setInlineError('La foto es demasiado grande. Máximo 10 MB.');
      trackEvent('photo_error', { errorCode: 'FILE_TOO_LARGE' });
      return;
    }

    currentRequestRef.current?.abort('stale_request');
    const controller = new AbortController();
    currentRequestRef.current = controller;

    setInlineError(null);

    const startTime = Date.now();
    trackEvent('photo_sent', { authenticated: !!user });

    const pendingEntry = createPendingEntry('Analizando foto…', 'photo');
    // Remove any existing pending photo entries (stale requests whose promises never reject in tests)
    setSessionEntries((prev) => [
      ...prev.filter((e) => !(e.inputMode === 'photo' && e.isLoading)),
      pendingEntry,
    ]);

    try {
      const actorId = getActorId();
      const uploadFile = await resizeImageForUpload(file);
      if (uploadFile !== file) {
        trackEvent('photo_resize_ok', {
          originalKB: Math.round(file.size / 1024),
          resizedKB: Math.round(uploadFile.size / 1024),
        });
      } else if (file.size > 1.5 * 1024 * 1024) {
        trackEvent('photo_resize_fallback', { originalKB: Math.round(file.size / 1024) });
      }
      if (controller.signal.aborted) {
        // Remove stale pending entry — another request took over
        setSessionEntries((prev) => prev.filter((e) => e.entryId !== pendingEntry.entryId));
        return;
      }
      const response = await sendPhotoAnalysis(uploadFile, actorId, controller.signal, photoAnalysisMode);

      if (controller.signal.aborted) return;

      const data: MenuAnalysisData = response.data;

      // F-WEB-MENU-VISION-001: track multi-dish event
      if (data.dishCount > 1) {
        trackEvent('menu_dish_list_shown', {
          dishCount: data.dishCount,
          partial: data.partial,
        });
      }

      trackEvent('photo_success', {
        dishCount: data.dishCount,
        responseTimeMs: Date.now() - startTime,
        authenticated: !!user,
      });

      // Settle entry with photo result
      setSessionEntries((prev) =>
        prev.map((e) =>
          e.entryId === pendingEntry.entryId
            ? { ...e, isLoading: false, photoData: data }
            : e
        )
      );
      usageRefreshRef.current?.();
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === 'AbortError' &&
        controller.signal.reason === 'stale_request'
      ) {
        // Remove stale pending entry — another request took over
        setSessionEntries((prev) => prev.filter((e) => e.entryId !== pendingEntry.entryId));
        return;
      }
      if (controller.signal.aborted) {
        setSessionEntries((prev) => prev.filter((e) => e.entryId !== pendingEntry.entryId));
        return;
      }

      let errorMessage = 'No se pudo analizar la foto. Inténtalo de nuevo.';
      if (err instanceof DOMException && err.name === 'AbortError') {
        trackEvent('photo_error', { errorCode: 'CLIENT_TIMEOUT' });
        errorMessage = 'El análisis ha tardado demasiado. Inténtalo de nuevo.';
      } else if (err instanceof ApiError) {
        trackEvent('photo_error', { errorCode: err.code });
        switch (err.code) {
          case 'INVALID_IMAGE':
            errorMessage = 'Formato no soportado. Usa JPEG, PNG o WebP.';
            break;
          case 'MENU_ANALYSIS_FAILED':
            errorMessage =
              photoAnalysisMode === 'auto'
                ? "No he podido leer el menú. Prueba con otra foto o elige 'Solo este plato'."
                : 'No he podido identificar el plato. Prueba con otra foto o asegúrate de que el plato sea visible.';
            break;
          case 'PAYLOAD_TOO_LARGE':
            errorMessage = 'La foto es demasiado grande. Máximo 10 MB.';
            break;
          case 'RATE_LIMIT_EXCEEDED':
            errorMessage = 'Has alcanzado el límite de análisis por foto. Inténtalo más tarde.';
            break;
          case 'UNAUTHORIZED':
            errorMessage = 'Error de configuración. Contacta con soporte.';
            break;
          case 'PROCESSING_TIMEOUT':
          case 'TIMEOUT_ERROR':
            errorMessage = 'El análisis ha tardado demasiado. Inténtalo de nuevo.';
            break;
          case 'NETWORK_ERROR':
            errorMessage = 'Sin conexión. Comprueba tu red.';
            break;
        }
      } else {
        trackEvent('photo_error', { errorCode: 'UNKNOWN_ERROR' });
      }

      if (currentRequestRef.current === controller) {
        setSessionEntries((prev) =>
          prev.map((e) =>
            e.entryId === pendingEntry.entryId
              ? { ...e, isLoading: false, error: errorMessage }
              : e
          )
        );
      }
    }
  }, [photoAnalysisMode, authLoading, user]);

  // ---------------------------------------------------------------------------
  // handleDishSelect — dish tap in MenuDishList (photo → text follow-up)
  // ---------------------------------------------------------------------------
  const handleDishSelect = useCallback(
    (dishName: string) => {
      // Find the photo entry to snapshot dish info (search in allEntries — combined view)
      const photoEntry = [...allEntries].reverse().find((e) => e.inputMode === 'photo' && e.photoData);
      const dish = photoEntry?.photoData?.dishes.find((d) => d.dishName === dishName);
      const hasEstimate = dish?.estimate != null;
      trackEvent('menu_dish_selected', { dishName, hasEstimate });
      setQuery(dishName);
      executeQuery(dishName);
    },
    [allEntries, executeQuery],
  );

  function handleSubmit() {
    if (!query.trim()) return;
    if (authLoading) return;
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: 'hablar_query_sent' });
    executeQuery(query);
  }

  // handleRetry — retry appends a NEW entry (does not mutate the failed entry, per W19)
  const handleRetry = useCallback((queryText: string) => {
    trackEvent('query_retry');
    executeQuery(queryText);
  }, [executeQuery]);

  // ---------------------------------------------------------------------------
  // handleDeleteEntry — remove from feed + call API for persisted entries
  // ---------------------------------------------------------------------------
  const handleDeleteEntry = useCallback((entryId: string) => {
    // Remove from sessionEntries if present (session-owned entries)
    setSessionEntries((prev) => prev.filter((e) => e.entryId !== entryId));
    // Also call API delete for persisted entries (no-op if not persisted)
    deletePersistedEntry(entryId);
  }, [deletePersistedEntry]);

  // ---------------------------------------------------------------------------
  // handleClearAll — only clears persisted history; sessionEntries preserved (AC2 sub-bullet)
  // ---------------------------------------------------------------------------
  const handleClearAll = useCallback(() => {
    // Only clearPersistedHistory() — sessionEntries are independent and must not be wiped.
    // After clearPersistedHistory() resolves, useSearchHistory returns persistedEntries=[],
    // useMemo re-derives allEntries=[...[], ...sessionEntries].
    clearPersistedHistory();
  }, [clearPersistedHistory]);

  // ---------------------------------------------------------------------------
  // Nudge hierarchy (W20)
  // ---------------------------------------------------------------------------
  const showPersistenceNudge =
    allEntries.length >= 2 && !user && !showRateLimitNudge && !nudgeDismissed;

  // ---------------------------------------------------------------------------
  // Mount gate (AC1b): defer TranscriptFeed mount until history load is complete
  // for authenticated users. Anonymous users skip the gate (no persisted fetch).
  // During gate: render a placeholder with role="feed" aria-busy="true".
  // Post-gate: Virtuoso mounts ONCE with full hydrated allEntries array.
  // ---------------------------------------------------------------------------
  const isGated = authLoading || (!!user && isLoadingHistory);

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      {/* Minimal app bar — F-WEB-TIER: auth-slot dichotomy (W9) */}
      <header className="flex h-[52px] flex-shrink-0 items-center border-b border-slate-100 bg-white px-4">
        <span className="text-base font-bold text-brand-green">nutriXplorer</span>
        {!authLoading && !user && <LoginCta />}
        {!authLoading && user && (
          <div className="flex items-center gap-2 ml-auto">
            <UsageMeter onRefreshReady={(fn) => { usageRefreshRef.current = fn; }} />
            <UserMenu user={user} />
          </div>
        )}
      </header>

      {/* Mount gate: render placeholder while history is loading for auth'd users */}
      {isGated ? (
        <div
          role="feed"
          aria-busy="true"
          aria-label="Historial de consultas"
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 lg:max-w-2xl lg:mx-auto w-full"
        />
      ) : (
        /* Transcript feed — scrollable, replaces ResultsArea */
        <TranscriptFeed
          entries={allEntries}
          isAuthenticated={!!user}
          isLoadingHistory={isLoadingHistory}
          hasMoreHistory={hasMoreHistory}
          isLoadingMore={isLoadingMore}
          showPersistenceNudge={showPersistenceNudge}
          onDismissPersistenceNudge={() => setNudgeDismissed(true)}
          onLoadMore={loadMore}
          onDeleteEntry={handleDeleteEntry}
          onClearAll={handleClearAll}
          onRetry={handleRetry}
          onDishSelect={handleDishSelect}
        />
      )}

      {/* F-WEB-TIER P-I2: RateLimitNudge as sibling below TranscriptFeed. */}
      {showRateLimitNudge && !user && (
        <div className="px-4 pb-2">
          <RateLimitNudge onSignUpClick={() => setShowRateLimitNudge(false)} />
        </div>
      )}

      {/* In-column bottom input (ADR-030: not position:fixed) */}
      <ConversationInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        onPhotoSelect={executePhotoAnalysis}
        isLoading={sessionEntries.some((e) => e.isLoading && e.inputMode === 'text')}
        isPhotoLoading={sessionEntries.some((e) => e.isLoading && e.inputMode === 'photo')}
        inlineError={inlineError}
        photoAnalysisMode={photoAnalysisMode}
        onPhotoModeChange={(mode) => {
          trackEvent('photo_mode_selected', { mode });
          setPhotoAnalysisMode(mode);
        }}
        onVoiceTap={openVoiceOverlay}
        onVoiceHoldStart={() => {
          if (budgetCapActive) return;
          trackEvent('voice_start');
          setVoiceError(null);
          setIsVoiceOverlayOpen(true);
          let hasConsent = true;
          try {
            hasConsent = Boolean(localStorage.getItem('hablar_mic_consented'));
          } catch {
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

// ---------------------------------------------------------------------------
// Voice error message helper
// ---------------------------------------------------------------------------

function getVoiceErrorMessage(code: VoiceErrorCode): string {
  switch (code) {
    case 'budget_cap':
      return 'La búsqueda por voz está temporalmente desactivada este mes. Sigue usando texto o foto con normalidad.';
    case 'rate_limit':
      return 'Has alcanzado el límite de búsquedas por voz por hoy. Inténtalo mañana o usa el texto.';
    case 'ip_limit':
      return 'Has alcanzado el límite diario de voz desde esta red. Inténtalo mañana o usa el texto.';
    case 'whisper_failure':
      return 'No pudimos procesar tu audio. Inténtalo de nuevo.';
    case 'network':
      return 'Sin conexión. Comprueba tu red.';
    default:
      return 'Algo salió mal con la búsqueda por voz.';
  }
}
