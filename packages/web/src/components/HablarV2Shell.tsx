'use client';

// HablarV2Shell — PROTOTYPE for F-WEB-HISTORY-FU7 empirical validation.
//
// Architecture under test:
//   1. Composer is IN-COLUMN at flex-end of `h-[100dvh] flex-col` shell
//      (NOT `position: fixed bottom-0` overlay).
//   2. Feed is native `<div className="flex-1 overflow-y-auto">` — no
//      react-virtuoso, no Footer spacer, no --input-bar-height CSS var, no
//      ResizeObserver, no overflow-x-hidden defensive.
//   3. Auto-scroll on settle is PIN-AWARE: only scrolls to bottom if the user
//      was already near the bottom (threshold 100px). If user scrolled up,
//      new settles do NOT hijack the viewport.
//
// What we're trying to validate empirically (on a real iPhone):
//   - BUG A: does the card become fully visible above the composer on settle?
//   - BUG B: is the card right edge visible (no clipping) on narrow viewports?
//   - iOS keyboard: when the user taps the textarea, does the composer stay
//     visible above the keyboard? Or does it get pushed off-screen?
//   - Pin-aware: scrolling up to read old entries, then new settles — does it
//     preserve viewport position?
//
// Test controls are embedded so the owner can reproduce the failing scenarios
// without auth/voice/photo machinery interfering. Once the architecture is
// validated, this file + the /hablar-v2 route are DELETED in the FU7 PR.

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Sample entry — minimal shape mimicking the real TranscriptEntryData
// structure for layout testing. NO dependency on @foodxplorer/shared schemas
// (decoupled — this prototype tests layout, not data flow).
// ---------------------------------------------------------------------------

interface SampleEntry {
  id: string;
  query: string;
  isPersisted: boolean;
  // null while loading shimmer; populated when settled
  result: {
    name: string;
    kcal: number;
    proteins: number;
    carbs: number;
    fats: number;
    source: string;
    portionTerm: string | null;
    portionGrams: number | null;
  } | null;
}

// Realistic sample data covering the failure modes
const SAMPLE_PROMPTS = [
  { query: 'manzana', name: 'Manzana fresca', kcal: 52, p: 0, c: 14, f: 0, src: 'USDA' },
  { query: 'tortilla de patatas con cebolla', name: 'Tortilla de patatas con cebolla', kcal: 320, p: 9, c: 28, f: 18, src: 'BEDCA' },
  { query: 'lasaña de carne casera con bechamel', name: 'Lasaña de carne casera con bechamel y queso', kcal: 480, p: 22, c: 38, f: 24, src: 'Receta casera estimación' },
  { query: 'paella valenciana de mariscos', name: 'Paella valenciana de mariscos auténtica', kcal: 420, p: 18, c: 52, f: 14, src: 'BEDCA - Tabla composición alimentos' },
  { query: 'café con leche', name: 'Café con leche', kcal: 80, p: 4, c: 6, f: 4, src: 'USDA' },
];

let _idCounter = 0;
function newId(): string {
  return `entry-${++_idCounter}`;
}

function buildPendingEntry(query: string): SampleEntry {
  return { id: newId(), query, isPersisted: false, result: null };
}

function buildSettledFromSample(idx: number, isPersisted = false): SampleEntry {
  const s = SAMPLE_PROMPTS[idx % SAMPLE_PROMPTS.length]!;
  return {
    id: newId(),
    query: s.query,
    isPersisted,
    result: {
      name: s.name,
      kcal: s.kcal,
      proteins: s.p,
      carbs: s.c,
      fats: s.f,
      source: s.src,
      portionTerm: null,
      portionGrams: null,
    },
  };
}

// ---------------------------------------------------------------------------
// SampleCard — visually mimics NutritionCard.tsx (estimation branch) so the
// prototype tests the SAME layout shape that exhibited BUG B in production.
// Header: h2 (long dish name) + Confidence-style badge + Delete button.
// Body: KCAL big number + macro row (3 MacroItems).
// ---------------------------------------------------------------------------

function SampleCard({
  result,
  isPersisted,
  onDelete,
}: {
  result: NonNullable<SampleEntry['result']>;
  isPersisted: boolean;
  onDelete?: () => void;
}) {
  return (
    <article className="card-enter overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-soft md:p-5">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">{result.name}</h2>
        <span className="inline-flex flex-shrink-0 items-center rounded-full bg-brand-green/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-green">
          ALTA
        </span>
      </header>

      <div className="mt-3">
        <span className="text-[28px] font-extrabold leading-none text-brand-orange">{result.kcal}</span>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">KCAL</p>
      </div>

      <div className="mt-3 flex gap-4">
        <MacroItem value={result.proteins} label="PROTEÍNAS" colorClass="text-brand-green" />
        <MacroItem value={result.carbs} label="CARBOHIDRATOS" colorClass="text-accent-gold" />
        <MacroItem value={result.fats} label="GRASAS" colorClass="text-slate-500" />
      </div>

      <footer className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        {result.source}
      </footer>

      {isPersisted && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="mt-2 text-[11px] font-medium text-slate-400 underline underline-offset-2 hover:text-red-500"
          aria-label="Eliminar entrada"
        >
          Eliminar
        </button>
      )}
    </article>
  );
}

function MacroItem({ value, label, colorClass }: { value: number; label: string; colorClass: string }) {
  return (
    <div>
      <p className={`text-lg font-bold leading-none ${colorClass}`}>
        {value}
        <span className="text-slate-500 text-sm">g</span>
      </p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shimmer — mimics the production shimmer-element (100px tall)
// ---------------------------------------------------------------------------

function Shimmer() {
  return <div className="h-[100px] rounded-2xl shimmer-element" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// HablarV2Shell
// ---------------------------------------------------------------------------

const NEAR_BOTTOM_THRESHOLD_PX = 100; // pin-aware threshold

export function HablarV2Shell() {
  const [entries, setEntries] = useState<SampleEntry[]>([
    buildSettledFromSample(0, true),
    buildSettledFromSample(1, true),
  ]);
  const [query, setQuery] = useState('');
  const [debugOn, setDebugOn] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track whether user was near the bottom BEFORE the most recent settle.
  // Updated on every scroll event.
  const wasNearBottomRef = useRef(true);
  // Track previous loading state of the LAST entry to detect shimmer→card flip.
  const prevLastLoadingRef = useRef(false);

  // Pin-aware: read on every scroll, update wasNearBottomRef
  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
    if (debugOn) {
      console.log('[v2/scroll]', {
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        distanceFromBottom: Math.round(distanceFromBottom),
        nearBottom: wasNearBottomRef.current,
      });
    }
  }, [debugOn]);

  // Initial pin state: scroll-to-bottom on mount so wasNearBottom is correct.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasNearBottomRef.current = true;
  }, []);

  // Pin-aware auto-scroll: when the LAST entry transitions from loading→settled
  // (shimmer→card), scroll to bottom IF the user was near-bottom before the flip.
  useEffect(() => {
    const last = entries[entries.length - 1];
    const currentLastLoading = last ? last.result === null : false;
    if (prevLastLoadingRef.current === true && currentLastLoading === false) {
      // Settle just happened
      if (wasNearBottomRef.current) {
        requestAnimationFrame(() => {
          const el = feedRef.current;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          if (debugOn) {
            console.log('[v2/settle] auto-scrolled', {
              scrollTop: el.scrollTop,
              scrollHeight: el.scrollHeight,
            });
          }
        });
      } else if (debugOn) {
        console.log('[v2/settle] pin-aware skip — user scrolled up');
      }
    }
    prevLastLoadingRef.current = currentLastLoading;
  }, [entries, debugOn]);

  // ---------------------------------------------------------------------------
  // Simulated query flow
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return;
    // Append a pending entry (shimmer) at the end.
    const pending = buildPendingEntry(query.trim());
    setEntries((prev) => [...prev, pending]);
    setQuery('');
    // After append: the BROWSER will naturally show the shimmer at bottom if
    // user was near-bottom (the new entry IS at the new bottom). If user
    // was scrolled up, the append doesn't move the viewport (browser preserves
    // scrollTop). That's the desired behavior.

    // Auto-resize textarea back to 1 line after clearing.
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    });

    // Simulate API latency, then settle.
    const settleAfterMs = 1200 + Math.random() * 800;
    setTimeout(() => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === pending.id
            ? buildSettledFromSample(Math.floor(Math.random() * SAMPLE_PROMPTS.length), false)
            : e,
        ),
      );
    }, settleAfterMs);
  }, [query]);

  const handleDelete = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Auto-resize textarea up to 3 lines (mirrors ConversationInput.tsx behavior)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * 3 + 24;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [query]);

  // ---------------------------------------------------------------------------
  // Test controls (visible in the prototype)
  // ---------------------------------------------------------------------------

  const addBulk = useCallback((n: number) => {
    setEntries((prev) => [
      ...prev,
      ...Array.from({ length: n }, (_, i) => buildSettledFromSample(i, false)),
    ]);
  }, []);

  const reset = useCallback(() => {
    setEntries([buildSettledFromSample(0, true), buildSettledFromSample(1, true)]);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      {/* Header — same dimensions as production /hablar */}
      <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4">
        <span className="text-base font-bold text-brand-green">
          nutriXplorer <span className="text-slate-400 text-xs font-normal">/hablar-v2 prototype</span>
        </span>
        <button
          type="button"
          onClick={() => setDebugOn((v) => !v)}
          className={`text-[10px] uppercase font-semibold tracking-wide px-2 py-1 rounded ${
            debugOn ? 'bg-brand-orange text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          debug {debugOn ? 'on' : 'off'}
        </button>
      </header>

      {/* Feed — NATIVE overflow-y-auto, no Virtuoso, no Footer hack */}
      <div
        ref={feedRef}
        role="feed"
        aria-label="Prototype historial"
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 lg:max-w-2xl lg:mx-auto w-full"
        onScroll={handleScroll}
      >
        {entries.length === 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Sin entradas. Pulsa &ldquo;+5 entries&rdquo; o escribe abajo.
          </p>
        )}

        {entries.map((entry, idx) => (
          <article
            key={entry.id}
            role="article"
            aria-label={`${entry.query} — resultado`}
            className="mb-4 last:mb-0"
          >
            {/* Query echo header — mirrors TranscriptEntry header */}
            <div className="flex items-center gap-2 mb-3 group">
              <span className="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">12:34</span>
              <span className="text-slate-300 mx-1" aria-hidden="true">·</span>
              {entry.isPersisted && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 mr-1">
                  Guardado
                </span>
              )}
              <span
                className="text-sm font-medium text-slate-600 truncate flex-1 min-w-0"
                title={entry.query}
              >
                {entry.query}
              </span>
              {entry.isPersisted && (
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  className="ml-auto flex-shrink-0 text-[11px] text-slate-400 hover:text-red-500"
                  aria-label={`Eliminar ${entry.query}`}
                >
                  🗑
                </button>
              )}
            </div>

            {/* Result body: shimmer or settled card */}
            {entry.result === null ? (
              <Shimmer />
            ) : (
              <SampleCard
                result={entry.result}
                isPersisted={entry.isPersisted}
                onDelete={entry.isPersisted ? () => handleDelete(entry.id) : undefined}
              />
            )}

            {idx < entries.length - 1 && (
              <hr className="border-t border-slate-100 mt-4" aria-hidden="true" />
            )}
          </article>
        ))}
      </div>

      {/* Composer — IN-COLUMN at flex-end, NOT position: fixed */}
      <div
        className="flex-shrink-0 bg-white border-t border-slate-200 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-sm"
      >
        {/* Test controls strip (always visible in prototype) */}
        <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => addBulk(5)}
            className="px-2 py-1 rounded bg-slate-100 text-slate-600 font-medium"
          >
            +5 entries
          </button>
          <button
            type="button"
            onClick={() => addBulk(20)}
            className="px-2 py-1 rounded bg-slate-100 text-slate-600 font-medium"
          >
            +20 entries
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-2 py-1 rounded bg-slate-100 text-slate-600 font-medium"
          >
            reset
          </button>
          <span className="px-2 py-1 text-slate-400">{entries.length} entries</span>
        </div>

        {/* Main composer row — mirrors ConversationInput.tsx structure */}
        <div className="flex items-center gap-2">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (query.trim()) handleSubmit();
              }
            }}
            placeholder="¿Qué quieres saber? (prototype)"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-2xl border border-slate-200 bg-paper px-4 py-3 text-base text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/15"
            style={{ minHeight: '48px' }}
            aria-label="Escribe tu consulta (prototype)"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!query.trim()}
            className="flex-shrink-0 rounded-2xl bg-brand-green text-white px-4 py-3 font-medium disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
