// F-WEB-TIER: AuthProvider tests for getMe on session establish.
// AC6 (getMe called on SIGNED_IN/INITIAL_SESSION), AC10 (getMe failure non-fatal).

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

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

jest.mock('../../lib/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => mockSupabaseClient),
}));

// Mock apiClient — we need getMe and setAuthToken
jest.mock('../../lib/apiClient', () => ({
  getMe: jest.fn(),
  getUsage: jest.fn(),
  setAuthToken: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { AuthProvider } from '../../components/AuthProvider';
import { useAuth } from '../../hooks/useAuth';
import { getMe, setAuthToken } from '../../lib/apiClient';

const mockGetMe = getMe as jest.Mock;
const mockSetAuthToken = setAuthToken as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser: User = {
  id: 'user-uuid',
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

const mockSession: Session = {
  access_token: 'my-access-token',
  refresh_token: 'my-refresh-token',
  expires_in: 3600,
  expires_at: 9999999999,
  token_type: 'bearer',
  user: mockUser,
};

const mockMeEnvelope = {
  success: true,
  data: {
    account: {
      id: '00000000-0000-4000-a000-000000000001',
      authUserId: 'user-uuid',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      consentMarketing: false,
      consentMarketingAt: null,
      consentAnalytics: false,
      consentAnalyticsAt: null,
      tier: 'free',
    },
    actor: {
      id: '00000000-0000-4000-a000-000000000003',
      type: 'authenticated',
      externalId: 'user-uuid',
      accountId: '00000000-0000-4000-a000-000000000001',
    },
  },
};

// ---------------------------------------------------------------------------
// Test consumer
// ---------------------------------------------------------------------------

function TestConsumer() {
  const { user, loading, account } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.email ?? 'no-email' : 'null'}</span>
      <span data-testid="account-tier">{account?.tier ?? 'null'}</span>
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthProvider (F-WEB-TIER)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((cb: AuthStateCallback) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    });
    mockGetMe.mockResolvedValue(mockMeEnvelope);
  });

  it('AC6a: calls getMe after SIGNED_IN event and sets account in context', async () => {
    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('account-tier').textContent).toBe('free');
    });
  });

  it('AC6b: calls getMe after INITIAL_SESSION event (session restore)', async () => {
    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('INITIAL_SESSION', mockSession);
    });

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalledTimes(1);
    });
  });

  it('AC6c: does NOT call getMe on TOKEN_REFRESHED event', async () => {
    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('TOKEN_REFRESHED', mockSession);
    });

    // Give microtasks a chance to settle
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it('P-I1: calls setAuthToken before getMe on SIGNED_IN', async () => {
    const callOrder: string[] = [];
    mockSetAuthToken.mockImplementation(() => { callOrder.push('setAuthToken'); });
    mockGetMe.mockImplementation(async () => {
      callOrder.push('getMe');
      return mockMeEnvelope;
    });

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(callOrder[0]).toBe('setAuthToken');
      expect(callOrder[1]).toBe('getMe');
    });
  });

  it('P-I1: calls setAuthToken(null) on SIGNED_OUT', async () => {
    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_OUT', null);
    });

    expect(mockSetAuthToken).toHaveBeenCalledWith(null);
  });

  it('AC10: getMe rejection leaves account null, does not throw or block loading', async () => {
    mockGetMe.mockRejectedValue(new Error('Network error'));

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    // Wait for the promise rejection to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // account stays null but app is functional
    expect(screen.getByTestId('account-tier').textContent).toBe('null');
    // loading should be false (auth resolved even if getMe failed)
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('AC10: account cleared on SIGNED_OUT after being set', async () => {
    renderWithProvider();

    // First sign in
    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('account-tier').textContent).toBe('free');
    });

    // Then sign out
    await act(async () => {
      capturedAuthCallback?.('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('account-tier').textContent).toBe('null');
  });
});
