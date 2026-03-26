import React from 'react';
import { render, screen } from '@testing-library/react';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { getDictionary } from '@/lib/i18n';

// Mock fetch
global.fetch = jest.fn();

const dict = getDictionary('es');

describe('WaitlistCTASection', () => {
  it('renders the headline', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.headline)).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.subtitle)).toBeInTheDocument();
  });

  it('renders the trust note', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByText(dict.waitlistCta.trustNote)).toBeInTheDocument();
  });

  it('renders WaitlistForm with email input', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
  });

  it('renders with variant b', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="b" />);
    expect(screen.getByText(dict.waitlistCta.headline)).toBeInTheDocument();
  });
});
