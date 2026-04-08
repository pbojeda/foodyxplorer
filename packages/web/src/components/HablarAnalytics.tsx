'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * HablarAnalytics — analytics sentinel for the /hablar page.
 * Uses useSearchParams to read UTM params from the URL on mount,
 * then pushes hablar_page_view to window.dataLayer.
 *
 * Uses (window.dataLayer = window.dataLayer || []).push(...) pattern —
 * guarantees the queue exists even if gtag.js hasn't loaded yet.
 * GA4 replays the dataLayer queue on initialization.
 *
 * Returns null — renders nothing to the DOM.
 * Must be wrapped in <Suspense> at the call site (required for useSearchParams).
 */
export function HablarAnalytics() {
  const params = useSearchParams();

  useEffect(() => {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({
      event: 'hablar_page_view',
      utm_source: params.get('utm_source') ?? undefined,
      utm_medium: params.get('utm_medium') ?? undefined,
      utm_campaign: params.get('utm_campaign') ?? undefined,
    });
  }, [params]);

  return null;
}
