'use client';

// UsageMeter — F-WEB-TIER (AC30–AC34, W11)
// Compact daily-usage meter for logged-in users in the /hablar header.
//
// Desktop/tablet (≥sm): inline counters — "12/100 · 3/20 · 5/30"
// Mobile (<sm): icon button that opens a popover with all three buckets.
//
// Fetches GET /me/usage on mount; refreshes via onRefreshReady callback.
// Fires usage_meter_shown once on first successful data.
// Gracefully degrades: returns null on fetch failure or admin tier.
// Never blocks or errors the page.

import { useEffect, useRef, useState, useCallback } from 'react';
import { getActorId } from '@/lib/actorId';
import type { UsageResponse } from '@foodxplorer/shared';
import { getUsage } from '@/lib/apiClient';
import { trackEvent } from '@/lib/metrics';
import { useAuth } from '@/hooks/useAuth';

interface UsageMeterProps {
  /** HablarShell registers a callback here to trigger a counter re-fetch after success */
  onRefreshReady?: (refresh: () => void) => void;
}

type BucketKey = 'queries' | 'photos' | 'voice';

const BUCKET_LABELS: Record<BucketKey, string> = {
  queries: 'CONSUL.',
  photos: 'FOTOS',
  voice: 'VOZ',
};

const BUCKET_FULL_LABELS: Record<BucketKey, string> = {
  queries: 'Consultas',
  photos: 'Fotos',
  voice: 'Voz',
};

// Threshold helpers
function getUsageState(used: number, limit: number): 'normal' | 'low' | 'critical' {
  const remaining = limit - used;
  const pct = remaining / limit;
  if (pct < 0.2) return 'critical';
  if (pct < 0.4) return 'low';
  return 'normal';
}

const STATE_COLORS = {
  normal: 'text-slate-600',
  low: 'text-amber-600 text-sm font-bold',
  critical: 'text-red-500 text-sm font-bold',
};

const STATE_SUFFIX = {
  normal: '',
  low: ' !',
  critical: ' !!',
};

export function UsageMeter({ onRefreshReady }: UsageMeterProps): JSX.Element | null {
  const { user } = useAuth();
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const hasTrackedMeter = useRef(false);

  const fetchUsage = useCallback(async () => {
    if (!user) return;
    try {
      // F-WEB-HISTORY-FU1 (BUG-WEB-USAGEMETER-ACTOR-PARITY): pass the same
      // actorId HablarShell sends on /conversation/message so /me/usage reads
      // the SAME actor's Redis bucket. Without this header, the bearer fallback
      // resolves to a different actor and the meter shows a stale (often zero) count.
      const actorId = getActorId();
      const result = await getUsage(actorId);
      const data = result.data;
      setUsageData(data);
      setHasFailed(false);

      // Fire usage_meter_shown only on first successful render
      if (!hasTrackedMeter.current) {
        hasTrackedMeter.current = true;
        trackEvent('usage_meter_shown', { tier: data.tier });
      }
    } catch {
      setHasFailed(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void fetchUsage();
  }, [user, fetchUsage]);

  // Register the refresh callback with HablarShell
  useEffect(() => {
    if (!onRefreshReady) return;
    onRefreshReady(fetchUsage);
  }, [onRefreshReady, fetchUsage]);

  // Not logged in — never show the meter
  if (!user) return null;

  // Admin tier or fetch failure — render null (no quota chrome)
  if (!usageData || hasFailed) return null;

  // Admin: all limits are null — hide meter
  if (usageData.tier === 'admin' || usageData.buckets.queries.limit === null) {
    return null;
  }

  const buckets = usageData.buckets;

  // Build aria-label for screen readers
  const ariaLabel = [
    `Consultas ${buckets.queries.used} de ${buckets.queries.limit}`,
    `Fotos ${buckets.photos.used} de ${buckets.photos.limit}`,
    `Voz ${buckets.voice.used} de ${buckets.voice.limit}`,
  ].join(', ');

  // Determine overall worst state for mobile icon indicator
  const allStates = (['queries', 'photos', 'voice'] as BucketKey[]).map((k) => {
    const b = buckets[k];
    return b.limit != null ? getUsageState(b.used, b.limit) : 'normal';
  });
  const hasLow = allStates.includes('low') || allStates.includes('critical');
  const hasCritical = allStates.includes('critical');
  const indicatorClass = hasCritical
    ? 'bg-red-500'
    : hasLow
    ? 'bg-amber-400'
    : null;

  return (
    <div
      role="status"
      aria-label={`Uso diario: ${ariaLabel}`}
      className="flex items-center"
    >
      {/* Desktop/tablet (≥sm): inline counter groups */}
      <div className="hidden sm:inline-flex items-center gap-0 mr-3">
        {(['queries', 'photos', 'voice'] as BucketKey[]).map((key, idx) => {
          const bucket = buckets[key];
          const limit = bucket.limit ?? 0;
          const state = getUsageState(bucket.used, limit);
          const countClass = STATE_COLORS[state];
          const suffix = STATE_SUFFIX[state];

          return (
            <div key={key} className="flex items-center">
              {idx > 0 && (
                <div className="w-px h-6 bg-slate-200 self-center mx-1" aria-hidden="true" />
              )}
              <div className="flex flex-col items-center px-2.5" aria-hidden="true">
                <span className="text-[10px] font-medium text-slate-400 leading-none mb-0.5 uppercase tracking-wide">
                  {BUCKET_LABELS[key]}
                  {suffix && (
                    <span aria-hidden="true">{suffix}</span>
                  )}
                </span>
                <span
                  data-testid="usage-count"
                  className={`text-xs font-semibold leading-none tabular-nums transition-all duration-300 ${countClass}`}
                >
                  {bucket.used}/{limit}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile (<sm): icon button with popover */}
      <div className="sm:hidden relative">
        <button
          type="button"
          aria-label={
            hasCritical
              ? 'Ver uso diario: consultas casi agotadas'
              : hasLow
              ? 'Ver uso diario: pocas consultas restantes'
              : 'Ver uso diario'
          }
          onClick={() => setIsPopoverOpen((prev) => !prev)}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          {/* Stacked-bars usage icon (three horizontal bars of decreasing width) */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="14" y2="10" />
            <line x1="3" y1="15" x2="10" y2="15" />
          </svg>
          {/* Indicator dot for low/critical state */}
          {indicatorClass && (
            <span
              aria-hidden="true"
              className={`absolute top-0 right-0 h-2 w-2 rounded-full ${indicatorClass}`}
            />
          )}
        </button>

        {/* Mobile popover */}
        {isPopoverOpen && (
          <div
            className="absolute right-0 z-50 mt-2 w-[200px] rounded-xl border border-slate-100 bg-white py-3 px-4 shadow-lg text-left"
            role="tooltip"
          >
            {(['queries', 'photos', 'voice'] as BucketKey[]).map((key) => {
              const bucket = buckets[key];
              return (
                <div key={key} className="mb-2 last:mb-0">
                  <p className="text-xs font-semibold text-slate-700 mb-0.5">
                    {BUCKET_FULL_LABELS[key]}
                  </p>
                  <p className="text-xs text-slate-500">
                    Usadas hoy: {bucket.used} de {bucket.limit}
                  </p>
                  <p className="text-xs text-slate-500">
                    Te quedan: {bucket.remaining}
                  </p>
                </div>
              );
            })}
            <p className="text-[11px] text-slate-400 mt-2 border-t border-slate-100 pt-2">
              Se reinicia: mañana
            </p>
            <p className="text-[11px] text-slate-400 mt-1 border-t border-slate-100 pt-1">
              Plan gratuito · 100 consultas, 20 fotos, 30 voz por día
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
