// LoadingState — skeleton card placeholders while API is in flight.
// F-WEB-MENU-VISION-001: supports mode='auto' (single shimmer bar) vs default (two SkeletonCards).
// Pure presentational — no 'use client' needed.

type LoadingStateProps = {
  /** F-WEB-MENU-VISION-001: 'auto' renders a single full-width shimmer bar for menu analysis;
   * undefined/'identify' renders the existing two-SkeletonCard layout. */
  mode?: 'auto' | 'identify';
};

function SkeletonCard() {
  return (
    <div
      data-testid="skeleton-card"
      className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-soft md:p-5"
    >
      {/* Title bar */}
      <div className="h-5 w-48 rounded-lg shimmer-element" />
      {/* Calorie block */}
      <div className="mt-3 h-9 w-24 rounded-lg shimmer-element" />
      {/* Macro rows */}
      <div className="mt-3 flex gap-4">
        <div className="h-6 w-16 rounded-lg shimmer-element" />
        <div className="h-6 w-16 rounded-lg shimmer-element" />
        <div className="h-6 w-16 rounded-lg shimmer-element" />
      </div>
    </div>
  );
}

export function LoadingState({ mode }: LoadingStateProps = {}) {
  if (mode === 'auto') {
    return (
      <div
        role="status"
        aria-label="Analizando el menú..."
        className="flex flex-col"
      >
        <p className="text-sm text-slate-500 text-center mb-2">Analizando el menú...</p>
        <div className="h-[200px] rounded-2xl shimmer-element" />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Buscando información nutricional..."
      className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4"
    >
      <span className="sr-only">Buscando información nutricional...</span>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
