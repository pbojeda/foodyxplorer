// HistoryEmptyState — shown for logged-in users with zero persisted history.
// Server Component (no 'use client' needed — no hooks, no browser APIs).
// Design spec: W22. Separate from EmptyState (which is for anonymous first-use).

export function HistoryEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center py-12">
      {/* Magnifier icon — 32px, stroke 1.5, aria-hidden */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={32}
        height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-slate-300"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <h2 className="text-[15px] font-semibold text-slate-500">Aún no tienes historial</h2>
      <p className="text-sm text-slate-400 leading-relaxed max-w-[240px]">
        Tus consultas de texto y voz se guardarán aquí automáticamente.
      </p>
    </div>
  );
}
