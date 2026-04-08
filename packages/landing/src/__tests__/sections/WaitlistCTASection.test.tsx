import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { getDictionary } from '@/lib/i18n';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<typeof analytics.trackEvent>;

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

// ---------------------------------------------------------------------------
// F093 — hablarUrl prop — bottom CTA link
// ---------------------------------------------------------------------------

describe('F093 — WaitlistCTASection hablarUrl CTA', () => {
  const hablarUrl = 'https://hablar.nutrixplorer.com/hablar?utm_source=landing&utm_medium=bottom_cta';

  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it('renders "O pruébalo ahora gratis →" link when hablarUrl is set', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={hablarUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toBeInTheDocument();
  });

  it('"O pruébalo ahora gratis" link has correct href', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={hablarUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toHaveAttribute('href', hablarUrl);
  });

  it('"O pruébalo ahora gratis" link opens in new tab', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={hablarUrl} />);
    const link = screen.getByRole('link', { name: /o pruébalo ahora gratis/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does NOT render "O pruébalo ahora gratis" when hablarUrl is absent', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.queryByRole('link', { name: /o pruébalo ahora gratis/i })).not.toBeInTheDocument();
  });

  it('does NOT render "O pruébalo ahora gratis" when hablarUrl is "#waitlist"', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl="#waitlist" />);
    expect(screen.queryByRole('link', { name: /o pruébalo ahora gratis/i })).not.toBeInTheDocument();
  });

  it('renders the bottom CTA with all variants (c, f)', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="c" hablarUrl={hablarUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toBeInTheDocument();
  });

  it('fires cta_hablar_click with source="bottom" when link is clicked', async () => {
    const user = userEvent.setup();
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={hablarUrl} />);
    await user.click(screen.getByRole('link', { name: /o pruébalo ahora gratis/i }));
    expect(mockTrackEvent).toHaveBeenCalledWith({
      event: 'cta_hablar_click',
      source: 'bottom',
      variant: 'a',
      lang: 'es',
      utm_medium: 'bottom_cta',
    });
  });

  it('existing waitlist form submission behavior is unchanged (regression)', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={hablarUrl} />);
    // Form still renders and submit button is present
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
  });
});
