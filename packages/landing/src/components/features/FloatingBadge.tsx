import { Badge } from '@/components/ui/Badge';

type BadgeVariant = 'high' | 'medium' | 'low';

interface FloatingBadgeProps {
  label: string;
  variant: BadgeVariant;
}

export function FloatingBadge({ label, variant }: FloatingBadgeProps) {
  return (
    <div className="absolute -right-3 top-8 bg-white/90 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-layered border border-slate-100 flex items-center gap-2 animate-badge-pulse">
      <Badge variant={variant}>{label}</Badge>
    </div>
  );
}
