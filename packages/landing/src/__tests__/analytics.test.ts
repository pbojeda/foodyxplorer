import { trackEvent, getUtmParams } from '@/lib/analytics';
import type { AnalyticsEventPayload } from '@/types';

const basePayload: AnalyticsEventPayload = {
  event: 'landing_view',
  variant: 'a',
  lang: 'es',
};

// --- trackEvent — dev mode (no GA_ID) ---

describe('trackEvent — dev mode (no GA_ID)', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { gtag?: unknown }).gtag;
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    jest.restoreAllMocks();
  });

  it('calls console.debug when GA_ID is not set', () => {
    trackEvent(basePayload);
    expect(console.debug).toHaveBeenCalled();
  });

  it('does not push to __nxEventQueue when GA_ID is not set', () => {
    trackEvent(basePayload);
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toBeUndefined();
  });
});

// --- trackEvent — consent denied flag ---

describe('trackEvent — consent denied flag', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied = true;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    (window as Window & { gtag?: jest.Mock }).gtag = jest.fn();
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { gtag?: unknown }).gtag;
    jest.restoreAllMocks();
  });

  it('drops event silently — no console.debug', () => {
    trackEvent(basePayload);
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('drops event silently — no queue push', () => {
    trackEvent(basePayload);
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toBeUndefined();
  });

  it('drops event silently — no gtag call', () => {
    trackEvent(basePayload);
    expect((window as Window & { gtag?: jest.Mock }).gtag).not.toHaveBeenCalled();
  });
});

// --- trackEvent — gtag available ---

describe('trackEvent — gtag available', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    (window as Window & { gtag?: jest.Mock }).gtag = jest.fn();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it('calls window.gtag("event", eventName, params) — event key not in params', () => {
    trackEvent(basePayload);
    const gtagMock = (window as Window & { gtag?: jest.Mock }).gtag!;
    expect(gtagMock).toHaveBeenCalledTimes(1);
    expect(gtagMock).toHaveBeenCalledWith('event', 'landing_view', { variant: 'a', lang: 'es' });
  });

  it('does not push to __nxEventQueue when gtag is available', () => {
    trackEvent(basePayload);
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toBeUndefined();
  });
});

// --- trackEvent — queue path ---

describe('trackEvent — queue path', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { gtag?: unknown }).gtag;
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    jest.restoreAllMocks();
  });

  it('pushes payload to __nxEventQueue when gtag is undefined', () => {
    trackEvent(basePayload);
    const queue = (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue;
    expect(queue).toBeDefined();
    expect(queue).toHaveLength(1);
    expect(queue![0]).toEqual(basePayload);
  });

  it('creates __nxEventQueue as empty array if not yet initialised, then adds item', () => {
    expect((window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue).toBeUndefined();
    trackEvent(basePayload);
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(Array.isArray(queue)).toBe(true);
  });

  it('caps queue at 50 items — 51st call does not grow the queue', () => {
    for (let i = 0; i < 51; i++) {
      trackEvent({ ...basePayload, event: 'scroll_depth', depth: i } as AnalyticsEventPayload);
    }
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toHaveLength(50);
  });

  it('drops oldest item on overflow (FIFO) — first item pushed is gone after 51 calls', () => {
    const firstPayload: AnalyticsEventPayload = { ...basePayload, marker: 'first' };
    trackEvent(firstPayload);
    for (let i = 1; i < 51; i++) {
      trackEvent({ ...basePayload, event: 'scroll_depth' } as AnalyticsEventPayload);
    }
    const queue = (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue;
    expect(queue).toHaveLength(50);
    const hasFirst = queue!.some((item) => (item as AnalyticsEventPayload & { marker?: string }).marker === 'first');
    expect(hasFirst).toBe(false);
  });

  it('does not call console.debug when queuing', () => {
    trackEvent(basePayload);
    expect(console.debug).not.toHaveBeenCalled();
  });
});

// --- drainEventQueue ---

import { drainEventQueue } from '@/lib/analytics';

describe('drainEventQueue', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    (window as Window & { gtag?: jest.Mock }).gtag = jest.fn();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it('calls gtag for each queued item in FIFO order', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    const p2: AnalyticsEventPayload = { event: 'hero_cta_click', variant: 'a', lang: 'es' };
    const p3: AnalyticsEventPayload = { event: 'waitlist_cta_click', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1, p2, p3];

    drainEventQueue();

    const gtagMock = (window as Window & { gtag?: jest.Mock }).gtag!;
    expect(gtagMock).toHaveBeenCalledTimes(3);
    expect(gtagMock).toHaveBeenNthCalledWith(1, 'event', 'landing_view', { variant: 'a', lang: 'es' });
    expect(gtagMock).toHaveBeenNthCalledWith(2, 'event', 'hero_cta_click', { variant: 'a', lang: 'es' });
    expect(gtagMock).toHaveBeenNthCalledWith(3, 'event', 'waitlist_cta_click', { variant: 'a', lang: 'es' });
  });

  it('clears the queue after draining', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1];

    drainEventQueue();

    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toHaveLength(0);
  });

  it('is idempotent — second call does not invoke gtag again', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    const p2: AnalyticsEventPayload = { event: 'hero_cta_click', variant: 'a', lang: 'es' };
    const p3: AnalyticsEventPayload = { event: 'waitlist_cta_click', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1, p2, p3];

    drainEventQueue();
    drainEventQueue();

    const gtagMock = (window as Window & { gtag?: jest.Mock }).gtag!;
    expect(gtagMock).toHaveBeenCalledTimes(3);
  });

  it('does not call gtag when queue is empty', () => {
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [];

    drainEventQueue();

    const gtagMock = (window as Window & { gtag?: jest.Mock }).gtag!;
    expect(gtagMock).not.toHaveBeenCalled();
  });
});

// --- clearEventQueue ---

import { clearEventQueue } from '@/lib/analytics';

describe('clearEventQueue', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    (window as Window & { gtag?: jest.Mock }).gtag = jest.fn();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it('sets __nxEventQueue to empty array', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1];

    clearEventQueue();

    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(Array.isArray(queue)).toBe(true);
    expect(queue).toHaveLength(0);
  });

  it('sets __nxConsentDenied to true', () => {
    clearEventQueue();
    expect((window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied).toBe(true);
  });

  it('subsequent trackEvent calls are dropped silently after clearEventQueue', () => {
    clearEventQueue();
    trackEvent(basePayload);
    const gtagMock = (window as Window & { gtag?: jest.Mock }).gtag!;
    expect(gtagMock).not.toHaveBeenCalled();
  });

  it('does not throw when queue was never initialised', () => {
    expect(() => clearEventQueue()).not.toThrow();
  });
});

// --- getUtmParams ---

describe('getUtmParams', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  function setSearch(search: string) {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search },
      writable: true,
      configurable: true,
    });
  }

  it('parses utm_source, utm_medium, utm_campaign from query string', () => {
    setSearch('?utm_source=google&utm_medium=cpc&utm_campaign=landing');
    const params = getUtmParams();
    expect(params).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'landing',
    });
  });

  it('returns empty object when no UTM params are present', () => {
    setSearch('');
    const params = getUtmParams();
    expect(params).toEqual({});
  });

  it('returns only present utm params', () => {
    setSearch('?utm_source=twitter');
    const params = getUtmParams();
    expect(params).toEqual({ utm_source: 'twitter' });
  });
});

// --- drainEventQueue — no gtag defined (adblocker scenario) ---

describe('drainEventQueue — no gtag defined', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { gtag?: unknown }).gtag;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
  });

  it('does not throw when queue has items but gtag is undefined', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1];

    expect(() => drainEventQueue()).not.toThrow();
  });

  it('clears the queue even when gtag is undefined', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue = [p1];

    drainEventQueue();

    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toHaveLength(0);
  });
});

// --- trackEvent — queue cap boundary (explicit verification) ---

describe('trackEvent — queue cap boundary', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as Window & { gtag?: unknown }).gtag;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
  });

  it('queue length stays at 50 after exactly 50 calls', () => {
    for (let i = 0; i < 50; i++) {
      trackEvent({ ...basePayload, event: 'scroll_depth', idx: i } as AnalyticsEventPayload);
    }
    const queue = (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
    expect(queue).toHaveLength(50);
  });

  it('oldest item is dropped when 51st item arrives', () => {
    const markedFirst: AnalyticsEventPayload = { ...basePayload, marker: 'oldest' };
    trackEvent(markedFirst);
    for (let i = 1; i < 51; i++) {
      trackEvent({ ...basePayload, event: 'scroll_depth', idx: i } as AnalyticsEventPayload);
    }
    const queue = (window as Window & { __nxEventQueue?: AnalyticsEventPayload[] }).__nxEventQueue;
    expect(queue).toHaveLength(50);
    const hasOldest = queue!.some(
      (item) => (item as AnalyticsEventPayload & { marker?: string }).marker === 'oldest'
    );
    expect(hasOldest).toBe(false);
  });
});
