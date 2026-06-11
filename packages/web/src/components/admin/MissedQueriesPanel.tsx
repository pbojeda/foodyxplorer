'use client';

// MissedQueriesPanel — Panel A of the admin analytics dashboard.
// F-ADMIN-ANALYTICS-UI.
// Design spec: W28 (panel container), W29 (filter controls), W30 (tables), W31 (actions).

import React, { useState, useEffect, useCallback } from 'react';
import type {
  MissedQueriesResponse,
  MissedQueryStatus,
  AnalyticsTimeRange,
  BatchTrackBody,
} from '@foodxplorer/shared';
import {
  getMissedQueries,
  trackMissedQueries,
  updateMissedQueryStatus,
} from '@/lib/apiClient';
import { trackEvent } from '@/lib/metrics';
import { useT } from '@/lib/i18n/useT';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RowUpdate {
  status: MissedQueryStatus | null;
  trackingId: string | null;
  isUpdating: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MissedQueriesPanel() {
  const t = useT('admin');

  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('7d');
  const [topN, setTopN] = useState(20);
  const [topNInput, setTopNInput] = useState('20');
  const [minCount, setMinCount] = useState(1);
  const [minCountInput, setMinCountInput] = useState('1');

  const [data, setData] = useState<MissedQueriesResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-row optimistic updates keyed by queryText
  const [rowUpdates, setRowUpdates] = useState<Map<string, RowUpdate>>(new Map());

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async (
    range: AnalyticsTimeRange,
    n: number,
    min: number,
  ) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const result = await getMissedQueries({ timeRange: range, topN: n, minCount: min });
      setData(result);
      trackEvent('admin_panel_loaded', { panel: 'missed-queries' });
    } catch {
      setFetchError(t('panel.missedQueries.error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchData(timeRange, topN, minCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

  function handleTimeRange(range: AnalyticsTimeRange) {
    setTimeRange(range);
    void fetchData(range, topN, minCount);
  }

  function handleTopNBlur() {
    const val = parseInt(topNInput, 10);
    if (!isNaN(val) && val >= 1 && val <= 100) {
      setTopN(val);
      void fetchData(timeRange, val, minCount);
    } else {
      setTopNInput(String(topN)); // reset invalid
    }
  }

  function handleMinCountBlur() {
    const val = parseInt(minCountInput, 10);
    if (!isNaN(val) && val >= 1) {
      setMinCount(val);
      void fetchData(timeRange, topN, val);
    } else {
      setMinCountInput(String(minCount)); // reset invalid
    }
  }

  // ---------------------------------------------------------------------------
  // Row action handler
  // ---------------------------------------------------------------------------

  async function handleAction(
    queryText: string,
    baseCount: number,
    nextStatus: MissedQueryStatus,
  ) {
    // Resolve effective tracking state
    const currentUpdate = rowUpdates.get(queryText);
    const row = data?.missedQueries.find((q) => q.queryText === queryText);
    const effectiveTrackingId = currentUpdate?.trackingId ?? row?.trackingId ?? null;
    const priorStatus = currentUpdate?.status ?? row?.trackingStatus ?? null;

    // Optimistic update
    setRowUpdates((prev) => {
      const next = new Map(prev);
      next.set(queryText, {
        status: nextStatus,
        trackingId: effectiveTrackingId,
        isUpdating: true,
        error: null,
      });
      return next;
    });

    try {
      let resolvedTrackingId = effectiveTrackingId;

      // Two-step for untracked rows
      if (resolvedTrackingId === null) {
        const queries: BatchTrackBody['queries'] = [{ queryText, hitCount: baseCount }];
        const tracked = await trackMissedQueries(queries);
        resolvedTrackingId = tracked[0]?.id ?? null;

        // Update trackingId after track call
        setRowUpdates((prev) => {
          const next = new Map(prev);
          const existing = next.get(queryText);
          if (existing) {
            next.set(queryText, { ...existing, trackingId: resolvedTrackingId });
          }
          return next;
        });
      }

      // Status update
      if (resolvedTrackingId) {
        await updateMissedQueryStatus(resolvedTrackingId, { status: nextStatus });
      }

      trackEvent('admin_tracking_action', {
        action: nextStatus === 'pending' ? 'investigating' : (nextStatus as 'resolved' | 'ignored'),
      });

      // Success: clear isUpdating
      setRowUpdates((prev) => {
        const next = new Map(prev);
        next.set(queryText, {
          status: nextStatus,
          trackingId: resolvedTrackingId,
          isUpdating: false,
          error: null,
        });
        return next;
      });
    } catch {
      // Revert to prior status
      setRowUpdates((prev) => {
        const next = new Map(prev);
        next.set(queryText, {
          status: priorStatus,
          trackingId: effectiveTrackingId,
          isUpdating: false,
          error: t('panel.missedQueries.actionError'),
        });
        return next;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function getEffectiveStatus(queryText: string, baseStatus: MissedQueryStatus | null) {
    return rowUpdates.get(queryText)?.status ?? baseStatus;
  }

  function renderStatusBadge(status: MissedQueryStatus | null) {
    if (!status) return <span className="text-slate-300">—</span>;
    const classes: Record<MissedQueryStatus, string> = {
      pending: 'bg-amber-50 text-amber-700 border border-amber-200',
      resolved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      ignored: 'bg-slate-100 text-slate-500 border border-slate-200',
    };
    const labels: Record<MissedQueryStatus, string> = {
      pending: t('common.badge.pending'),
      resolved: t('common.badge.resolved'),
      ignored: t('common.badge.ignored'),
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${classes[status]}`}>
        {labels[status]}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const timeRanges: { label: string; value: AnalyticsTimeRange }[] = [
    { label: t('common.timeRange.24h'), value: '24h' },
    { label: t('common.timeRange.7d'), value: '7d' },
    { label: t('common.timeRange.30d'), value: '30d' },
    { label: t('common.timeRange.all'), value: 'all' },
  ];

  return (
    <section className="bg-white rounded-2xl border border-slate-100 mb-8">
      {/* Panel header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-800">{t('panel.missedQueries.title')}</h2>

        {/* Filter bar */}
        <div className="flex items-center flex-wrap gap-3">
          {/* TimeRange segmented control */}
          <div
            className="inline-flex rounded-lg border border-slate-200 overflow-hidden"
            role="group"
            aria-label="Período de tiempo"
          >
            {timeRanges.map((tr, i) => (
              <button
                key={tr.value}
                type="button"
                aria-pressed={timeRange === tr.value}
                disabled={isLoading}
                onClick={() => handleTimeRange(tr.value)}
                className={[
                  'px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
                  i < timeRanges.length - 1 ? 'border-r border-slate-200' : '',
                  timeRange === tr.value
                    ? 'bg-brand-green text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                  isLoading ? 'opacity-50 pointer-events-none' : '',
                ].join(' ')}
              >
                {tr.label}
              </button>
            ))}
          </div>

          {/* Top N */}
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              {t('panel.missedQueries.filterTopN')}
            </span>
            <input
              type="number"
              value={topNInput}
              min={1}
              max={100}
              disabled={isLoading}
              onChange={(e) => setTopNInput(e.target.value)}
              onBlur={handleTopNBlur}
              className="w-16 h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-center text-slate-700 focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 focus:outline-none disabled:opacity-50"
            />
          </label>

          {/* Min Count */}
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              {t('panel.missedQueries.filterMinCount')}
            </span>
            <input
              type="number"
              value={minCountInput}
              min={1}
              disabled={isLoading}
              onChange={(e) => setMinCountInput(e.target.value)}
              onBlur={handleMinCountBlur}
              className="w-16 h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-center text-slate-700 focus:border-brand-green focus:ring-2 focus:ring-brand-green/15 focus:outline-none disabled:opacity-50"
            />
          </label>
        </div>
      </div>

      {/* Panel body */}
      <div className="px-5 py-5">
        {/* Error state */}
        {fetchError && !isLoading && (
          <div className="w-full px-4 py-4">
            <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-red-400 flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span className="text-sm font-medium text-red-700">{fetchError}</span>
              <button
                type="button"
                onClick={() => void fetchData(timeRange, topN, minCount)}
                className="ml-auto text-sm font-medium text-red-600 underline underline-offset-2 hover:text-red-800 cursor-pointer"
              >
                {t('common.retry')}
              </button>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">{t('panel.missedQueries.col.query')}</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-right">{t('panel.missedQueries.col.count')}</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">{t('panel.missedQueries.col.status')}</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">{t('panel.missedQueries.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="h-12 border-b border-slate-50">
                  <td className="px-4 py-3"><div className="shimmer-element h-4 w-48 rounded-md" /></td>
                  <td className="px-4 py-3"><div className="shimmer-element h-4 w-8 rounded-md" /></td>
                  <td className="px-4 py-3"><div className="shimmer-element h-5 w-16 rounded-full" /></td>
                  <td className="px-4 py-3"><div className="shimmer-element h-7 w-24 rounded-lg" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Data table */}
        {!isLoading && !fetchError && data && (
          <>
            {data.missedQueries.length === 0 ? (
              /* Empty state */
              <div className="w-full py-16 flex flex-col items-center justify-center text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 mb-3" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                <p className="text-[15px] font-medium text-slate-500 max-w-xs">
                  {t('panel.missedQueries.empty')}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">{t('panel.missedQueries.col.query')}</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-right">{t('panel.missedQueries.col.count')}</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left">{t('panel.missedQueries.col.status')}</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 text-left w-56 min-w-[224px]">{t('panel.missedQueries.col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.missedQueries.map((row) => {
                      const update = rowUpdates.get(row.queryText);
                      const effectiveStatus = getEffectiveStatus(row.queryText, row.trackingStatus);
                      const isUpdating = update?.isUpdating ?? false;
                      const rowError = update?.error ?? null;

                      const actionButtons: { label: string; status: MissedQueryStatus }[] = [
                        { label: t('panel.missedQueries.action.track'), status: 'pending' },
                        { label: t('panel.missedQueries.action.resolve'), status: 'resolved' },
                        { label: t('panel.missedQueries.action.ignore'), status: 'ignored' },
                      ];

                      const activeClasses: Record<MissedQueryStatus, string> = {
                        pending: 'bg-amber-50 text-amber-700',
                        resolved: 'bg-emerald-50 text-emerald-700',
                        ignored: 'bg-slate-100 text-slate-500',
                      };

                      return (
                        <React.Fragment key={row.queryText}>
                          <tr
                            className={[
                              'h-12 border-b border-slate-50 transition-colors duration-200',
                              isUpdating ? 'bg-amber-50/30' : '',
                            ].join(' ')}
                          >
                            {/* queryText — truncated at 80 chars */}
                            <td className="px-4 py-3 max-w-[300px]">
                              <span
                                className="truncate block text-sm text-slate-700"
                                title={row.queryText}
                              >
                                {row.queryText.length > 80
                                  ? row.queryText.slice(0, 80) + '…'
                                  : row.queryText}
                              </span>
                            </td>

                            {/* count */}
                            <td className="px-4 py-3 text-right tabular-nums text-sm text-slate-700">
                              {row.count}
                            </td>

                            {/* status badge */}
                            <td className="px-4 py-3">
                              {renderStatusBadge(effectiveStatus)}
                            </td>

                            {/* action buttons */}
                            <td className="px-4 py-3 w-56 min-w-[224px]">
                              <div className={[
                                'inline-flex rounded-lg border border-slate-200 overflow-hidden',
                                isUpdating ? 'opacity-50 pointer-events-none' : '',
                              ].join(' ')}>
                                {actionButtons.map((btn, i) => (
                                  <button
                                    key={btn.status}
                                    type="button"
                                    onClick={() => void handleAction(row.queryText, row.count, btn.status)}
                                    className={[
                                      'px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                                      i < actionButtons.length - 1 ? 'border-r border-slate-200' : '',
                                      effectiveStatus === btn.status
                                        ? activeClasses[btn.status]
                                        : 'bg-white text-slate-600 hover:bg-slate-50',
                                    ].join(' ')}
                                  >
                                    {isUpdating && effectiveStatus === btn.status ? (
                                      <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" />
                                    ) : (
                                      btn.label
                                    )}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>

                          {/* Row-level error */}
                          {rowError && (
                            <tr className="border-b border-slate-50">
                              <td colSpan={4} className="px-4 pb-2 pt-0">
                                <span className="text-[11px] text-red-500">{rowError}</span>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
