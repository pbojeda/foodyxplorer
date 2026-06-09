// F-WEB-TIER: LoginCta component tests.
// AC17 (renders button + aria-label), AC18 (hidden while authLoading),
// AC19 (hidden when user != null), AC20 (login_cta_shown on mount),
// AC21 (click fires login_cta_clicked + router.push('/login')).

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

// Default: logged-out, not loading
const mockUseAuth = jest.fn(() => ({
  user: null,
  session: null,
  account: null,
  loading: false,
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { LoginCta } from '../../components/LoginCta';
import { trackEvent } from '../../lib/metrics';

const mockTrackEvent = trackEvent as jest.Mock;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginCta (F-WEB-TIER)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
  });

  it('AC17: renders "Iniciar sesión" button with correct aria-label', () => {
    render(<LoginCta />);
    const btn = screen.getByRole('button', { name: /Iniciar sesión o registrarse/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe('Iniciar sesión');
    expect(btn).toHaveAttribute('aria-label', 'Iniciar sesión o registrarse');
  });

  it('AC18: renders null while authLoading is true', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      account: null,
      loading: true,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    const { container } = render(<LoginCta />);
    expect(container.firstChild).toBeNull();
  });

  it('AC19: renders null when user is not null', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-uuid', email: 'test@example.com' } as never,
      session: null,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    const { container } = render(<LoginCta />);
    expect(container.firstChild).toBeNull();
  });

  it('AC20: fires login_cta_shown on mount', () => {
    render(<LoginCta />);
    expect(mockTrackEvent).toHaveBeenCalledWith('login_cta_shown');
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('AC21: fires login_cta_clicked and navigates to /login on click', async () => {
    render(<LoginCta />);
    const btn = screen.getByRole('button', { name: /Iniciar sesión o registrarse/i });
    await userEvent.click(btn);
    expect(mockTrackEvent).toHaveBeenCalledWith('login_cta_clicked');
    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});
