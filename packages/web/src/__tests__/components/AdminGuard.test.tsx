// F-ADMIN-ANALYTICS-UI — AdminGuard component tests.
// Tests all 5 branches: loading, anon redirect, NOT_PROVISIONED 403, verifyFailed 403,
// FORBIDDEN 403, and admin access (children rendered).

import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    back: mockRouterBack,
    refresh: mockRouterRefresh,
    push: jest.fn(),
  }),
  usePathname: () => '/admin/analytics',
}));

jest.mock('../../hooks/useAuth');
jest.mock('../../lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));
jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
}));
jest.mock('../../components/admin/AdminLayout', () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-layout">{children}</div>
  ),
}));

import { useAuth } from '../../hooks/useAuth';
import * as metrics from '../../lib/metrics';
import { AdminGuard } from '../../components/admin/AdminGuard';

const mockUseAuth = useAuth as jest.Mock;

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function makeAuthState(overrides: Partial<ReturnType<typeof useAuth>>) {
  return {
    user: null,
    account: null,
    loading: false,
    error: null,
    accountErrorCode: null,
    session: null,
    signIn: jest.fn(),
    signOut: jest.fn(),
    ...overrides,
  };
}

const mockUser = { id: 'user-1', email: 'admin@test.com' } as unknown as ReturnType<typeof useAuth>['user'];
const mockAdminAccount = { id: 'acc-1', tier: 'admin' } as unknown as ReturnType<typeof useAuth>['account'];
const mockFreeAccount = { id: 'acc-2', tier: 'free' } as unknown as ReturnType<typeof useAuth>['account'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('Branch 1: loading — renders spinner with "Verificando acceso..." key', () => {
    mockUseAuth.mockReturnValue(makeAuthState({ loading: true }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByText('layout.loading')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 2: unauthenticated — calls router.replace with login redirect', () => {
    mockUseAuth.mockReturnValue(makeAuthState({ loading: false, user: null }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.stringContaining('/login?redirectTo=')
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 3a: user + no account + NOT_PROVISIONED — renders amber 403 card', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: null,
      accountErrorCode: 'NOT_PROVISIONED',
    }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByText('layout.403.notProvisioned.title')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 3b: user + no account + NETWORK_ERROR — renders slate verifyFailed 403 card', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: null,
      accountErrorCode: 'NETWORK_ERROR',
    }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByText('layout.403.verifyFailed.title')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 3b (null code): user + no account + null code — renders verifyFailed 403', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: null,
      accountErrorCode: null,
    }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByText('layout.403.verifyFailed.title')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 4: user + non-admin account — renders red FORBIDDEN 403 card', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: mockFreeAccount,
    }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByText('layout.403.forbidden.title')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('Branch 5: user + admin account — renders AdminLayout + children', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: mockAdminAccount,
    }));
    render(<AdminGuard><div>Dashboard</div></AdminGuard>);
    expect(screen.getByTestId('admin-layout')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// trackEvent fire-once tests (I1 — no render-phase side effects)
// ---------------------------------------------------------------------------

describe('AdminGuard trackEvent fire-once', () => {
  let trackEventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    trackEventSpy = jest.spyOn(metrics, 'trackEvent');
  });

  afterEach(() => {
    trackEventSpy.mockRestore();
  });

  it('Branch 3a: trackEvent admin_403_shown called exactly once, not on re-render', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: null,
      accountErrorCode: 'NOT_PROVISIONED',
    }));

    const { rerender } = render(<AdminGuard><div>child</div></AdminGuard>);

    // Force a re-render with identical stable props — should NOT fire again
    rerender(<AdminGuard><div>child</div></AdminGuard>);
    rerender(<AdminGuard><div>child</div></AdminGuard>);

    expect(trackEventSpy).toHaveBeenCalledTimes(1);
    expect(trackEventSpy).toHaveBeenCalledWith('admin_403_shown', { code403: 'NOT_PROVISIONED' });
  });

  it('Branch 3b: trackEvent admin_403_shown called exactly once for verifyFailed, not on re-render', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: null,
      accountErrorCode: null,
    }));

    const { rerender } = render(<AdminGuard><div>child</div></AdminGuard>);
    rerender(<AdminGuard><div>child</div></AdminGuard>);
    rerender(<AdminGuard><div>child</div></AdminGuard>);

    expect(trackEventSpy).toHaveBeenCalledTimes(1);
    expect(trackEventSpy).toHaveBeenCalledWith('admin_403_shown', { code403: 'VERIFY_FAILED' });
  });

  it('Branch 4: trackEvent admin_403_shown called exactly once for forbidden, not on re-render', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: mockFreeAccount,
    }));

    const { rerender } = render(<AdminGuard><div>child</div></AdminGuard>);
    rerender(<AdminGuard><div>child</div></AdminGuard>);
    rerender(<AdminGuard><div>child</div></AdminGuard>);

    expect(trackEventSpy).toHaveBeenCalledTimes(1);
    expect(trackEventSpy).toHaveBeenCalledWith('admin_403_shown', { code403: 'FORBIDDEN' });
  });

  it('Branch 5 (admin): trackEvent admin_403_shown is NOT called for admin users', () => {
    mockUseAuth.mockReturnValue(makeAuthState({
      user: mockUser,
      account: mockAdminAccount,
    }));

    render(<AdminGuard><div>child</div></AdminGuard>);

    expect(trackEventSpy).not.toHaveBeenCalledWith('admin_403_shown', expect.anything());
  });
});
