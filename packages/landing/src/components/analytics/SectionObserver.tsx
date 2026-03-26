'use client';

import { useEffect, useRef } from 'react';
import type { Variant, SectionId } from '@/types';
import { trackEvent, getUtmParams } from '@/lib/analytics';

interface SectionObserverProps {
  sectionId: SectionId;
  variant: Variant;
  children: React.ReactNode;
}

export function SectionObserver({
  sectionId,
  variant,
  children,
}: SectionObserverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true;
            trackEvent({
              event: 'section_view',
              section: sectionId,
              variant,
              lang: 'es',
              ...getUtmParams(),
            });
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [sectionId, variant]);

  return <div ref={ref}>{children}</div>;
}
