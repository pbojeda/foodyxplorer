import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white shadow-soft border border-slate-100',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
