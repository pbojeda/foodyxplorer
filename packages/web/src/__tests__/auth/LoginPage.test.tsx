// F107a: LoginPage component tests — AC17, AC18, AC22
// Tests: form renders; no Google button; success state; error query params; loading state.

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

const mockSignIn = jest.fn();
const mockSignOut = jest.fn();

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    error: null,
    signIn: mockSignIn,
    signOut: mockSignOut,
  }),
}));

import LoginPage from '../../app/login/page';

function renderLoginPage(searchParams = new URLSearchParams()) {
  mockSearchParams = searchParams;
  return render(<LoginPage />);
}

describe('LoginPage (AC17, AC18, AC22)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  // AC17 — form renders with correct elements
  it('renders an email input', () => {
    renderLoginPage();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
  });

  it('renders the "Entrar con email" submit button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /entrar con email/i })).toBeInTheDocument();
  });

  it('does NOT render a Google button (AC17 — F107a-FU1 deferred)', () => {
    renderLoginPage();
    expect(screen.queryByText(/google/i)).toBeNull();
  });

  // AC18 — success state
  it('shows success message after valid email submission (AC18)', async () => {
    mockSignIn.mockResolvedValueOnce(undefined);
    renderLoginPage();

    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /entrar con email/i }));

    await waitFor(() => {
      expect(screen.getByText(/revisa tu correo/i)).toBeInTheDocument();
    });
  });

  it('hides the form after successful submission (AC18)', async () => {
    mockSignIn.mockResolvedValueOnce(undefined);
    renderLoginPage();

    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /entrar con email/i }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  it('button is disabled while loading', async () => {
    // signIn never resolves — simulates pending
    mockSignIn.mockReturnValue(new Promise(() => {}));
    renderLoginPage();

    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /entrar con email/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviando/i })).toBeDisabled();
    });
  });

  // AC22 — error query params
  it('shows callback_failed error when ?error=callback_failed is in URL', () => {
    renderLoginPage(new URLSearchParams('error=callback_failed'));
    expect(
      screen.getByText(/el enlace de acceso ha expirado/i)
    ).toBeInTheDocument();
  });

  it('shows auth_required message when ?error=auth_required is in URL', () => {
    renderLoginPage(new URLSearchParams('error=auth_required'));
    expect(
      screen.getByText(/inicia sesión para continuar/i)
    ).toBeInTheDocument();
  });

  it('calls signIn with email provider and correct options on submit', async () => {
    mockSignIn.mockResolvedValueOnce(undefined);
    renderLoginPage();

    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await userEvent.click(screen.getByRole('button', { name: /entrar con email/i }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith(
        'email',
        expect.objectContaining({ email: 'test@example.com' })
      );
    });
  });
});
