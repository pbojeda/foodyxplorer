// ConfidenceBadge — maps confidence level to a colored Spanish label badge.
// Pure presentational. No 'use client' needed.

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
}

const BADGE_CONFIG: Record<ConfidenceLevel, { label: string; className: string }> = {
  high: {
    label: 'Verificado',
    className: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  },
  medium: {
    label: 'Estimado',
    className: 'bg-amber-50 text-amber-800 border border-amber-200',
  },
  low: {
    label: 'Aproximado',
    className: 'bg-rose-50 text-rose-800 border border-rose-200',
  },
};

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  const { label, className } = BADGE_CONFIG[level];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}
