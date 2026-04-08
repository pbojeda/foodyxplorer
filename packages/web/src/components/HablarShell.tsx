'use client';

// HablarShell — top-level client orchestrator for /hablar.
// Manages all page state: query, loading, results, error, inlineError.
// Uses useRef<AbortController | null> for stale request guard.

import { useState, useRef, useCallback } from 'react';
import type { ConversationMessageData } from '@foodxplorer/shared';
import { getActorId } from '@/lib/actorId';
import { sendMessage, ApiError } from '@/lib/apiClient';
import { ConversationInput } from './ConversationInput';
import { ResultsArea } from './ResultsArea';

export function HablarShell() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ConversationMessageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');

  // Ref to track the current in-flight AbortController for stale request guard
  const currentRequestRef = useRef<AbortController | null>(null);

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

    try {
      const actorId = getActorId();
      const response = await sendMessage(text, actorId, controller.signal);

      // Stale response guard — controller may have been replaced by a newer request
      if (controller.signal.aborted) return;

      const data = response.data;

      // Handle text_too_long inline (not full-screen ErrorState)
      if (data.intent === 'text_too_long') {
        setInlineError('Demasiado largo. Máx. 500 caracteres.');
        setResults(null);
        return;
      }

      setResults(data);
    } catch (err) {
      // AbortError from stale request guard or user-triggered abort — silently ignore
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      // TimeoutError from AbortSignal.timeout(15000) — show specific message
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        if (!controller.signal.aborted) {
          setError('La consulta ha tardado demasiado. Inténtalo de nuevo.');
          setResults(null);
        }
        return;
      }
      // Double-check for race condition
      if (controller.signal.aborted) return;

      // Map ApiError to user-friendly Spanish message
      if (err instanceof ApiError) {
        if (err.code === 'RATE_LIMIT_EXCEEDED') {
          setError('Has alcanzado el límite diario de 50 consultas. Vuelve mañana.');
        } else if (err.code === 'NETWORK_ERROR') {
          setError(err.message.includes('Sin conexión')
            ? err.message
            : 'Sin conexión. Comprueba tu red.');
        } else {
          setError(err.message || 'Algo salió mal. Inténtalo de nuevo.');
        }
      } else {
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

  function handleSubmit() {
    executeQuery(query);
  }

  function handleRetry() {
    if (lastQuery) {
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
      />

      {/* Fixed bottom input */}
      <ConversationInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        inlineError={inlineError}
      />
    </div>
  );
}
