/**
 * QA edge-case tests for F060 — GA4 Analytics Integration Fix
 *
 * Targets gaps in the developer's test suite:
 *  1. console.debug is called with the correct arguments in dev mode
 *  2. __nxConsentDenied === false (strict-equality check) must NOT gate events
 *  3. __nxConsentDenied truthy but not === true (e.g. 1, "yes") must NOT gate events
 *  4. drainEventQueue when __nxEventQueue is undefined — must not throw
 *  5. drainEventQueue when __nxEventQueue is undefined — leaves state clean
 *  6. trackEvent with consent-denied + no gtag — queue must NOT grow
 *  7. Queue preserves the full payload (including the event field) for replay
 *  8. drainEventQueue: event key is NOT included in the params object sent to gtag
 *  9. clearEventQueue does not null out window.gtag itself
 * 10. Concurrent / back-to-back drainEventQueue calls — strictly idempotent
 * 11. Queue item at index 49 (newest) survives after 51st push (FIFO overflow)
 * 12. trackEvent with empty-string GA_ID must behave as dev-mode (no queue)
 * 13. drainEventQueue with empty array (not undefined) — must not call gtag
 */

import { trackEvent, drainEventQueue, clearEventQueue } from '@/lib/analytics';
import type { AnalyticsEventPayload } from '@/types';

type WinWithQueue = Window & {
  __nxEventQueue?: AnalyticsEventPayload[];
  __nxConsentDenied?: boolean;
  gtag?: jest.Mock;
};

const basePayload: AnalyticsEventPayload = {
  event: 'landing_view',
  variant: 'a',
  lang: 'es',
};

// ---------------------------------------------------------------------------
// 1. console.debug called with correct arguments in dev mode
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent dev mode — console.debug argument shape', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).gtag;
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    jest.restoreAllMocks();
  });

  it('console.debug is called with "[Analytics]" prefix and the payload', () => {
    trackEvent(basePayload);
    expect(console.debug).toHaveBeenCalledWith('[Analytics]', basePayload);
  });
});

// ---------------------------------------------------------------------------
// 2–3. __nxConsentDenied strict equality — only `=== true` gates events
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent consent-denied — strict === true check', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxEventQueue;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('events are NOT dropped when __nxConsentDenied === false', () => {
    (window as WinWithQueue).__nxConsentDenied = false;
    trackEvent(basePayload);
    expect((window as WinWithQueue).gtag).toHaveBeenCalledTimes(1);
  });

  it('events are NOT dropped when __nxConsentDenied is undefined', () => {
    delete (window as WinWithQueue).__nxConsentDenied;
    trackEvent(basePayload);
    expect((window as WinWithQueue).gtag).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4–5. drainEventQueue when __nxEventQueue is undefined
// ---------------------------------------------------------------------------

describe('F060-QA: drainEventQueue — queue undefined (never initialised)', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).__nxConsentDenied;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('does not throw when __nxEventQueue is undefined', () => {
    expect(() => drainEventQueue()).not.toThrow();
  });

  it('does not call gtag when __nxEventQueue is undefined', () => {
    drainEventQueue();
    expect((window as WinWithQueue).gtag).not.toHaveBeenCalled();
  });

  it('leaves __nxEventQueue undefined (does not initialise it)', () => {
    drainEventQueue();
    expect((window as WinWithQueue).__nxEventQueue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. trackEvent with consent-denied flag + no gtag — queue must NOT grow
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent consent-denied — queue does not grow', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    (window as WinWithQueue).__nxConsentDenied = true;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
  });

  it('does not create or grow __nxEventQueue when consent is denied and gtag is absent', () => {
    trackEvent(basePayload);
    trackEvent({ ...basePayload, event: 'hero_cta_click' });
    const queue = (window as WinWithQueue).__nxEventQueue;
    expect(queue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Queue preserves full payload (event field intact for replay)
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent — queued payload structure', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
  });

  it('queued item retains the event field so drainEventQueue can replay correctly', () => {
    const payload: AnalyticsEventPayload = { event: 'waitlist_submit_success', variant: 'b', lang: 'es' };
    trackEvent(payload);
    const queue = (window as WinWithQueue).__nxEventQueue!;
    expect(queue).toHaveLength(1);
    expect(queue[0].event).toBe('waitlist_submit_success');
  });

  it('queued item retains all non-event fields', () => {
    const payload: AnalyticsEventPayload = {
      event: 'scroll_depth',
      variant: 'a',
      lang: 'es',
      depth: 75,
      utm_source: 'google',
    };
    trackEvent(payload);
    const queued = (window as WinWithQueue).__nxEventQueue![0];
    expect(queued).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// 8. drainEventQueue: event key NOT in params passed to gtag
// ---------------------------------------------------------------------------

describe('F060-QA: drainEventQueue — event key absent from params', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxConsentDenied;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('replayed gtag call has event name as 2nd arg and params WITHOUT event key as 3rd arg', () => {
    const payload: AnalyticsEventPayload = {
      event: 'hero_cta_click',
      variant: 'a',
      lang: 'es',
      utm_source: 'facebook',
    };
    (window as WinWithQueue).__nxEventQueue = [payload];

    drainEventQueue();

    const gtagMock = (window as WinWithQueue).gtag!;
    expect(gtagMock).toHaveBeenCalledTimes(1);
    const [callType, eventName, params] = (gtagMock.mock.calls[0] as [string, string, Record<string, unknown>]);
    expect(callType).toBe('event');
    expect(eventName).toBe('hero_cta_click');
    expect(params).not.toHaveProperty('event');
    expect(params).toEqual({ variant: 'a', lang: 'es', utm_source: 'facebook' });
  });
});

// ---------------------------------------------------------------------------
// 9. clearEventQueue does not null out window.gtag
// ---------------------------------------------------------------------------

describe('F060-QA: clearEventQueue — does not affect window.gtag', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxEventQueue;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('window.gtag remains defined after clearEventQueue', () => {
    clearEventQueue();
    expect((window as WinWithQueue).gtag).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Back-to-back drainEventQueue calls — strictly idempotent (zero work on 2nd+)
// ---------------------------------------------------------------------------

describe('F060-QA: drainEventQueue — multiple rapid calls', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('three consecutive drainEventQueue calls replay each event exactly once', () => {
    const p1: AnalyticsEventPayload = { event: 'landing_view', variant: 'a', lang: 'es' };
    const p2: AnalyticsEventPayload = { event: 'hero_cta_click', variant: 'a', lang: 'es' };
    (window as WinWithQueue).__nxEventQueue = [p1, p2];

    drainEventQueue();
    drainEventQueue();
    drainEventQueue();

    expect((window as WinWithQueue).gtag).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 11. Queue item at index 49 (the newest) survives after 51st push
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent queue cap — newest item at position 49 survives overflow', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
  });

  it('the 50th item (newest before overflow) is present after 51 total pushes', () => {
    // Push items 0–49 (50 total) — fills the queue
    for (let i = 0; i < 50; i++) {
      trackEvent({ ...basePayload, idx: i } as AnalyticsEventPayload);
    }
    // Push item 50 (51st) — oldest (idx:0) must be dropped; idx:49 must survive
    trackEvent({ ...basePayload, marker: '51st' } as AnalyticsEventPayload);

    const queue = (window as WinWithQueue).__nxEventQueue!;
    expect(queue).toHaveLength(50);

    const hasNewest = queue.some(
      (item) => (item as AnalyticsEventPayload & { idx?: number }).idx === 49
    );
    expect(hasNewest).toBe(true);

    const has51st = queue.some(
      (item) => (item as AnalyticsEventPayload & { marker?: string }).marker === '51st'
    );
    expect(has51st).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Empty-string GA_ID must behave as dev-mode (no queue, console.debug fires)
// ---------------------------------------------------------------------------

describe('F060-QA: trackEvent — empty-string GA_ID treated as dev mode', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = '';
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).__nxConsentDenied;
    delete (window as WinWithQueue).gtag;
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    jest.restoreAllMocks();
    delete (window as WinWithQueue).__nxEventQueue;
  });

  it('calls console.debug when GA_ID is an empty string', () => {
    trackEvent(basePayload);
    expect(console.debug).toHaveBeenCalledWith('[Analytics]', basePayload);
  });

  it('does not push to __nxEventQueue when GA_ID is an empty string', () => {
    trackEvent(basePayload);
    expect((window as WinWithQueue).__nxEventQueue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 13. drainEventQueue with empty array (not undefined) — must not call gtag
// ---------------------------------------------------------------------------

describe('F060-QA: drainEventQueue — empty array (not undefined)', () => {
  const originalGaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123';
    (window as WinWithQueue).__nxEventQueue = [];
    delete (window as WinWithQueue).__nxConsentDenied;
    (window as WinWithQueue).gtag = jest.fn();
  });

  afterEach(() => {
    if (originalGaId !== undefined) {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalGaId;
    } else {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    }
    delete (window as WinWithQueue).__nxEventQueue;
    delete (window as WinWithQueue).gtag;
  });

  it('does not call gtag when __nxEventQueue is an empty array', () => {
    drainEventQueue();
    expect((window as WinWithQueue).gtag).not.toHaveBeenCalled();
  });

  it('does not throw when __nxEventQueue is an empty array', () => {
    expect(() => drainEventQueue()).not.toThrow();
  });
});
