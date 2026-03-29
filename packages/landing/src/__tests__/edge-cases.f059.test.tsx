/**
 * @jest-environment jsdom
 *
 * F059 — Legal/GDPR Compliance: Cross-Cutting Edge-Case Tests
 *
 * Covers the one integration flow not fully exercised by unit tests:
 * clear consent → reload simulation → CookieBanner re-appears (consent === null).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookieBanner } from '../components/analytics/CookieBanner';
import { CookieSettingsLink } from '../components/analytics/CookieSettingsLink';

jest.mock('next/script', () => {
  return function MockScript({ onLoad }: { onLoad?: () => void }) {
    if (onLoad) onLoad();
    return null;
  };
});

const CONSENT_KEY = 'nx-cookie-consent';

describe('F059 — Clear consent → reload → banner re-appears', () => {
  let reloadMock: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('CookieBanner shows when consent is null (initial state)', () => {
    render(<CookieBanner variant="a" />);
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
  });

  it('CookieBanner hides when consent is "accepted" in localStorage', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    render(<CookieBanner variant="a" />);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('CookieSettingsLink clears consent from localStorage', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    render(<CookieSettingsLink label="Gestionar cookies" />);

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('after CookieSettingsLink clears consent, a fresh CookieBanner mount shows the banner', () => {
    // Simulate: user previously accepted, then clicks "Gestionar cookies"
    localStorage.setItem(CONSENT_KEY, 'accepted');

    // Step 1: CookieSettingsLink clears consent
    const { unmount } = render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));
    unmount();

    // Consent is now null in localStorage
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();

    // Step 2: After reload, CookieBanner re-mounts and sees null consent
    render(<CookieBanner variant="a" />);
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
  });
});
