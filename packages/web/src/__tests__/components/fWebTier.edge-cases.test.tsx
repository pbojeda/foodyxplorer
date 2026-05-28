// F-WEB-TIER — QA adversarial frontend edge-case tests
//
// Probes scenarios the developer tests don't fully cover:
//
// 1. UsageMeter: used > limit (should show used/limit as-is, remaining=0 server-side)
// 2. UsageMeter: admin tier → renders null (no quota chrome for admin)
// 3. UsageMeter: getUsage returns null data field → component renders null gracefully
// 4. LoginCta: event firing semantics — login_cta_shown not fired when shouldRender=false
// 5. HablarShell: nudge cleared on retry (setShowRateLimitNudge cleared at top of executeQuery)
// 6. HablarShell: 429 WITHOUT details.limit → message omits count (null limitStr)
// 7. HablarShell: logged-in user 429 → NO nudge, plain error only (E9 invariant)
// 8. HablarShell: authLoading=true → neither LoginCta nor UsageMeter rendered (AC18 / E8)
// 9. UsageMeter: onRefreshReady callback is called with the refresh function
// 10. Deploy-skew: AccountSchema parses response without tier → tier is undefined (E10)

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Shared module mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('../../lib/imageResize', () => ({
  resizeImageForUpload: jest.fn((file: File) => Promise.resolve(file)),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

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

const mockGetUsage = jest.fn();
const mockGetMe = jest.fn();
const mockSendMessage = jest.fn();

// F-WEB-HISTORY: mock useSearchHistory — no-op by default
jest.mock('../../hooks/useSearchHistory', () => ({
  useSearchHistory: jest.fn(() => ({
    persistedEntries: [],
    hasMoreHistory: false,
    isLoadingMore: false,
    isLoadingHistory: false,
    loadMore: jest.fn(),
    deleteEntry: jest.fn(),
    clearAll: jest.fn(),
  })),
}));

jest.mock('../../lib/apiClient', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  sendPhotoAnalysis: jest.fn(),
  setAuthToken: jest.fn(),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  getUsage: (...args: unknown[]) => mockGetUsage(...args),
  getHistory: jest.fn(),        // F-WEB-HISTORY
  deleteHistoryEntry: jest.fn(), // F-WEB-HISTORY
  clearHistory: jest.fn(),       // F-WEB-HISTORY
  ApiError: class ApiError extends Error {
    code: string;
    status: number | undefined;
    details: Record<string, unknown> | undefined;
    constructor(message: string, code: string, status?: number, details?: Record<string, unknown>) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

jest.mock('../../components/LoginCta', () => ({
  LoginCta: () => <button data-testid="login-cta">Iniciar sesión</button>,
}));

jest.mock('../../components/RateLimitNudge', () => ({
  RateLimitNudge: ({ onSignUpClick }: { onSignUpClick: () => void }) => (
    <div data-testid="rate-limit-nudge">
      <p>Regístrate gratis</p>
      <button onClick={onSignUpClick}>Crear cuenta gratis</button>
    </div>
  ),
}));

import { HablarShell } from '../../components/HablarShell';
import { UsageMeter } from '../../components/UsageMeter';
import { LoginCta } from '../../components/LoginCta';
import { ApiError } from '../../lib/apiClient';
import { trackEvent } from '../../lib/metrics';

const mockTrackEvent = trackEvent as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loggedInAuth = {
  user: { id: 'user-uuid', email: 'test@example.com' } as never,
  session: { access_token: 'tok' } as never,
  account: null,
  loading: false,
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
};

const anonymousAuth = {
  user: null,
  session: null,
  account: null,
  loading: false,
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
};

const loadingAuth = {
  user: null,
  session: null,
  account: null,
  loading: true, // still resolving
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
};

async function typeAndSubmit(text: string) {
  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, text);
  await userEvent.type(textarea, '{Enter}');
}

// ---------------------------------------------------------------------------
// UsageMeter edge cases
// ---------------------------------------------------------------------------

describe('UsageMeter — QA edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('admin tier → renders null (no quota chrome)', async () => {
    mockUseAuth.mockReturnValue(loggedInAuth);
    mockGetUsage.mockResolvedValue({
      success: true,
      data: {
        tier: 'admin',
        resetAt: '2026-05-27T00:00:00.000Z',
        buckets: {
          queries: { used: 0, limit: null, remaining: null },
          photos:  { used: 0, limit: null, remaining: null },
          voice:   { used: 0, limit: null, remaining: null },
        },
      },
    });

    const { container } = render(<UsageMeter />);
    await waitFor(() => {
      // For admin, the component should return null (no meter shown)
      const statusRegion = container.querySelector('[role="status"]');
      expect(statusRegion).toBeNull();
    });
  });

  it('getUsage rejects → renders null gracefully (AC34)', async () => {
    mockUseAuth.mockReturnValue(loggedInAuth);
    mockGetUsage.mockRejectedValue(new Error('Network error'));

    const { container } = render(<UsageMeter />);
    await waitFor(() => {
      const statusRegion = container.querySelector('[role="status"]');
      expect(statusRegion).toBeNull();
    });
  });

  it('not logged in → renders null immediately, getUsage not called (AC31)', () => {
    mockUseAuth.mockReturnValue(anonymousAuth);

    const { container } = render(<UsageMeter />);
    // Should render null immediately — no meter
    expect(container.firstChild).toBeNull();
    expect(mockGetUsage).not.toHaveBeenCalled();
  });

  it('onRefreshReady called with refresh function after mount', async () => {
    mockUseAuth.mockReturnValue(loggedInAuth);
    mockGetUsage.mockResolvedValue({
      success: true,
      data: {
        tier: 'free',
        resetAt: '2026-05-27T00:00:00.000Z',
        buckets: {
          queries: { used: 5, limit: 100, remaining: 95 },
          photos:  { used: 1, limit: 20,  remaining: 19 },
          voice:   { used: 0, limit: 30,  remaining: 30 },
        },
      },
    });

    const onRefreshReady = jest.fn();
    render(<UsageMeter onRefreshReady={onRefreshReady} />);

    await waitFor(() => {
      expect(onRefreshReady).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  it('refresh callback triggers getUsage again (AC32)', async () => {
    mockUseAuth.mockReturnValue(loggedInAuth);
    const usageData = {
      success: true,
      data: {
        tier: 'free',
        resetAt: '2026-05-27T00:00:00.000Z',
        buckets: {
          queries: { used: 5, limit: 100, remaining: 95 },
          photos:  { used: 1, limit: 20,  remaining: 19 },
          voice:   { used: 0, limit: 30,  remaining: 30 },
        },
      },
    };
    mockGetUsage.mockResolvedValue(usageData);

    let capturedRefresh: (() => void) | null = null;
    render(<UsageMeter onRefreshReady={(fn) => { capturedRefresh = fn; }} />);

    // Wait for initial mount fetch
    await waitFor(() => {
      expect(mockGetUsage).toHaveBeenCalledTimes(1);
    });

    // Call the refresh callback
    expect(capturedRefresh).not.toBeNull();
    act(() => { capturedRefresh?.(); });

    await waitFor(() => {
      expect(mockGetUsage).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// HablarShell edge cases
// ---------------------------------------------------------------------------

describe('HablarShell — QA edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(anonymousAuth);
  });

  it('authLoading=true → neither LoginCta data-testid visible (E8 / AC18)', () => {
    // While auth is loading, neither login CTA should be shown
    mockUseAuth.mockReturnValue(loadingAuth);
    render(<HablarShell />);
    expect(screen.queryByTestId('login-cta')).not.toBeInTheDocument();
  });

  it('nudge cleared on new query attempt (setShowRateLimitNudge(false) at top of executeQuery)', async () => {
    // First query → 429 → nudge shown
    mockSendMessage.mockRejectedValueOnce(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-nudge')).toBeInTheDocument();
    });

    // Second query → succeeds (nudge should clear)
    mockSendMessage.mockResolvedValueOnce({
      success: true,
      data: {
        intent: 'estimation',
        actorId: 'actor-uuid',
        activeContext: null,
        estimation: {
          query: 'test',
          chainSlug: null,
          portionMultiplier: 1,
          level1Hit: true,
          level2Hit: false,
          level3Hit: false,
          level4Hit: false,
          matchType: 'exact_dish',
          cachedAt: null,
          result: {
            entityType: 'dish',
            entityId: '00000000-0000-4000-a000-000000000001',
            name: 'Test',
            nameEs: 'Test',
            restaurantId: null,
            chainSlug: null,
            portionGrams: 100,
            nutrients: {
              calories: 100, proteins: 10, carbohydrates: 20, sugars: 5,
              fats: 5, saturatedFats: 2, fiber: 1, salt: 0.5, sodium: 0.2,
              transFats: 0, cholesterol: 0, potassium: 0,
              monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
              referenceBasis: 'per_portion',
            },
            confidenceLevel: 'high',
            estimationMethod: 'level1_exact',
            source: { id: '00000000-0000-4000-a000-000000000002', name: 'T', type: 'official_chain', url: 'https://t.co' },
            similarityDistance: null,
          },
        },
      },
    });

    const textarea = screen.getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'big mac 2');
    await userEvent.type(textarea, '{Enter}');

    await waitFor(() => {
      // Nudge should be gone
      expect(screen.queryByTestId('rate-limit-nudge')).not.toBeInTheDocument();
    });
  });

  // BUG-API-RATELIMIT-BEARER-001 (2026-05-28): a 429 WITHOUT details.limit comes
  // from the GLOBAL 15-min abuse limiter, not the daily per-actor quota. It must
  // NOT claim "límite diario" (which wrongly tells the user they exhausted their
  // daily allowance) — it shows transient copy instead. The daily limiter always
  // carries details.limit. Supersedes the prior F-WEB-TIER "grammar fix" tests
  // that asserted "límite diario de consultas" for the no-details case.
  it('429 without details.limit → transient copy, NOT a daily-quota claim', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, {}) // no limit → global limiter
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/Demasiadas peticiones/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/límite diario/i)).not.toBeInTheDocument();
  });

  it('429 with no details at all (undefined) → transient copy, NOT a daily-quota claim', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, undefined)
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/Demasiadas peticiones/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/límite diario/i)).not.toBeInTheDocument();
  });

  it('E9: logged-in user 429 → plain error message shown, NO nudge', async () => {
    mockUseAuth.mockReturnValue(loggedInAuth);
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 100 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/límite diario de 100 consultas/i)).toBeInTheDocument();
    });

    // No nudge for logged-in users
    expect(screen.queryByTestId('rate-limit-nudge')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Deploy-skew: AccountSchema.tier is optional (E10)
// ---------------------------------------------------------------------------

describe('AccountSchema — deploy-skew resilience (E10)', () => {
  it('parses account payload WITHOUT tier field → tier is undefined', async () => {
    // Dynamic import to avoid module cache issues with mocks
    const { AccountSchema } = await import('@foodxplorer/shared');

    const payloadWithoutTier = {
      id: '00000000-0000-4000-a000-000000000001',
      authUserId: '00000000-0000-4000-a000-000000000002',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      consentMarketing: false,
      consentMarketingAt: null,
      consentAnalytics: false,
      consentAnalyticsAt: null,
      // NO tier field
    };

    const result = AccountSchema.safeParse(payloadWithoutTier);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBeUndefined();
      // Consumer pattern: account.tier ?? 'free' → 'free'
      expect(result.data.tier ?? 'free').toBe('free');
    }
  });

  it('parses account payload WITH tier=free → tier is free', async () => {
    const { AccountSchema } = await import('@foodxplorer/shared');

    const payloadWithTier = {
      id: '00000000-0000-4000-a000-000000000001',
      authUserId: '00000000-0000-4000-a000-000000000002',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      consentMarketing: false,
      consentMarketingAt: null,
      consentAnalytics: false,
      consentAnalyticsAt: null,
      tier: 'free',
    };

    const result = AccountSchema.safeParse(payloadWithTier);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBe('free');
    }
  });

  it('rejects account payload with invalid tier value', async () => {
    const { AccountSchema } = await import('@foodxplorer/shared');

    const payloadWithBadTier = {
      id: '00000000-0000-4000-a000-000000000001',
      authUserId: '00000000-0000-4000-a000-000000000002',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      consentMarketing: false,
      consentMarketingAt: null,
      consentAnalytics: false,
      consentAnalyticsAt: null,
      tier: 'superuser', // invalid
    };

    const result = AccountSchema.safeParse(payloadWithBadTier);
    expect(result.success).toBe(false);
  });
});
