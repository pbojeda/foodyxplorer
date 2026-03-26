import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'bg-brand-orange text-white font-semibold',
    'rounded-xl',
    'shadow-soft hover:opacity-90 active:scale-[0.98]',
    'transition-all duration-200',
    'focus:ring-2 focus:ring-brand-green focus:ring-offset-2',
    'disabled:opacity-50 disabled:pointer-events-none',
  ].join(' '),
  secondary: [
    'border border-slate-300 bg-transparent text-slate-700',
    'rounded-xl',
    'hover:border-slate-400 hover:bg-slate-50',
    'transition-all duration-200',
    'focus:ring-2 focus:ring-brand-green focus:ring-offset-2',
    'disabled:opacity-50 disabled:pointer-events-none',
  ].join(' '),
  ghost: [
    'bg-transparent text-slate-600',
    'rounded-lg',
    'hover:bg-slate-100 hover:text-slate-800',
    'transition-all duration-150',
    'focus:ring-2 focus:ring-brand-green focus:ring-offset-2',
    'disabled:opacity-50 disabled:pointer-events-none',
  ].join(' '),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-8 py-3.5 text-base',
  lg: 'px-10 py-4 text-base',
};

const Spinner = () => (
  <svg
    className="animate-spin h-5 w-5 text-current"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
      opacity="0.25"
    />
    <path
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={isLoading || disabled}
        className={cn(variantClasses[variant], sizeClasses[size], className)}
        {...props}
      >
        {isLoading ? <Spinner /> : children}
      </button>
    );
  }
);

Button.displayName = 'Button';
