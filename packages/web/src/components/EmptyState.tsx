// EmptyState — shown on first load before any query is submitted.
// Pure presentational — no 'use client' needed.

export function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="text-[15px] font-medium text-slate-600">¿Qué quieres saber?</p>
      <p className="mt-1.5 max-w-[280px] text-sm text-slate-400">
        Escribe, habla o sube una foto para conocer las calorías de un plato.
      </p>
    </div>
  );
}
