'use client';

// ResponseReviewPanel — Panel B of the admin analytics dashboard.
// F-ADMIN-ANALYTICS-UI.
// Design spec: W29 (filter controls), W30 (tables), W32 (expand-row UX).

import React, { useState, useEffect, useCallback } from 'react';
import type {
  HistorySampleData,
  SearchHistorySampleEntry,
} from '@foodxplorer/shared';
import type { ConversationIntent } from '@foodxplorer/shared';
import { getHistorySample } from '@/lib/apiClient';
import { useT } from '@/lib/i18n/useT';
import { trackEvent } from '@/lib/metrics';
import { ResultBody } from '@/components/ResultBody';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTENT_OPTIONS: ConversationIntent[] = [
  'estimation',
  'comparison',
  'menu_estimation',
  'reverse_search',
  'context_set',
  'text_too_long',
  'follow_up_attribute',
  'follow_up_refinement',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IntentBadge({ intent, t }: { intent: ConversationIntent | string; t: (key: string) => string }) {
  const label = t(`intent.${intent}`);
  const colorMap: Partial<Record<ConversationIntent, string>> = {
    estimation: 'bg-emerald-50 text-emerald-700',
    comparison: 'bg-blue-50 text-blue-700',
    menu_estimation: 'bg-violet-50 text-violet-700',
    reverse_search: 'bg-orange-50 text-orange-700',
    context_set: 'bg-sky-50 text-sky-700',
    text_too_long: 'bg-slate-100 text-slate-500',
    follow_up_attribute: 'bg-indigo-50 text-indigo-700',
    follow_up_refinement: 'bg-pink-50 text-pink-700',
  };
  const colorClass = colorMap[intent as ConversationIntent] ?? 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function KindBadge({ kind, t }: { kind: 'text' | 'voice'; t: (key: string) => string }) {
  const label = t(`common.kind.${kind}`);
  const colorClass =
    kind === 'voice' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function RelativeTime({ isoString }: { isoString: string }) {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let label: string;
  if (diffMins < 1) {
    label = 'ahora';
  } else if (diffMins < 60) {
    label = `hace ${diffMins}m`;
  } else if (diffHours < 24) {
    label = `hace ${diffHours}h`;
  } else {
    label = `hace ${diffDays}d`;
  }

  return (
    <span className="text-xs text-slate-400 tabular-nums" title={date.toLocaleString('es-ES')}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="h-12 border-b border-slate-50">
      <td className="px-4 py-3"><div className="shimmer-element h-4 w-48 rounded" /></td>
      <td className="px-4 py-3"><div className="shimmer-element h-4 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="shimmer-element h-4 w-12 rounded" /></td>
      <td className="px-4 py-3"><div className="shimmer-element h-4 w-16 rounded" /></td>
      <td className="px-4 py-3 w-10"><div className="shimmer-element h-4 w-4 rounded mx-auto" /></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// ExpandedRow
// ---------------------------------------------------------------------------

function ExpandedRow({
  entry,
  isExpanded,
  t,
}: {
  entry: SearchHistorySampleEntry;
  isExpanded: boolean;
  t: (key: string) => string;
}) {
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <tr>
      <td colSpan={5} className="p-0">
        {/* CSS grid trick: 0fr collapsed, 1fr expanded */}
        <div
          className={[
            'grid overflow-hidden transition-[grid-template-rows] duration-[250ms] ease-out',
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          <div className="min-h-0">
            {isExpanded && (
              <div className="py-4 px-6 bg-slate-50/60 border-l-2 border-brand-green/30 ml-2">
                {/* Intent badge header */}
                <div className="flex items-center gap-2 mb-3">
                  <IntentBadge intent={entry.resultData.intent} t={t} />
                  <span className="text-sm font-semibold text-slate-700">
                    {t(`intent.${entry.resultData.intent}`)}
                  </span>
                </div>

                {/* Result body */}
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <ResultBody data={entry.resultData} />
                </div>

                {/* Raw JSON toggle */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowRawJson((prev) => !prev)}
                    className="text-[11px] text-slate-400 underline cursor-pointer"
                  >
                    {showRawJson ? t('panel.responseReview.hideJson') : t('panel.responseReview.rawJson')}
                  </button>
                  {showRawJson && (
                    <pre className="mt-2 bg-slate-100 rounded-lg p-3 overflow-x-auto text-[11px] font-mono text-slate-600">
                      {JSON.stringify(entry.resultData, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// ResponseReviewPanel
// ---------------------------------------------------------------------------

export function ResponseReviewPanel() {
  const t = useT('admin');

  const [intent, setIntent] = useState<ConversationIntent | undefined>(undefined);
  const [hours, setHours] = useState(24);
  const [hoursInput, setHoursInput] = useState('24');
  const [limit, setLimit] = useState(20);
  const [limitInput, setLimitInput] = useState('20');
  const [data, setData] = useState<HistorySampleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (params: { hours: number; limit: number; intent?: ConversationIntent }) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getHistorySample(params);
        setData(result);
        trackEvent('admin_panel_loaded', { panel: 'response-review' });
      } catch {
        setError(t('panel.responseReview.error'));
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  // Initial load only — re-fetches on filter change are triggered explicitly
  useEffect(() => {
    void fetchData({ hours, limit, ...(intent ? { intent } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleToggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        trackEvent('admin_history_expand', { panel: 'response-review' });
      }
      return next;
    });
  }

  function handleIntentChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const newIntent = val === '' ? undefined : (val as ConversationIntent);
    setIntent(newIntent);
    void fetchData({ hours, limit, ...(newIntent ? { intent: newIntent } : {}) });
  }

  function handleHoursBlur() {
    const parsed = parseInt(hoursInput, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 720) {
      setHoursError(t('panel.responseReview.filterHoursValidation'));
      setHoursInput(String(hours));
    } else {
      setHoursError(null);
      setHours(parsed);
      void fetchData({ hours: parsed, limit, ...(intent ? { intent } : {}) });
    }
  }

  function handleLimitBlur() {
    const parsed = parseInt(limitInput, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      setLimitError(t('panel.responseReview.filterLimitValidation'));
      setLimitInput(String(limit));
    } else {
      setLimitError(null);
      setLimit(parsed);
      void fetchData({ hours, limit: parsed, ...(intent ? { intent } : {}) });
    }
  }

  // Summary line
  const summary =
    data !== null
      ? t('panel.responseReview.summary')
          .replace('{count}', String(data.items.length))
          .replace('{hours}', String(hours))
      : '';

  return (
    <section className="bg-white rounded-2xl border border-slate-100">
      {/* Panel header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-slate-800">
          {t('panel.responseReview.title')}
        </h2>

        {/* Filter controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Intent dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{t('panel.responseReview.filterIntent')}</span>
            <div className="relative">
              <select
                value={intent ?? ''}
                onChange={handleIntentChange}
                className="appearance-none text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 pr-6 text-slate-700 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-green"
                aria-label={t('panel.responseReview.filterIntent')}
              >
                <option value="">{t('panel.responseReview.filterIntentAll')}</option>
                {INTENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`intent.${opt}`)}
                  </option>
                ))}
              </select>
              {/* Custom chevron */}
              <svg
                className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400"
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {/* Hours input */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500" htmlFor="rr-hours">
              {t('panel.responseReview.filterHours')}
            </label>
            <input
              id="rr-hours"
              type="number"
              min={1}
              max={720}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              onBlur={handleHoursBlur}
              className="w-16 text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
            {hoursError && (
              <span className="text-[11px] text-red-500">{hoursError}</span>
            )}
          </div>

          {/* Limit input */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500" htmlFor="rr-limit">
              {t('panel.responseReview.filterLimit')}
            </label>
            <input
              id="rr-limit"
              type="number"
              min={1}
              max={100}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              onBlur={handleLimitBlur}
              className="w-16 text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
            {limitError && (
              <span className="text-[11px] text-red-500">{limitError}</span>
            )}
          </div>
        </div>
      </div>

      {/* Panel body */}
      <div className="p-5">
        {isLoading ? (
          <table className="w-full text-left table-fixed" aria-busy="true" aria-label={t('panel.responseReview.title')}>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </tbody>
          </table>
        ) : error !== null ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void fetchData({ hours, limit, ...(intent ? { intent } : {}) })}
              className="text-sm font-medium text-brand-green underline"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : data === null || data.items.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-slate-400">{t('panel.responseReview.empty')}</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <p className="text-xs text-slate-400 mb-3">{summary}</p>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left table-fixed" aria-label={t('panel.responseReview.title')}>
                <thead>
                  <tr className="sticky top-0 z-10 bg-slate-50">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-auto">
                      {t('panel.responseReview.col.query')}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-32">
                      {t('panel.responseReview.col.intent')}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">
                      {t('panel.responseReview.col.kind')}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">
                      {t('panel.responseReview.col.createdAt')}
                    </th>
                    <th className="px-4 py-3 w-10" aria-label={t('panel.responseReview.col.expand')} />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const isExpanded = expandedIds.has(row.id);
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className="h-12 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors duration-150"
                          onClick={() => handleToggleExpand(row.id)}
                        >
                          {/* queryText */}
                          <td className="px-4 py-3 max-w-[300px]">
                            <span
                              className="truncate block text-sm text-slate-700"
                              title={row.queryText}
                            >
                              {row.queryText.length > 100
                                ? row.queryText.slice(0, 100) + '…'
                                : row.queryText}
                            </span>
                          </td>

                          {/* intent badge */}
                          <td className="px-4 py-3">
                            <IntentBadge intent={row.resultData.intent} t={t} />
                          </td>

                          {/* kind badge */}
                          <td className="px-4 py-3">
                            <KindBadge kind={row.kind} t={t} />
                          </td>

                          {/* createdAt */}
                          <td className="px-4 py-3">
                            <RelativeTime isoString={row.createdAt} />
                          </td>

                          {/* expand icon */}
                          <td className="px-2 py-3 w-10 text-center">
                            <button
                              type="button"
                              aria-label={
                                isExpanded
                                  ? t('panel.responseReview.collapseAriaLabel')
                                  : t('panel.responseReview.expandAriaLabel')
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleExpand(row.id);
                              }}
                              className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              <svg
                                width={16}
                                height={16}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                style={{
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                  transition: 'transform 200ms ease-out',
                                }}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </button>
                          </td>
                        </tr>

                        {/* Expand row */}
                        <ExpandedRow entry={row} isExpanded={isExpanded} t={t} />
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
