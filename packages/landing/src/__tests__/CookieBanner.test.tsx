/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookieBanner } from '@/components/analytics/CookieBanner';

// Mock next/script
jest.mock('next/script', () => {
  return function MockScript({ onLoad }: { onLoad?: () => void }) {
    if (onLoad) onLoad();
    return null;
  };
});

const CONSENT_KEY = 'nx-cookie-consent';
const VARIANT_COOKIE = 'nx-variant';

// Track cookie writes
let cookieWritten: string | null = null;

describe('CookieBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    cookieWritten = null;

    // Intercept cookie writes via a spy on the setter
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWritten = val;
      cookieDescriptor?.set?.call(document, val);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the banner when no consent is stored', () => {
    render(<CookieBanner variant="a" />);
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
  });

  it('does not render when consent is already stored', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    render(<CookieBanner variant="a" />);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('does not render when consent is rejected and already stored', () => {
    localStorage.setItem(CONSENT_KEY, 'rejected');
    render(<CookieBanner variant="a" />);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('stores accepted consent in localStorage on accept click', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }));
    expect(localStorage.getItem(CONSENT_KEY)).toBe('accepted');
  });

  it('writes A/B cookie to document.cookie on accept click', () => {
    render(<CookieBanner variant="b" />);
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }));

    expect(cookieWritten).toContain(`${VARIANT_COOKIE}=b`);
  });

  it('stores rejected consent in localStorage on reject click', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }));
    expect(localStorage.getItem(CONSENT_KEY)).toBe('rejected');
  });

  it('does not write A/B cookie on reject click', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }));

    expect(cookieWritten).toBeNull();
  });

  it('disappears after accept choice', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }));
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('disappears after reject choice', () => {
    render(<CookieBanner variant="a" />);
    fireEvent.click(screen.getByRole('button', { name: /rechazar/i }));
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });
});
