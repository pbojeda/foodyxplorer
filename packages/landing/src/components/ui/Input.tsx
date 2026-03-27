import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, id, error, className, ...props }, ref) => {
    return (
      <div className="flex flex-col">
        <label
          htmlFor={id}
          className="text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={cn(
            'bg-white text-slate-700',
            'rounded-xl px-4 py-3.5 text-base',
            'placeholder:text-slate-400',
            'transition-colors duration-200',
            'focus:outline-none focus:ring-2',
            error
              ? 'border border-red-500 focus:ring-red-500/20 focus:border-red-500'
              : 'border border-slate-300 focus:border-brand-green focus:ring-brand-green/20',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="mt-1.5 text-sm text-red-500"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
