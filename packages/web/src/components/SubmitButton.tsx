// SubmitButton — send button shown when query is non-empty.
// Pure presentational — no 'use client' needed (receives props only).

interface SubmitButtonProps {
  onSubmit: () => void;
  isLoading: boolean;
}

export function SubmitButton({ onSubmit, isLoading }: SubmitButtonProps) {
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={isLoading}
      aria-label="Buscar"
      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-orange text-white shadow-soft transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
    >
      {/* Send/Arrow SVG — 20px */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
      </svg>
    </button>
  );
}
