// F107a: useAuth hook unit tests.
// Tests: hook returns correct shape; throws outside provider; signIn/signOut calls.

import React from 'react';
import { render, renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

type AuthStateCallback = (event: string, session: object | null) => void;
let capturedAuthCallback: AuthStateCallback | null = null;
const mockUnsubscribe = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockSignInWithOtp = jest.fn();
const mockSupabaseClient = {
  auth: {
    onAuthStateChange: jest.fn((cb: AuthStateCallback) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    }),
    signInWithOtp: mockSignInWithOtp,
    signOut: mockSignOut,
  },
};

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn(() => mockSupabaseClient),
}));

jest.mock('../../lib/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => mockSupabaseClient),
}));

// F-WEB-TIER: AuthProvider now calls getMe on SIGNED_IN. Mock it here so
// it doesn't call global.fetch and consume mock responses meant for signIn/signOut.
jest.mock('../../lib/apiClient', () => ({
  setAuthToken: jest.fn(),
  getMe: jest.fn().mockResolvedValue({ success: true, data: { account: { tier: 'free' } } }),
  getUsage: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { AuthProvider } from '../../components/AuthProvider';
import { useAuth } from '../../hooks/useAuth';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('useAuth hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((cb: AuthStateCallback) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    });
  });

  it('throws a descriptive error when used outside AuthProvider', () => {
    // Suppress console.error for this expected throw
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      /AuthProvider/
    );
    spy.mockRestore();
  });

  it('returns correct initial shape inside provider', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });

  it('updates state after SIGNED_IN event', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      capturedAuthCallback?.('SIGNED_IN', {
        access_token: 'tok',
        user: { id: 'u1', email: 'u@example.com' },
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.user).toMatchObject({ email: 'u@example.com' });
  });

  it('signIn calls POST /auth/login', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { provider: 'email', success: true } }),
    } as unknown as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('email', {
        email: 'test@example.com',
        redirectTo: 'https://app.nutrixplorer.com/auth/callback',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('signOut calls POST /auth/logout then supabase.auth.signOut', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    // Sign in first so we have a session token
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      capturedAuthCallback?.('SIGNED_IN', {
        access_token: 'my-token',
        user: { id: 'u1', email: 'u@example.com' },
      });
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockSignOut).toHaveBeenCalled();
  });
});
