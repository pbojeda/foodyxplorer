/**
 * PostSimulatorCTA — inline CTA that appears after SearchSimulator interaction.
 * Only visible after user has interacted with the simulator.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { PostSimulatorCTA } from '@/components/features/PostSimulatorCTA';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

global.fetch = jest.fn();

describe('PostSimulatorCTA', () => {
  it('is hidden when show=false (default)', () => {
    render(<PostSimulatorCTA variant="a" show={false} />);
    // The form should not be visible
    expect(screen.queryByRole('button', { name: /únete/i })).not.toBeInTheDocument();
  });

  it('shows headline when show=true', () => {
    render(<PostSimulatorCTA variant="a" show={true} />);
    expect(screen.getByText(/te gusta lo que ves/i)).toBeInTheDocument();
  });

  it('shows subtitle when show=true', () => {
    render(<PostSimulatorCTA variant="a" show={true} />);
    expect(screen.getByText(/apúntate/i)).toBeInTheDocument();
  });

  it('shows email-only WaitlistForm when show=true', () => {
    render(<PostSimulatorCTA variant="a" show={true} />);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
    // No phone field
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument();
  });

  it('uses animate-fade-in class (not animate-fadeIn)', () => {
    const { container } = render(<PostSimulatorCTA variant="a" show={true} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('animate-fade-in');
    expect(wrapper).not.toHaveClass('animate-fadeIn');
  });
});
