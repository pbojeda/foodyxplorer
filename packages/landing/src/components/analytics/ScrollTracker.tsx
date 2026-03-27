'use client';

import { useEffect, useRef } from 'react';
import type { Variant } from '@/types';
import { trackEvent, getUtmParams } from '@/lib/analytics';

const THRESHOLDS = [25, 50, 75, 100] as const;

interface ScrollTrackerProps {
  variant: Variant;
}

export function ScrollTracker({ variant }: ScrollTrackerProps) {
  const firedRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function checkScroll() {
      const scrollY = window.scrollY;
      const innerHeight = window.innerHeight;
      const totalHeight = document.body.scrollHeight;

      if (totalHeight <= 0) return;

      const percent = ((scrollY + innerHeight) / totalHeight) * 100;

      for (const threshold of THRESHOLDS) {
        if (percent >= threshold && !firedRef.current.has(threshold)) {
          firedRef.current.add(threshold);
          trackEvent({
            event: 'scroll_depth',
            depth: threshold,
            variant,
            lang: 'es',
            ...getUtmParams(),
          });
        }
      }
    }

    function handleScroll() {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(checkScroll);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Check initial position (page might load scrolled)
    checkScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [variant]);

  return null;
}
