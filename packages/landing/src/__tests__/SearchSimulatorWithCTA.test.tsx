/**
 * SearchSimulatorWithCTA — wraps SearchSimulator + PostSimulatorCTA
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchSimulatorWithCTA } from '@/components/features/SearchSimulatorWithCTA';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, onClick, disabled, className, 'aria-label': ariaLabel }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      className?: string;
      'aria-label'?: string;
    }) => (
      <button onClick={onClick} disabled={disabled} className={className} aria-label={ariaLabel}>
        {children}
      </button>
    ),
  },
}));

global.fetch = jest.fn();

describe('SearchSimulatorWithCTA', () => {
  it('renders the SearchSimulator', () => {
    render(<SearchSimulatorWithCTA variant="a" />);
    expect(screen.getByLabelText(/buscar plato/i)).toBeInTheDocument();
  });

  it('PostSimulatorCTA is hidden on initial render (BUG-LANDING-05)', () => {
    render(<SearchSimulatorWithCTA variant="a" />);
    // CTA must NOT be visible before user has interacted
    expect(screen.queryByText(/te gusta lo que ves/i)).not.toBeInTheDocument();
  });

  it('PostSimulatorCTA appears after onInteract fires', async () => {
    const user = userEvent.setup();
    render(<SearchSimulatorWithCTA variant="a" />);
    // CTA hidden initially
    expect(screen.queryByText(/te gusta lo que ves/i)).not.toBeInTheDocument();
    // Click a dish chip to trigger interaction
    const dishChips = screen.getAllByRole('button');
    await user.click(dishChips[0]);
    // CTA should now be visible
    expect(screen.getByText(/te gusta lo que ves/i)).toBeInTheDocument();
  });

  it('PostSimulatorCTA shows email-only form after interaction', async () => {
    const user = userEvent.setup();
    render(<SearchSimulatorWithCTA variant="a" />);
    const dishChips = screen.getAllByRole('button');
    await user.click(dishChips[0]);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument();
  });
});
