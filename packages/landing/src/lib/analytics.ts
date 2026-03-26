import type { AnalyticsEventPayload } from '@/types';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(payload: AnalyticsEventPayload): void {
  if (typeof window === 'undefined') return;

  if (window.dataLayer) {
    window.dataLayer.push(payload);
  }
}

export function getUtmParams(): Pick<
  AnalyticsEventPayload,
  'utm_source' | 'utm_medium' | 'utm_campaign'
> {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  const result: Pick<
    AnalyticsEventPayload,
    'utm_source' | 'utm_medium' | 'utm_campaign'
  > = {};

  const source = params.get('utm_source');
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');

  if (source) result.utm_source = source;
  if (medium) result.utm_medium = medium;
  if (campaign) result.utm_campaign = campaign;

  return result;
}
