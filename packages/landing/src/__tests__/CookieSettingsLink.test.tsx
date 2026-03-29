/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookieSettingsLink } from '../components/analytics/CookieSettingsLink';

const CONSENT_KEY = 'nx-cookie-consent';

describe('CookieSettingsLink', () => {
  let reloadMock: jest.Mock;
  let cookieSetSpy: jest.SpyInstance;
  const cookieWrites: string[] = [];

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a button with the provided label', () => {
    render(<CookieSettingsLink label="Gestionar cookies" />);
    expect(screen.getByRole('button', { name: 'Gestionar cookies' })).toBeInTheDocument();
  });

  it('calls localStorage.removeItem for CONSENT_KEY on click', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    render(<CookieSettingsLink label="Gestionar cookies" />);

    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('deletes GA cookies on click', () => {
    jest.spyOn(document, 'cookie', 'get').mockReturnValue('_ga=GA1.2.123456789.1234567890; nx-variant=a');

    render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    const gaDeletion = cookieWrites.find((w) => w.startsWith('_ga=') && w.includes('max-age=0'));
    expect(gaDeletion).toBeDefined();
  });

  it('calls window.location.reload on click', () => {
    render(<CookieSettingsLink label="Gestionar cookies" />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('still calls reload even when localStorage throws', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    render(<CookieSettingsLink label="Gestionar cookies" />);
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Gestionar cookies' }));
    }).not.toThrow();

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a className prop', () => {
    const { container } = render(
      <CookieSettingsLink label="Gestionar cookies" className="text-sm text-slate-400" />
    );
    const button = container.querySelector('button');
    expect(button).toHaveClass('text-sm');
    expect(button).toHaveClass('text-slate-400');
  });
});
