// F107a: AuthProvider unit tests — AC20
// Tests: context shape, onAuthStateChange lifecycle, signIn API call.

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

// Capture the onAuthStateChange callback so tests can invoke it manually
type AuthStateCallback = (event: AuthChangeEvent, session: Session | null) => void;
let capturedAuthCallback: AuthStateCallback | null = null;
const mockUnsubscribe = jest.fn();
const mockSupabaseClient = {
  auth: {
    onAuthStateChange: jest.fn((cb: AuthStateCallback) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    }),
    signInWithOtp: jest.fn(),
    signOut: jest.fn(),
  },
};

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn(() => mockSupabaseClient),
}));

// Mock the browser client module so AuthProvider uses our mock
jest.mock('../../lib/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => mockSupabaseClient),
}));

// Mock POST /auth/login for signIn tests
const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { AuthProvider } from '../../components/AuthProvider';
import { useAuth } from '../../hooks/useAuth';

// Test consumer component
function TestConsumer() {
  const { user, session, loading, error } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.email ?? 'no-email' : 'null'}</span>
      <span data-testid="session">{session ? 'has-session' : 'null'}</span>
      <span data-testid="error">{error ?? 'null'}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('AuthProvider (AC20)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((cb: AuthStateCallback) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    });
  });

  it('exposes loading:true and user:null before onAuthStateChange fires', () => {
    renderWithProvider();
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('sets user and loading:false after SIGNED_IN event', async () => {
    renderWithProvider();

    const mockUser = { id: 'user-1', email: 'user@example.com' } as User;
    const mockSession = { access_token: 'tok', user: mockUser } as Session;

    act(() => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('user').textContent).toBe('user@example.com');
      expect(screen.getByTestId('session').textContent).toBe('has-session');
    });
  });

  it('clears user after SIGNED_OUT event', async () => {
    renderWithProvider();

    const mockUser = { id: 'user-1', email: 'user@example.com' } as User;
    const mockSession = { access_token: 'tok', user: mockUser } as Session;

    act(() => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });
    act(() => {
      capturedAuthCallback?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('null');
      expect(screen.getByTestId('session').textContent).toBe('null');
    });
  });

  it('updates session on TOKEN_REFRESHED event', async () => {
    renderWithProvider();

    const mockUser = { id: 'user-1', email: 'user@example.com' } as User;
    const newSession = { access_token: 'new-tok', user: mockUser } as Session;

    act(() => {
      capturedAuthCallback?.('TOKEN_REFRESHED', newSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('has-session');
    });
  });

  it('calls onAuthStateChange on mount and unsubscribes on unmount', () => {
    const { unmount } = renderWithProvider();
    expect(mockSupabaseClient.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('signIn calls POST /auth/login with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { provider: 'email', success: true } }),
    } as unknown as Response);

    let capturedSignIn: ((provider: 'email' | 'google', opts: { email?: string; redirectTo: string }) => Promise<void>) | null = null;

    function SignInCapture() {
      const auth = useAuth();
      capturedSignIn = auth.signIn;
      return null;
    }

    render(
      <AuthProvider>
        <SignInCapture />
      </AuthProvider>
    );

    await act(async () => {
      await capturedSignIn!('email', {
        email: 'test@example.com',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test@example.com'),
      })
    );
  });
});

