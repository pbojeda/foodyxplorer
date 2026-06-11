// F-ADMIN-ANALYTICS-UI — AuthProvider.accountErrorCode tests.
// Covers the extended AuthContextValue.accountErrorCode field.
// Branch 1: getMe throws ApiError with code='NOT_PROVISIONED' → accountErrorCode='NOT_PROVISIONED'
// Branch 2: getMe throws ApiError with code='NETWORK_ERROR' → accountErrorCode='NETWORK_ERROR'
// Branch 3: getMe throws generic Error (no .code) → accountErrorCode='NETWORK_ERROR'

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Module mocks
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

jest.mock('../../lib/apiClient', () => ({
  getMe: jest.fn(),
  setAuthToken: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status?: number;
    constructor(message: string, code: string, status?: number) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
}));

process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.com';

import { AuthProvider } from '../../components/AuthProvider';
import { useAuth } from '../../hooks/useAuth';
import { getMe } from '../../lib/apiClient';

const mockGetMe = getMe as jest.Mock;

// ---------------------------------------------------------------------------
// Test consumer component
// ---------------------------------------------------------------------------

function TestConsumer() {
  const { accountErrorCode, account, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="account">{account ? 'has-account' : 'no-account'}</span>
      <span data-testid="error-code">{accountErrorCode ?? 'null'}</span>
    </div>
  );
}

const mockSession = {
  access_token: 'test-token',
  user: { id: 'user-123' },
} as unknown as Session;

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

describe('AuthProvider.accountErrorCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
  });

  it('defaults to null when getMe succeeds', async () => {
    mockGetMe.mockResolvedValue({
      success: true,
      data: { account: { tier: 'admin', id: 'acc-1' }, actor: {} },
    });

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('null');
      expect(screen.getByTestId('account').textContent).toBe('has-account');
    });
  });

  it('sets accountErrorCode to NOT_PROVISIONED when getMe throws ApiError with code NOT_PROVISIONED', async () => {
    const { ApiError } = jest.requireMock('../../lib/apiClient') as {
      ApiError: new (msg: string, code: string, status?: number) => Error & { code: string };
    };
    mockGetMe.mockRejectedValue(new ApiError('Not provisioned', 'NOT_PROVISIONED', 403));

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('NOT_PROVISIONED');
      expect(screen.getByTestId('account').textContent).toBe('no-account');
    });
  });

  it('sets accountErrorCode to NETWORK_ERROR when getMe throws ApiError with other code', async () => {
    const { ApiError } = jest.requireMock('../../lib/apiClient') as {
      ApiError: new (msg: string, code: string) => Error & { code: string };
    };
    mockGetMe.mockRejectedValue(new ApiError('Network failed', 'NETWORK_ERROR'));

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('NETWORK_ERROR');
      expect(screen.getByTestId('account').textContent).toBe('no-account');
    });
  });

  it('sets accountErrorCode to NETWORK_ERROR when getMe throws a generic Error (no .code)', async () => {
    mockGetMe.mockRejectedValue(new Error('Unknown failure'));

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('NETWORK_ERROR');
    });
  });

  it('resets accountErrorCode to null on SIGNED_OUT', async () => {
    const { ApiError } = jest.requireMock('../../lib/apiClient') as {
      ApiError: new (msg: string, code: string) => Error & { code: string };
    };
    mockGetMe.mockRejectedValue(new ApiError('Nope', 'NOT_PROVISIONED'));

    renderWithProvider();

    await act(async () => {
      capturedAuthCallback?.('SIGNED_IN', mockSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('NOT_PROVISIONED');
    });

    await act(async () => {
      capturedAuthCallback?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-code').textContent).toBe('null');
    });
  });
});
