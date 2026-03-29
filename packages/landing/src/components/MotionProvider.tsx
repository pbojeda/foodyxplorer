'use client';

import { MotionConfig } from 'framer-motion';

/**
 * MotionProvider — Client Component wrapper that configures framer-motion
 * to respect the OS prefers-reduced-motion setting globally.
 *
 * Must be a Client Component because MotionConfig uses React context.
 * Wraps the layout's children so all motion components respect the user's
 * accessibility preference without SSR hydration mismatches.
 *
 * Note: The `children as unknown` cast works around a @types/react version
 * mismatch between the local (v19) and root monorepo (v18) packages, where
 * framer-motion resolves React types from the root. This is a known issue
 * when multiple React type versions coexist in a monorepo.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const child = children as unknown;
  return (
    <MotionConfig reducedMotion="user">
      {child as Parameters<typeof MotionConfig>[0]['children']}
    </MotionConfig>
  );
}
