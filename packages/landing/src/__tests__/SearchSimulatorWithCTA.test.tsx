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

  it('initially shows PostSimulatorCTA (because simulator starts with a default result)', () => {
    render(<SearchSimulatorWithCTA variant="a" />);
    // The simulator starts in "result" state (pulpo a feira), so CTA should be visible
    expect(screen.getByText(/te gusta lo que ves/i)).toBeInTheDocument();
  });

  it('PostSimulatorCTA shows email-only form', () => {
    render(<SearchSimulatorWithCTA variant="a" />);
    expect(screen.getByRole('button', { name: /únete/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/teléfono/i)).not.toBeInTheDocument();
  });
});
