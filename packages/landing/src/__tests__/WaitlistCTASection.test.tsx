/**
 * @jest-environment jsdom
 *
 * F047 — WaitlistCTASection: waitlist counter fetch tests
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { getDictionary } from '@/lib/i18n';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const dict = getDictionary('es');

beforeEach(() => {
  mockFetch.mockClear();
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
});

afterEach(() => {
  jest.clearAllTimers();
});

describe('WaitlistCTASection — waitlist counter', () => {
  it('shows counter when count >= 10', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 42 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });
    expect(screen.getByText(/ya se han apuntado/i)).toBeInTheDocument();
  });

  it('does not show counter when count < 10', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 5 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    // Wait for fetch to resolve
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/ya se han apuntado/i)).not.toBeInTheDocument();
  });

  it('does not show counter when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/ya se han apuntado/i)).not.toBeInTheDocument();
  });

  it('does not show counter when fetch returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/ya se han apuntado/i)).not.toBeInTheDocument();
  });

  it('fetches from NEXT_PUBLIC_API_URL/waitlist/count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 15 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/waitlist/count');
    });
  });

  it('does not throw on fetch error (graceful degradation)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    expect(() => render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />)).not.toThrow();

    // No uncaught error after the fetch rejects
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('shows counter with exact count in text "Ya se han apuntado X personas"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 123 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(screen.getByText(/ya se han apuntado 123 personas/i)).toBeInTheDocument();
    });
  });

  it('does not show counter when count is exactly 9 (below threshold)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 9 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(/ya se han apuntado/i)).not.toBeInTheDocument();
  });

  it('shows counter when count is exactly 10 (at threshold)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { count: 10 } }),
    });

    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);

    await waitFor(() => {
      expect(screen.getByText(/ya se han apuntado 10 personas/i)).toBeInTheDocument();
    });
  });
});
