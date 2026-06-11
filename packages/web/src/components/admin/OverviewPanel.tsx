'use client';

// OverviewPanel — Panel C of the admin analytics dashboard.
// F-ADMIN-ANALYTICS-UI.
// Design spec: W28 (panel container), W33 (cards, distributions, mini-tables).
// Uses Promise.allSettled for parallel independent fetches.

import React, { useState, useEffect, useCallback } from 'react';
import type { AnalyticsData, WebMetricsAggregate, AnalyticsTimeRange } from '@foodxplorer/shared';
import { getQueriesAnalytics, getWebMetricsAnalytics } from '@/lib/apiClient';
import { useT } from '@/lib/i18n/useT';
import { trackEvent } from '@/lib/metrics';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ScalarCardProps {
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
}

function ScalarCard({ label, value, caption, accent = false }: ScalarCardProps) {
  return (
    <div
      className={[
        'rounded-2xl border p-5',
        accent
          ? 'border-brand-green/20 bg-mist/30'
          : 'bg-white border-slate-100',
      ].join(' ')}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </p>
      <p
        className={[
          'text-[32px] font-extrabold leading-none',
          accent ? 'text-brand-green' : 'text-slate-800',
        ].join(' ')}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-1.5">{caption}</p>
    </div>
  );
}

interface ByLevelBarProps {
  levels: AnalyticsData['byLevel'];
  totalQueries: number;
  t: (key: string) => string;
}

function ByLevelBars({ levels, totalQueries, t }: ByLevelBarProps) {
  const entries: { key: keyof AnalyticsData['byLevel']; color: string }[] = [
    { key: 'l1', color: 'bg-emerald-400' },
    { key: 'l2', color: 'bg-[#2D5A27]' },
    { key: 'l3', color: 'bg-amber-400' },
    { key: 'l4', color: 'bg-orange-400' },
    { key: 'miss', color: 'bg-red-400' },
  ];

  return (
    <div>
      {entries.map(({ key, color }) => {
        const count = levels[key];
        const pct = totalQueries > 0 ? Math.round((count / totalQueries) * 100) : 0;
        return (
          <div key={key} className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium text-slate-500 w-8 text-right">
              {t(`panel.overview.level.${key}`)}
            </span>
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div
                className={`${color} h-2 rounded-full transition-all duration-500 ease-out`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 w-20 text-right tabular-nums">
              {count} ({pct}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface BySourcePairProps {
  sources: AnalyticsData['bySource'];
  t: (key: string) => string;
}

function BySourcePair({ sources, t }: BySourcePairProps) {
  const total = sources.api + sources.bot;
  const apiPct = total > 0 ? Math.round((sources.api / total) * 100) : 0;
  const botPct = total > 0 ? Math.round((sources.bot / total) * 100) : 0;

  return (
    <div className="flex items-center gap-8 justify-center py-4">
      {/* API */}
      <div className="flex flex-col items-center gap-1.5">
        <svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-slate-400"
          aria-hidden="true"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span className="text-2xl font-bold text-slate-700 tabular-nums">{sources.api}</span>
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          {t('panel.overview.source.api')}
        </span>
        <span className="text-xs text-slate-400">({apiPct}%)</span>
      </div>

      {/* Bot */}
      <div className="flex flex-col items-center gap-1.5">
        <svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-slate-400"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <span className="text-2xl font-bold text-slate-700 tabular-nums">{sources.bot}</span>
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          {t('panel.overview.source.bot')}
        </span>
        <span className="text-xs text-slate-400">({botPct}%)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (shared with MissedQueriesPanel pattern)
// ---------------------------------------------------------------------------

function TimeRangeControl({
  value,
  onChange,
  t,
}: {
  value: AnalyticsTimeRange;
  onChange: (v: AnalyticsTimeRange) => void;
  t: (key: string) => string;
}) {
  const options: { label: string; value: AnalyticsTimeRange }[] = [
    { label: t('common.timeRange.24h'), value: '24h' },
    { label: t('common.timeRange.7d'), value: '7d' },
    { label: t('common.timeRange.30d'), value: '30d' },
    { label: t('common.timeRange.all'), value: 'all' },
  ];

  return (
    <div
      role="group"
      aria-label={t('common.timeRange.label')}
      className="inline-flex rounded-lg border border-slate-200 overflow-hidden"
    >
      {options.map((opt, i) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 text-xs font-medium transition-colors duration-150',
              i < options.length - 1 ? 'border-r border-slate-200' : '',
              isActive
                ? 'bg-brand-green text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ScalarCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="shimmer-element h-3 w-20 rounded mb-2" />
      <div className="shimmer-element h-8 w-16 rounded mb-1.5" />
      <div className="shimmer-element h-3 w-28 rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverviewPanel
// ---------------------------------------------------------------------------

export function OverviewPanel() {
  const t = useT('admin');

  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('7d');
  const [queriesData, setQueriesData] = useState<AnalyticsData | null>(null);
  const [webEventsData, setWebEventsData] = useState<WebMetricsAggregate | null>(null);
  const [isLoadingQueries, setIsLoadingQueries] = useState(true);
  const [isLoadingWebEvents, setIsLoadingWebEvents] = useState(true);
  const [queriesError, setQueriesError] = useState<string | null>(null);
  const [webEventsError, setWebEventsError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (range: AnalyticsTimeRange) => {
      setIsLoadingQueries(true);
      setIsLoadingWebEvents(true);
      setQueriesError(null);
      setWebEventsError(null);

      const [queriesResult, webEventsResult] = await Promise.allSettled([
        getQueriesAnalytics({ timeRange: range, topN: 10 }),
        getWebMetricsAnalytics({ timeRange: range }),
      ]);

      if (queriesResult.status === 'fulfilled') {
        setQueriesData(queriesResult.value);
      } else {
        setQueriesError(t('panel.overview.errorEngine'));
      }
      setIsLoadingQueries(false);

      if (webEventsResult.status === 'fulfilled') {
        setWebEventsData(webEventsResult.value);
        trackEvent('admin_panel_loaded', { panel: 'overview' });
      } else {
        setWebEventsError(t('panel.overview.errorWeb'));
      }
      setIsLoadingWebEvents(false);
    },
    [t]
  );

  useEffect(() => {
    void fetchAll(timeRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTimeRangeChange(range: AnalyticsTimeRange) {
    setTimeRange(range);
    void fetchAll(range);
  }

  // Derived values
  const missRate =
    queriesData && queriesData.totalQueries > 0
      ? ((queriesData.byLevel.miss / queriesData.totalQueries) * 100).toFixed(1) + '%'
      : '0.0%';

  const cacheHitRateFormatted =
    queriesData !== null
      ? (queriesData.cacheHitRate * 100).toFixed(1) + '%'
      : null;

  const avgRtFormatted =
    queriesData?.avgResponseTimeMs !== null && queriesData?.avgResponseTimeMs !== undefined
      ? Math.round(queriesData.avgResponseTimeMs) + 'ms'
      : '—';

  return (
    <section className="bg-white rounded-2xl border border-slate-100">
      {/* Panel header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-slate-800">
          {t('panel.overview.title')}
        </h2>
        <TimeRangeControl value={timeRange} onChange={handleTimeRangeChange} t={t} />
      </div>

      {/* Panel body */}
      <div className="p-5">
        {/* Engine section */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            {t('panel.overview.sections.engine')}
          </h3>

          {isLoadingQueries ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <ScalarCardSkeleton key={i} />)}
            </div>
          ) : queriesError !== null ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <p className="text-sm text-red-600">{queriesError}</p>
              <button
                type="button"
                onClick={() => void fetchAll(timeRange)}
                className="text-sm font-medium text-brand-green underline"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : queriesData !== null ? (
            <>
              {/* Scalar cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <ScalarCard
                  label={t('panel.overview.card.totalQueries.label')}
                  value={String(queriesData.totalQueries)}
                  caption={t('panel.overview.card.totalQueries.caption')}
                />
                <ScalarCard
                  label={t('panel.overview.card.cacheHitRate.label')}
                  value={cacheHitRateFormatted ?? '—'}
                  caption={t('panel.overview.card.cacheHitRate.caption')}
                />
                <ScalarCard
                  label={t('panel.overview.card.avgResponseTimeMs.label')}
                  value={avgRtFormatted}
                  caption={t('panel.overview.card.avgResponseTimeMs.caption')}
                />
                <ScalarCard
                  label={t('panel.overview.card.missRate.label')}
                  value={missRate}
                  caption={t('panel.overview.card.missRate.caption')}
                />
              </div>

              {/* Distributions row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* byLevel */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    {t('panel.overview.sections.levels')}
                  </h4>
                  <ByLevelBars
                    levels={queriesData.byLevel}
                    totalQueries={queriesData.totalQueries}
                    t={t}
                  />
                </div>

                {/* bySource */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    {t('panel.overview.sections.sources')}
                  </h4>
                  <BySourcePair sources={queriesData.bySource} t={t} />
                </div>
              </div>

              {/* Top queries / top intents (from queriesData) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top queries */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    {t('panel.overview.sections.topQueries')}
                  </h4>
                  {queriesData.topQueries.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('panel.overview.noTopQueries')}</p>
                  ) : (
                    <div>
                      {queriesData.topQueries.map((item) => (
                        <div
                          key={item.queryText}
                          className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                        >
                          <span className="text-sm text-slate-600 truncate flex-1 mr-4">
                            {item.queryText}
                          </span>
                          <span className="text-sm font-semibold text-slate-700 tabular-nums flex-shrink-0">
                            {item.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Top intents (from webEventsData if available) */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    {t('panel.overview.sections.topIntents')}
                  </h4>
                  {webEventsError !== null ? (
                    <p className="text-sm text-red-600">{webEventsError}</p>
                  ) : isLoadingWebEvents ? (
                    <div className="shimmer-element h-20 rounded" />
                  ) : webEventsData !== null && webEventsData.topIntents.length > 0 ? (
                    <div>
                      {webEventsData.topIntents.map((item) => (
                        <div
                          key={item.intent}
                          className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                        >
                          <span className="text-sm text-slate-600 flex-1 mr-4">{item.intent}</span>
                          <span className="text-sm font-semibold text-slate-700 tabular-nums flex-shrink-0">
                            {item.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">{t('panel.overview.noTopIntents')}</p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Web section separator */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            {t('panel.overview.sections.web')}
          </h3>

          {isLoadingWebEvents ? (
            <ScalarCardSkeleton />
          ) : webEventsError !== null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-red-600">{webEventsError}</p>
              <button
                type="button"
                onClick={() => void fetchAll(timeRange)}
                className="text-sm font-medium text-brand-green underline"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : webEventsData !== null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <ScalarCard
                label={t('panel.overview.card.webTotalQueries.label')}
                value={String(webEventsData.totalQueries)}
                caption={t('panel.overview.card.webTotalQueries.caption')}
                accent
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
