/**
 * debugScroll — query-param-gated console logging for the TranscriptFeed
 * hydration / loadMore / scroll-restore state machine.
 *
 * Activated by appending `?debug=scroll` to the URL. Zero overhead and zero
 * output otherwise (the guard short-circuits to a no-op). NOT for production
 * telemetry; this is a diagnostic helper to gather empirical data on real-
 * browser behavior when jsdom + cross-model review have proved insufficient.
 *
 * Usage:
 *   import { dlog, isDebugScroll } from '@/lib/debugScroll';
 *   dlog('hydration', { scrollTop, scrollHeight });
 *   // — produces: [scroll-debug 12.345ms] hydration { scrollTop: …, … }
 */

let _enabledCache: boolean | null = null;

export function isDebugScroll(): boolean {
  if (typeof window === 'undefined') return false;
  if (_enabledCache !== null) return _enabledCache;
  try {
    const params = new URLSearchParams(window.location.search);
    _enabledCache = params.get('debug') === 'scroll';
  } catch {
    _enabledCache = false;
  }
  return _enabledCache;
}

const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

export function dlog(tag: string, data?: unknown): void {
  if (!isDebugScroll()) return;
  const dt =
    typeof performance !== 'undefined'
      ? (performance.now() - t0).toFixed(1) + 'ms'
      : '?';
  if (data !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[scroll-debug ${dt}] ${tag}`, data);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[scroll-debug ${dt}] ${tag}`);
  }
}
