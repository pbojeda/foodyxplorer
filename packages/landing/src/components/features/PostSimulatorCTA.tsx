'use client';

import { WaitlistForm } from '@/components/features/WaitlistForm';
import type { Variant } from '@/types';

interface PostSimulatorCTAProps {
  variant: Variant;
  /** When true, the CTA is visible (user has interacted with the simulator). */
  show: boolean;
}

/**
 * PostSimulatorCTA — inline CTA that appears after the user interacts with SearchSimulator.
 * Email-only form with source="post-simulator".
 * Fades in when show=true.
 */
export function PostSimulatorCTA({ variant, show }: PostSimulatorCTAProps) {
  if (!show) return null;

  return (
    <div
      className="mt-6 animate-fadeIn rounded-[32px] border border-botanical/20 bg-mist p-6 md:p-8"
      aria-live="polite"
    >
      <h3 className="mb-2 text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
        ¿Te gusta lo que ves?
      </h3>
      <p className="mb-6 text-base leading-relaxed text-slate-600">
        Apúntate para acceder cuando lancemos.
      </p>
      <WaitlistForm source="post-simulator" variant={variant} showPhone={false} />
    </div>
  );
}
