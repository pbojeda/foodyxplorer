// Usage metrics tracking for the /hablar web assistant.
//
// Tracks: query count, intent distribution, response times, error rates, retries.
// Persists session aggregates to localStorage. Flushes via sendBeacon on demand.
// Privacy-first: no PII, no query text — only aggregate counts and timings.

const STORAGE_KEY = 'fxp_metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricEvent =
  | 'query_sent'
  | 'query_success'
  | 'query_error'
  | 'query_retry'
  | 'photo_sent'
  | 'photo_success'
  | 'photo_error'
  | 'photo_resize_ok'
  | 'photo_resize_fallback'
  | 'voice_start'
  | 'voice_success'
  | 'voice_error';

export interface MetricPayload {
  intent?: string;
  responseTimeMs?: number;
  errorCode?: string;
  dishCount?: number;
  originalKB?: number;
  resizedKB?: number;
}

export interface MetricsSnapshot {
  queryCount: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  intents: Record<string, number>;
  errors: Record<string, number>;
  avgResponseTimeMs: number;
  sessionStartedAt: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface MetricsState {
  queryCount: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  intents: Record<string, number>;
  errors: Record<string, number>;
  totalResponseTimeMs: number;
  sessionStartedAt: string;
}

function createEmptyState(): MetricsState {
  return {
    queryCount: 0,
    successCount: 0,
    errorCount: 0,
    retryCount: 0,
    intents: {},
    errors: {},
    totalResponseTimeMs: 0,
    sessionStartedAt: new Date().toISOString(),
  };
}

let state: MetricsState = loadFromStorage() ?? createEmptyState();

// ---------------------------------------------------------------------------
// Subscription (for useSyncExternalStore)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedSnapshot: MetricsSnapshot | null = null;

function notify(): void {
  cachedSnapshot = null; // invalidate cache
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadFromStorage(): MetricsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.queryCount !== 'number') return null;
    return parsed as MetricsState;
  } catch {
    return null;
  }
}

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage unavailable — silent fail
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function trackEvent(event: MetricEvent, payload?: MetricPayload): void {
  switch (event) {
    case 'query_sent':
      state.queryCount++;
      break;

    case 'query_success':
      state.successCount++;
      if (payload?.intent) {
        state.intents[payload.intent] = (state.intents[payload.intent] ?? 0) + 1;
      }
      if (payload?.responseTimeMs != null) {
        state.totalResponseTimeMs += payload.responseTimeMs;
      }
      break;

    case 'query_error':
      state.errorCount++;
      if (payload?.errorCode) {
        state.errors[payload.errorCode] = (state.errors[payload.errorCode] ?? 0) + 1;
      }
      break;

    case 'query_retry':
      state.retryCount++;
      break;

    case 'photo_sent':
      state.queryCount++;
      break;

    case 'photo_success':
      state.successCount++;
      if (payload?.responseTimeMs != null) {
        state.totalResponseTimeMs += payload.responseTimeMs;
      }
      break;

    case 'photo_error':
      state.errorCount++;
      if (payload?.errorCode) {
        state.errors[payload.errorCode] = (state.errors[payload.errorCode] ?? 0) + 1;
      }
      break;

    case 'voice_start':
      state.queryCount++;
      break;

    case 'voice_success':
      state.successCount++;
      if (payload?.intent) {
        state.intents[payload.intent] = (state.intents[payload.intent] ?? 0) + 1;
      }
      if (payload?.responseTimeMs != null) {
        state.totalResponseTimeMs += payload.responseTimeMs;
      }
      break;

    case 'voice_error':
      state.errorCount++;
      if (payload?.errorCode) {
        state.errors[payload.errorCode] = (state.errors[payload.errorCode] ?? 0) + 1;
      }
      break;
  }

  saveToStorage();
  notify();
}

export function getMetrics(): MetricsSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  cachedSnapshot = {
    queryCount: state.queryCount,
    successCount: state.successCount,
    errorCount: state.errorCount,
    retryCount: state.retryCount,
    intents: { ...state.intents },
    errors: { ...state.errors },
    avgResponseTimeMs:
      state.successCount > 0
        ? Math.round(state.totalResponseTimeMs / state.successCount)
        : 0,
    sessionStartedAt: state.sessionStartedAt,
  };
  return cachedSnapshot;
}

export function resetMetrics(): void {
  state = createEmptyState();
  cachedSnapshot = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silent
  }
  notify();
}

// flushMetrics sends the current session snapshot via navigator.sendBeacon.
// Disabled by default — only activates when NEXT_PUBLIC_METRICS_ENDPOINT is set.
// This is the hook for F113 (POST /analytics/web-events backend endpoint).
export function flushMetrics(): void {
  const endpoint = process.env['NEXT_PUBLIC_METRICS_ENDPOINT'];
  if (!endpoint) return;
  if (state.queryCount === 0) return;

  const snapshot = getMetrics();
  const sent = navigator.sendBeacon(endpoint, JSON.stringify(snapshot));
  if (sent) {
    resetMetrics();
  }
}
