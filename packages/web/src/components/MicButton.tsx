// MicButton — disabled placeholder for F091 Voice mode.
// Pure presentational — no 'use client' needed.

export function MicButton() {
  return (
    <button
      type="button"
      disabled
      aria-label="Micrófono (próximamente)"
      title="Próximamente"
      className="flex h-12 w-12 flex-shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-slate-300 text-slate-400 opacity-60"
    >
      {/* Microphone SVG */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
        />
      </svg>
    </button>
  );
}
