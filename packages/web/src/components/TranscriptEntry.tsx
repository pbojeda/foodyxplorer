'use client';

// TranscriptEntry — single query+result pair in the TranscriptFeed.
// Design spec: W17 (anatomy), W19 (loading/error states), W25 (animations).
// AC33: role="article", aria-label, modality icon.
// AC35: result body renders correct card for each intent.
// AC60: persisted entries with resultData re-render correctly.

import type { MenuAnalysisData } from '@foodxplorer/shared';
import type { TranscriptEntryData } from '@/types/history';
import { NutritionCard } from './NutritionCard';
import { MenuDishList } from './MenuDishList';
import { DeleteEntryButton } from './DeleteEntryButton';
import { ResultBody } from './ResultBody';

interface TranscriptEntryProps {
  entry: TranscriptEntryData;
  onDelete?: (entryId: string) => void;
  onRetry?: (queryText: string) => void;
  onDishSelect?: (dishName: string) => void;
}

// Format timestamp: time only (HH:mm) for today, "DD MMM · HH:mm" for prior days.
function formatTimestamp(date: Date): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  const dayStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `${dayStr} · ${timeStr}`;
}

// EntryResultBody — renders all states for a TranscriptEntry (error, loading, photo, text/voice).
// Text/voice intent switch is delegated to the extracted ResultBody component.
function EntryResultBody({
  entry,
  onRetry,
  onDishSelect,
}: {
  entry: TranscriptEntryData;
  onRetry?: (queryText: string) => void;
  onDishSelect?: (dishName: string) => void;
}) {
  // Error state
  if (entry.error) {
    return (
      <div
        className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 flex items-start gap-3"
        role="alert"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={20}
          height={20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-red-500 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div className="flex-1">
          <p className="text-sm text-red-700">{entry.error}</p>
          {onRetry && (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-brand-green underline underline-offset-2 hover:opacity-80 transition-opacity"
              onClick={() => onRetry(entry.queryText)}
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  // Loading shimmer
  if (entry.isLoading) {
    const shimmerHeight = entry.inputMode === 'photo' ? 'h-[200px]' : 'h-[100px]';
    return (
      <div
        className={`${shimmerHeight} rounded-2xl shimmer-element`}
        aria-hidden="true"
      />
    );
  }

  // Photo result
  if (entry.inputMode === 'photo' && entry.photoData) {
    const photoData: MenuAnalysisData = entry.photoData;
    if (photoData.dishCount > 1) {
      return (
        <MenuDishList
          dishes={photoData.dishes}
          onDishSelect={onDishSelect ?? (() => {})}
          partial={photoData.partial}
        />
      );
    }
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {photoData.dishes.map((dish, index) => {
          if (dish.estimate !== null) {
            return (
              <NutritionCard
                key={`${dish.dishName}-${index}`}
                estimateData={dish.estimate}
              />
            );
          }
          return (
            <article
              key={`${dish.dishName}-${index}`}
              className="rounded-2xl border border-slate-100 bg-white p-4 shadow-soft"
            >
              <h2 className="text-base font-semibold text-slate-700">{dish.dishName}</h2>
              <p className="mt-1 text-sm text-slate-500">Sin datos nutricionales disponibles.</p>
            </article>
          );
        })}
      </div>
    );
  }

  // Text/voice result — delegate to extracted ResultBody
  if (!entry.result) return null;
  return <ResultBody data={entry.result} onDishSelect={onDishSelect} />;
}

export function TranscriptEntry({
  entry,
  onDelete,
  onRetry,
  onDishSelect,
}: TranscriptEntryProps) {
  const truncatedQuery = entry.queryText.length > 40
    ? `${entry.queryText.slice(0, 40)}…`
    : entry.queryText;
  const ariaLabel = `${truncatedQuery} — resultado`;

  return (
    <article
      role="article"
      aria-label={ariaLabel}
      aria-busy={entry.isLoading ? true : undefined}
      className="card-enter"
    >
      {/* Query echo header */}
      <div className="flex items-center gap-2 mb-3 group">
        {/* Modality icon (voice/photo only) */}
        {entry.inputMode === 'voice' && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-400 mr-1 flex-shrink-0"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
        {entry.inputMode === 'photo' && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-400 mr-1 flex-shrink-0"
            aria-hidden="true"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}

        {/* Timestamp */}
        <span className="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* Separator dot */}
        <span className="text-slate-300 mx-1" aria-hidden="true">·</span>

        {/* "Guardado" badge — persisted entries only */}
        {entry.isPersisted && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 mr-1">
            Guardado
          </span>
        )}

        {/* Query text — BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL Bug 2:
            `line-clamp-2` caps to 2 lines (replaces single-line `truncate`).
            `min-w-0` still required for clamp to engage inside the flex row
            (default min-width:auto would let the span's intrinsic content
            push the parent wider than the viewport). `break-words` handles
            very long unbroken tokens (URLs etc) without horizontal overflow.
            Owner UX: 2 lines + ellipsis preserves header strip height bounds. */}
        <span
          className="text-sm font-medium text-slate-600 line-clamp-2 flex-1 min-w-0 break-words"
          title={entry.queryText}
        >
          {entry.queryText}
        </span>

        {/* Delete button — only for persisted entries */}
        {entry.isPersisted && onDelete && (
          <div className="ml-auto flex-shrink-0">
            <DeleteEntryButton
              entryId={entry.entryId}
              queryText={entry.queryText}
              inputMode={entry.inputMode === 'photo' ? 'text' : entry.inputMode}
              onConfirm={onDelete}
            />
          </div>
        )}
      </div>

      {/* Result body */}
      <EntryResultBody entry={entry} onRetry={onRetry} onDishSelect={onDishSelect} />
    </article>
  );
}
