// AllergenChip — displays a single allergen tag with a warning icon.
// Pure presentational. No 'use client' needed.

interface AllergenChipProps {
  allergen: string;
}

export function AllergenChip({ allergen }: AllergenChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
      <span aria-hidden="true">⚠</span>
      {allergen}
    </span>
  );
}
