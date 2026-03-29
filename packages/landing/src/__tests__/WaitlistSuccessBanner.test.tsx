/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WaitlistSuccessBanner } from '@/components/features/WaitlistSuccessBanner';

// Mock next/navigation with useSearchParams
const mockUseSearchParams = jest.fn(() => new URLSearchParams());

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

describe('WaitlistSuccessBanner', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('does not render when no waitlist param', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    render(<WaitlistSuccessBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render when waitlist param is a different value', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=error'));
    render(<WaitlistSuccessBanner />);
    expect(screen.queryByText(/apuntado/i)).not.toBeInTheDocument();
  });

  it('renders banner when waitlist=success', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=success'));
    render(<WaitlistSuccessBanner />);
    expect(screen.getByText(/apuntado a la waitlist/i)).toBeInTheDocument();
  });

  it('banner has an accessible role (status or alert)', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=success'));
    render(<WaitlistSuccessBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
  });

  it('renders a dismiss button', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=success'));
    render(<WaitlistSuccessBanner />);
    expect(screen.getByRole('button', { name: /cerrar|dismiss/i })).toBeInTheDocument();
  });

  it('clicking dismiss removes the banner from DOM', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=success'));
    render(<WaitlistSuccessBanner />);
    const dismissBtn = screen.getByRole('button', { name: /cerrar|dismiss/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByText(/apuntado a la waitlist/i)).not.toBeInTheDocument();
  });

  it('banner text includes the success message', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('waitlist=success'));
    render(<WaitlistSuccessBanner />);
    expect(screen.getByText(/te avisaremos cuando lancemos/i)).toBeInTheDocument();
  });
});
