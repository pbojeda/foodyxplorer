import type { AnalyticsEventPayload } from '@/types';

declare global {
  interface Window {
    __nxEventQueue?: AnalyticsEventPayload[];
    __nxConsentDenied?: boolean;
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(payload: AnalyticsEventPayload): void {
  if (typeof window === 'undefined') return;

  if (!process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) {
    console.debug('[Analytics]', payload);
    return;
  }

  if (window.__nxConsentDenied === true) {
    return;
  }

  if (window.gtag) {
    const { event: eventName, ...params } = payload;
    window.gtag('event', eventName, params);
    return;
  }

  window.__nxEventQueue = window.__nxEventQueue ?? [];
  window.__nxEventQueue.push(payload);
  if (window.__nxEventQueue.length > 50) {
    window.__nxEventQueue.shift();
  }
}

export function drainEventQueue(): void {
  if (typeof window === 'undefined') return;
  if (!window.__nxEventQueue || window.__nxEventQueue.length === 0) return;

  const pending = [...window.__nxEventQueue];
  window.__nxEventQueue = [];

  if (!window.gtag) return;

  for (const item of pending) {
    const { event: eventName, ...params } = item;
    window.gtag('event', eventName, params);
  }
}

export function clearEventQueue(): void {
  if (typeof window === 'undefined') return;
  window.__nxEventQueue = [];
  window.__nxConsentDenied = true;
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
