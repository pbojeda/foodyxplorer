/**
 * @jest-environment jsdom
 *
 * F059 QA — Edge Cases
 *
 * Targets gaps the developer tests did not cover:
 *
 * 1. CookieBanner "does not write nx-variant cookie on reject" — the existing
 *    test asserts `cookieWritten === null`, which passes only because the jsdom
 *    cookie jar is empty. Once GA cookies are present the GA deletion write
 *    would make it non-null, breaking the intent. This test uses a stricter
 *    assertion (the variant cookie is absent) so it stays correct even when
 *    GA cookies are in the jar.
 *
 * 2. deleteGaCookies handles _ga_* (wildcard) cookies, not just plain _ga.
 *
 * 3. CookieSettingsLink with no GA cookies present still calls reload without
 *    writing anything to document.cookie.
 *
 * 4. deleteGaCookies is idempotent — calling it twice does not throw.
 *
 * 5. CookieBanner "does not write A/B cookie on reject when GA cookies exist" —
 *    the existing assertion would be wrong in this scenario; expose the gap.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookieBanner } from '../components/analytics/CookieBanner';
import { CookieSettingsLink } from '../components/analytics/CookieSettingsLink';
import { deleteGaCookies } from '../lib/deleteGaCookies';

jest.mock('next/script', () => {
  return function MockScript({ onLoad }: { onLoad?: () => void }) {
    if (onLoad) onLoad();
    return null;
  };
});

const VARIANT_COOKIE = 'nx-variant';

// ---------------------------------------------------------------------------
// 1. CookieBanner: reject does NOT write nx-variant cookie even when GA
//    cookies are present in the jar (stricter than the existing null check).
// ---------------------------------------------------------------------------
describe('F059 QA — CookieBanner: no nx-variant write on reject (GA cookies in jar)', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    cookieWrites.length = 0;

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });

    // Seed GA cookies so deleteGaCookies actually writes something
    jest
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('_ga=GA1.2.111.222; _ga_G-ABCDEF=GS1.1.123.1.0.0.0; nx-variant=a');
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('does NOT write the nx-variant cookie to document.cookie on reject (even with GA cookies present)', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }));

    const variantWrite = cookieWrites.find((w) => w.includes(VARIANT_COOKIE));
    expect(variantWrite).toBeUndefined();
  });

  it('DOES write at least one GA deletion cookie when GA cookies are present on reject', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }));

    const gaDeletion = cookieWrites.find((w) => w.startsWith('_ga') && w.includes('max-age=0'));
    expect(gaDeletion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. deleteGaCookies deletes _ga_* wildcard cookies (not just _ga).
// ---------------------------------------------------------------------------
describe('F059 QA — deleteGaCookies handles _ga_* wildcard', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;

  beforeEach(() => {
    cookieWrites.length = 0;
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('deletes _ga_G-XXXXXXX (GA4 measurement ID suffix) cookie', () => {
    jest
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('_ga_G-AB12CD34EF=GS1.1.123.1.0.0.0');

    deleteGaCookies();

    const deletion = cookieWrites.find(
      (w) => w.startsWith('_ga_G-AB12CD34EF=') && w.includes('max-age=0')
    );
    expect(deletion).toBeDefined();
  });

  it('deletes both _ga and _ga_* when both are present', () => {
    jest
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('_ga=GA1.2.111.222; _ga_G-TESTID=GS1.1.1.1.0.0.0');

    deleteGaCookies();

    const gaBaseDeletion = cookieWrites.find(
      (w) => w.startsWith('_ga=') && w.includes('max-age=0')
    );
    const gaWildcardDeletion = cookieWrites.find(
      (w) => w.startsWith('_ga_G-TESTID=') && w.includes('max-age=0')
    );
    expect(gaBaseDeletion).toBeDefined();
    expect(gaWildcardDeletion).toBeDefined();
  });

  it('does not write anything when no _ga cookies are present', () => {
    jest.spyOn(document, 'cookie', 'get').mockReturnValue('nx-variant=a; nx-cookie-consent=accepted');

    deleteGaCookies();

    const gaWrite = cookieWrites.find((w) => w.startsWith('_ga'));
    expect(gaWrite).toBeUndefined();
    expect(cookieWrites).toHaveLength(0);
  });

  it('is idempotent — calling twice does not throw', () => {
    jest
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('_ga=GA1.2.111.222');

    expect(() => {
      deleteGaCookies();
      deleteGaCookies();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. CookieSettingsLink: no GA cookies in jar → does not write to document.cookie.
// ---------------------------------------------------------------------------
describe('F059 QA — CookieSettingsLink: no writes when no GA cookies present', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;
  let reloadMock: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    cookieWrites.length = 0;

    reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock, hostname: 'nutrixplorer.com' },
      writable: true,
    });

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });

    // Empty cookie jar — no GA cookies
    jest.spyOn(document, 'cookie', 'get').mockReturnValue('');
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('does not write to document.cookie when no GA cookies exist', () => {
    render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    expect(cookieWrites).toHaveLength(0);
  });

  it('still calls reload when no GA cookies exist', () => {
    render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. CookieSettingsLink: GA deletion order — GA cookies are deleted BEFORE
//    reload is called (GDPR "immediate effect" requirement).
// ---------------------------------------------------------------------------
describe('F059 QA — CookieSettingsLink: GA cookies deleted before reload', () => {
  const callOrder: string[] = [];
  let reloadMock: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    callOrder.length = 0;

    reloadMock = jest.fn().mockImplementation(() => {
      callOrder.push('reload');
    });
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock, hostname: 'nutrixplorer.com' },
      writable: true,
    });

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      if (val.startsWith('_ga') && val.includes('max-age=0')) {
        callOrder.push('ga-delete');
      }
      cookieDescriptor?.set?.call(document, val);
    });

    jest
      .spyOn(document, 'cookie', 'get')
      .mockReturnValue('_ga=GA1.2.111.222');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes GA cookies before calling reload', () => {
    render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    const gaDeleteIndex = callOrder.indexOf('ga-delete');
    const reloadIndex = callOrder.indexOf('reload');

    expect(gaDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(reloadIndex).toBeGreaterThanOrEqual(0);
    expect(gaDeleteIndex).toBeLessThan(reloadIndex);
  });
});
