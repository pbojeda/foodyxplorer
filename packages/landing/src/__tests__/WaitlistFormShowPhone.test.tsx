/**
 * Tests for WaitlistForm showPhone prop.
 * When showPhone=false (default), phone field is hidden.
 * When showPhone=true, phone field is shown.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { WaitlistForm } from '@/components/features/WaitlistForm';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

global.fetch = jest.fn();

describe('WaitlistForm — showPhone prop', () => {
  it('does NOT render phone field when showPhone is not set (default false)', () => {
    render(<WaitlistForm source="hero" variant="a" />);
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument();
  });

  it('does NOT render phone field when showPhone=false', () => {
    render(<WaitlistForm source="hero" variant="a" showPhone={false} />);
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument();
  });

  it('renders phone field when showPhone=true', () => {
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    expect(screen.getByPlaceholderText(/teléfono/i)).toBeInTheDocument();
  });

  it('renders email field regardless of showPhone', () => {
    render(<WaitlistForm source="hero" variant="a" />);
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
  });

  it('renders submit button regardless of showPhone', () => {
    render(<WaitlistForm source="hero" variant="a" />);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
  });
});
