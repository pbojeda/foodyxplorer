// LoadingState — skeleton card placeholders while API is in flight.
// Pure presentational — no 'use client' needed.

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

export function LoadingState() {
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
