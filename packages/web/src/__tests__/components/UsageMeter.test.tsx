// F-WEB-TIER: UsageMeter component tests.
// AC30 (renders counters), AC31 (not called when user=null), AC32 (onRefreshReady),
// AC33 (usage_meter_shown event), AC34 (graceful degrade on getUsage failure).

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

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

// F-WEB-HISTORY-FU1: UsageMeter must read getActorId() and pass it to getUsage
// so /me/usage and /conversation/message resolve to the SAME actor.
jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('fixed-actor-uuid'),
}));

// Default: logged-in user
const mockUseAuth = jest.fn(() => ({
  user: { id: 'user-uuid', email: 'test@example.com' },
  session: { access_token: 'tok' },
  account: null,
  loading: false,
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { UsageMeter } from '../../components/UsageMeter';
import { trackEvent } from '../../lib/metrics';
import { getUsage } from '../../lib/apiClient';
import { getActorId } from '../../lib/actorId';

const mockGetUsage = getUsage as jest.Mock;
const mockGetActorId = getActorId as jest.Mock;
const mockTrackEvent = trackEvent as jest.Mock;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const usageEnvelope = {
  success: true,
  data: {
    tier: 'free' as const,
    resetAt: '2026-05-27T00:00:00.000Z',
    buckets: {
      queries: { used: 12, limit: 100, remaining: 88 },
      photos: { used: 3, limit: 20, remaining: 17 },
      voice: { used: 5, limit: 30, remaining: 25 },
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsageMeter (F-WEB-TIER)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-uuid', email: 'test@example.com' } as never,
      session: { access_token: 'tok' } as never,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockGetUsage.mockResolvedValue(usageEnvelope);
  });

  it('AC30: renders usage counters (12/100, 3/20, 5/30) when getUsage resolves', async () => {
    render(<UsageMeter />);

    await waitFor(() => {
      expect(screen.getByText('12/100')).toBeInTheDocument();
      expect(screen.getByText('3/20')).toBeInTheDocument();
      expect(screen.getByText('5/30')).toBeInTheDocument();
    });
  });

  it('AC31: does NOT call getUsage when user is null', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });

    const { container } = render(<UsageMeter />);
    // Give a tick for any effects to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockGetUsage).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('AC32: onRefreshReady receives callback; calling it triggers getUsage again', async () => {
    let refreshFn: (() => void) | null = null;
    const onRefreshReady = jest.fn((fn: () => void) => { refreshFn = fn; });

    render(<UsageMeter onRefreshReady={onRefreshReady} />);

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockGetUsage).toHaveBeenCalledTimes(1);
      expect(onRefreshReady).toHaveBeenCalledTimes(1);
      expect(refreshFn).not.toBeNull();
    });

    // Trigger refresh
    await act(async () => {
      refreshFn?.();
    });

    expect(mockGetUsage).toHaveBeenCalledTimes(2);
    // F-WEB-HISTORY-FU1 (QA follow-up): the refresh call must ALSO carry the
    // actorId (otherwise the meter would re-fetch the fallback bucket and stop
    // advancing again).
    expect(mockGetUsage).toHaveBeenNthCalledWith(1, 'fixed-actor-uuid');
    expect(mockGetUsage).toHaveBeenNthCalledWith(2, 'fixed-actor-uuid');
  });

  it('AC33: fires usage_meter_shown with tier on first successful render', async () => {
    render(<UsageMeter />);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('usage_meter_shown', { tier: 'free' });
    });
  });

  it('AC33: fires usage_meter_shown only once even after refresh', async () => {
    let refreshFn: (() => void) | null = null;
    render(<UsageMeter onRefreshReady={(fn) => { refreshFn = fn; }} />);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('usage_meter_shown', { tier: 'free' });
    });

    await act(async () => { refreshFn?.(); });
    await waitFor(() => { expect(mockGetUsage).toHaveBeenCalledTimes(2); });

    // Should still be called only once
    const shownCalls = mockTrackEvent.mock.calls.filter(
      ([event]: [string]) => event === 'usage_meter_shown'
    );
    expect(shownCalls).toHaveLength(1);
  });

  it('AC34: renders null (or graceful fallback) when getUsage rejects', async () => {
    mockGetUsage.mockRejectedValue(new Error('Network failure'));

    const { container } = render(<UsageMeter />);

    await new Promise((r) => setTimeout(r, 20));
    // After failure: render nothing or degrade — no error thrown to DOM
    // Component should not crash; just render null or dashes
    // We just assert no crash and no counters shown
    expect(container.querySelectorAll('[data-testid="usage-count"]')).toHaveLength(0);
  });

  it('renders null for admin tier (limit: null)', async () => {
    mockGetUsage.mockResolvedValue({
      success: true,
      data: {
        tier: 'admin',
        resetAt: '2026-05-27T00:00:00.000Z',
        buckets: {
          queries: { used: 0, limit: null, remaining: null },
          photos: { used: 0, limit: null, remaining: null },
          voice: { used: 0, limit: null, remaining: null },
        },
      },
    });

    const { container } = render(<UsageMeter />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });

  // F-WEB-HISTORY-FU1 (BUG-WEB-USAGEMETER-ACTOR-PARITY) — meter must wire
  // getActorId() so /me/usage and /conversation/message hit the SAME actor.
  it('AC4: calls getActorId() inside fetchUsage so the meter reads the same actor bucket the search writes to', async () => {
    render(<UsageMeter />);
    await waitFor(() => {
      expect(mockGetActorId).toHaveBeenCalled();
    });
  });

  it('AC5: passes the actorId returned by getActorId() to getUsage', async () => {
    render(<UsageMeter />);
    await waitFor(() => {
      expect(mockGetUsage).toHaveBeenCalledWith('fixed-actor-uuid');
    });
  });
});
