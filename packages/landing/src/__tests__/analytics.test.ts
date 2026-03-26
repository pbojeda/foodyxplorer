import { trackEvent, getUtmParams } from '@/lib/analytics';
import type { AnalyticsEventPayload } from '@/types';

const basePayload: AnalyticsEventPayload = {
  event: 'landing_view',
  variant: 'a',
  lang: 'es',
};

describe('trackEvent', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'dataLayer', {
      value: [],
      writable: true,
      configurable: true,
    });
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pushes payload to window.dataLayer when available', () => {
    trackEvent(basePayload);
    expect(window.dataLayer).toHaveLength(1);
    expect(window.dataLayer[0]).toEqual(basePayload);
  });

  it('does not throw when window.dataLayer is undefined', () => {
    Object.defineProperty(window, 'dataLayer', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(() => trackEvent(basePayload)).not.toThrow();
  });

  it('silently drops event when dataLayer is undefined', () => {
    Object.defineProperty(window, 'dataLayer', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    trackEvent(basePayload);
    expect(console.debug).not.toHaveBeenCalled();
  });
});

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
