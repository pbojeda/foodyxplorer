// ContextConfirmation — shown when intent is 'context_set'.
// Displays chain confirmation or ambiguity message.
// Pure presentational — no 'use client' needed.

interface ContextConfirmationProps {
  contextSet: { chainSlug: string; chainName: string } | undefined;
  ambiguous: boolean;
}

export function ContextConfirmation({ contextSet, ambiguous }: ContextConfirmationProps) {
  if (ambiguous || !contextSet) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-[15px] font-medium text-amber-800">
            No encontré ese restaurante. Prueba con el nombre exacto.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
          Contexto activo:
        </p>
        <p className="mt-1 text-[15px] font-medium text-emerald-800">{contextSet.chainName}</p>
      </div>
    </div>
  );
}
