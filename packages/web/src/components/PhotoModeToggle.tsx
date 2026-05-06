// PhotoModeToggle — segmented pill control for photo analysis mode selection.
// F-WEB-MENU-VISION-001: always visible below ConversationInput's text row.
// Pure presentational — no 'use client' needed (parent ConversationInput is already client).

type PhotoModeToggleProps = {
  value: 'auto' | 'identify';
  onChange: (mode: 'auto' | 'identify') => void;
  disabled?: boolean;
};

const ACTIVE_CLASS =
  'flex-1 rounded-[10px] py-2.5 px-3 bg-white text-brand-green shadow-soft border border-brand-green/20 ' +
  'text-sm font-medium transition-colors duration-150 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1';

const INACTIVE_CLASS =
  'flex-1 rounded-[10px] py-2.5 px-3 bg-transparent text-slate-500 border border-transparent ' +
  'text-sm font-medium transition-colors duration-150 hover:text-slate-700 hover:bg-white/60 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1';

export function PhotoModeToggle({ value, onChange, disabled = false }: PhotoModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Tipo de análisis de foto"
      className={`inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-0.5 mt-2${disabled ? ' opacity-40 pointer-events-none cursor-not-allowed' : ''}`}
    >
      <button
        type="button"
        className={value === 'auto' ? ACTIVE_CLASS : INACTIVE_CLASS}
        aria-pressed={value === 'auto'}
        onClick={() => onChange('auto')}
        disabled={disabled}
      >
        Menú/carta
      </button>
      <button
        type="button"
        className={value === 'identify' ? ACTIVE_CLASS : INACTIVE_CLASS}
        aria-pressed={value === 'identify'}
        onClick={() => onChange('identify')}
        disabled={disabled}
      >
        Solo este plato
      </button>
    </div>
  );
}
