import React from 'react';
import { render, screen } from '@testing-library/react';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { getDictionary } from '@/lib/i18n';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

// Mock fetch — return graceful degradation response by default (counter hidden)
const mockFetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, data: { count: 0 } }),
});
global.fetch = mockFetch;

const dict = getDictionary('es');

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { count: 0 } }),
  });
});

describe('WaitlistCTASection', () => {
  it('renders the headline', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.headline)).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.subtitle)).toBeInTheDocument();
  });

  it('renders the urgency copy', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.urgency)).toBeInTheDocument();
  });

  it('renders the trust note', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.trustNote)).toBeInTheDocument();
  });

  it('renders WaitlistForm with email input', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
  });

  it('renders phone field (showPhone=true in CTA section)', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByPlaceholderText(/teléfono/i)).toBeInTheDocument();
  });

  it('renders with variant c', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="c" />);
    expect(screen.getByText(dict.waitlistCta.headline)).toBeInTheDocument();
  });

  it('root section has id="waitlist" for anchor navigation (BUG-LANDING-03)', () => {
    const { container } = render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(container.querySelector('#waitlist')).not.toBeNull();
  });
});
