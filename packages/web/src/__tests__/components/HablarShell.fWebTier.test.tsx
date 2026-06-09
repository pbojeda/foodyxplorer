// F-WEB-TIER: HablarShell integration tests.
// AC22 (anonymous 429 shows RateLimitNudge), AC23 (logged-in 429 no nudge),
// AC24 (nudge events), AC25 (authenticated flag on query_sent/query_success).
// BUG-001: voice success fires usageRefreshRef (usage meter refresh on voice).

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('../../components/LoginCta', () => ({
  LoginCta: () => <button data-testid="login-cta">Iniciar sesión</button>,
}));

jest.mock('../../components/UserMenu', () => ({
  UserMenu: () => null,
}));

// UsageMeter mock: captures the onRefreshReady prop reference so tests can
// directly invoke it to set usageRefreshRef inside HablarShell.
// The mock does NOT call onRefreshReady during render — that way a test can
// call capturedOnRefreshReady(mySpy) at any point without a re-render clobbering it.
let capturedOnRefreshReady: ((fn: () => void) => void) | undefined;
jest.mock('../../components/UsageMeter', () => ({
  UsageMeter: ({ onRefreshReady }: { onRefreshReady?: (fn: () => void) => void }) => {
    // Store the prop reference — test can then call capturedOnRefreshReady(spy)
    // which is equivalent to calling usageRefreshRef.current = spy inside HablarShell.
    capturedOnRefreshReady = onRefreshReady;
    return null;
  },
}));

// useVoiceSession mock — default idle; overridden per test for voice-success scenarios
const mockUseVoiceSession = jest.fn();
jest.mock('../../hooks/useVoiceSession', () => ({
  useVoiceSession: (...args: unknown[]) => mockUseVoiceSession(...args),
}));

jest.mock('../../hooks/useTtsPlayback', () => ({
  useTtsPlayback: jest.fn().mockReturnValue({
    play: jest.fn(),
    cancel: jest.fn(),
    isSpeaking: false,
    selectedVoice: null,
    ttsEnabled: true,
  }),
}));

jest.mock('../../lib/imageResize', () => ({
  resizeImageForUpload: jest.fn((file: File) => Promise.resolve(file)),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

// Default: anonymous user
jest.mock('../../hooks/useAuth', () => ({
  useAuth: jest.fn(() => ({
    user: null,
    session: null,
    account: null,
    loading: false,
    error: null,
    signIn: jest.fn(),
    signOut: jest.fn(),
  })),
}));

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
  sendMessage: jest.fn(),
  sendPhotoAnalysis: jest.fn(),
  setAuthToken: jest.fn(),
  getMe: jest.fn(),
  getUsage: jest.fn(),
  getHistory: jest.fn(),
  deleteHistoryEntry: jest.fn(),
  clearHistory: jest.fn(),
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

import { HablarShell } from '../../components/HablarShell';
import { ApiError, sendMessage } from '../../lib/apiClient';
import { trackEvent } from '../../lib/metrics';
import { useAuth } from '../../hooks/useAuth';

const mockSendMessage = sendMessage as jest.Mock;
const mockTrackEvent = trackEvent as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function typeAndSubmit(text: string) {
  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, text);
  await userEvent.type(textarea, '{Enter}');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const anonymousAuth = {
  user: null,
  session: null,
  account: null,
  loading: false,
  error: null,
  signIn: jest.fn(),
  signOut: jest.fn(),
};

const idleVoiceSession = {
  state: 'idle' as const,
  mimeType: 'audio/webm',
  durationMs: 0,
  lastResponse: null,
  error: null,
  start: jest.fn(),
  stop: jest.fn(),
  cancel: jest.fn(),
  retry: jest.fn(),
};

describe('HablarShell — F-WEB-TIER', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(anonymousAuth);
    mockUseVoiceSession.mockReturnValue(idleVoiceSession);
  });

  // -------------------------------------------------------------------------
  // AC22 — anonymous 429 shows RateLimitNudge
  // -------------------------------------------------------------------------

  it('AC22: anonymous user + 429 RATE_LIMIT_EXCEEDED → shows RateLimitNudge', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Has alcanzado el límite diario de 50 consultas.', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      // Error message still shown
      expect(screen.getByText(/límite diario/i)).toBeInTheDocument();
      // Nudge is rendered
      expect(screen.getByText(/Regístrate gratis/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Crear cuenta gratis/i })).toBeInTheDocument();
    });
  });

  it('AC22: dynamic error message uses details.limit (50)', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/límite diario de 50 consultas/i)).toBeInTheDocument();
    });
  });

  it('AC22: dynamic error message uses details.limit (100) for free tier', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 100 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/límite diario de 100 consultas/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // AC23 — logged-in user 429 does NOT show RateLimitNudge
  // -------------------------------------------------------------------------

  it('AC23: logged-in user + 429 → NO RateLimitNudge', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-uuid', email: 'test@example.com' } as never,
      session: { access_token: 'tok' } as never,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });

    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 100 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/límite diario/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Regístrate gratis/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear cuenta gratis/i })).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // AC24 — nudge events
  // -------------------------------------------------------------------------

  it('AC24: rate_limit_nudge_shown fired when nudge renders', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/Regístrate gratis/i)).toBeInTheDocument();
    });

    expect(mockTrackEvent).toHaveBeenCalledWith('rate_limit_nudge_shown');
  });

  it('AC24: rate_limit_nudge_clicked fired on CTA click', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429, { limit: 50 })
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Crear cuenta gratis/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Crear cuenta gratis/i }));
    expect(mockTrackEvent).toHaveBeenCalledWith('rate_limit_nudge_clicked');
  });

  // -------------------------------------------------------------------------
  // AC25 — authenticated flag on query_sent/query_success
  // -------------------------------------------------------------------------

  it('AC25: query_sent fires with authenticated:false when user is null', async () => {
    mockSendMessage.mockResolvedValue({
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
            source: { id: '00000000-0000-4000-a000-000000000002', name: 'Test', type: 'official_chain', url: 'https://t.co' },
            similarityDistance: null,
          },
        },
      },
    });

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('query_sent', expect.objectContaining({ authenticated: false }));
    });
  });

  it('AC25: query_sent fires with authenticated:true when user is non-null', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-uuid', email: 'test@example.com' } as never,
      session: { access_token: 'tok' } as never,
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });

    mockSendMessage.mockRejectedValue(new ApiError('error', 'INTERNAL_ERROR', 500));

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('query_sent', expect.objectContaining({ authenticated: true }));
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-001: voice success fires usageRefreshRef (usage meter refresh on voice)
// ---------------------------------------------------------------------------

describe('HablarShell — BUG-001: usage meter refreshed on voice success', () => {
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
    mockUseVoiceSession.mockReturnValue(idleVoiceSession);
  });

  it('BUG-001: usageRefreshRef.current is called when voiceSession transitions to done', async () => {
    // The UsageMeter mock stores the onRefreshReady prop in capturedOnRefreshReady.
    // Calling capturedOnRefreshReady(fn) sets usageRefreshRef.current = fn inside
    // HablarShell. We inject refreshSpy this way after the initial render (so no
    // subsequent re-render overwrites the ref), then trigger voice-done and assert
    // the spy was called — verifying BUG-001 is fixed.

    const refreshSpy = jest.fn();

    // Step 1: render with idle voice session
    const { rerender } = render(<HablarShell />);

    // Step 2: inject spy into usageRefreshRef via the captured onRefreshReady prop.
    // capturedOnRefreshReady = (fn) => { usageRefreshRef.current = fn; }
    capturedOnRefreshReady?.(refreshSpy);

    // Step 3: transition voiceSession to 'done'
    const voiceResult = {
      intent: 'estimation' as const,
      actorId: 'actor-uuid',
      activeContext: null,
      estimation: {
        query: 'bocata de jamón',
        chainSlug: null,
        portionMultiplier: 1,
        level1Hit: true,
        level2Hit: false,
        level3Hit: false,
        level4Hit: false,
        matchType: 'exact_dish' as const,
        cachedAt: null,
        result: {
          entityType: 'dish' as const,
          entityId: '00000000-0000-4000-a000-000000000001',
          name: 'Bocata de jamón',
          nameEs: 'Bocata de jamón',
          restaurantId: null,
          chainSlug: null,
          portionGrams: 200,
          nutrients: {
            calories: 350, proteins: 20, carbohydrates: 40, sugars: 2,
            fats: 10, saturatedFats: 3, fiber: 2, salt: 1, sodium: 0.4,
            transFats: 0, cholesterol: 0, potassium: 0,
            monounsaturatedFats: 0, polyunsaturatedFats: 0, alcohol: 0,
            referenceBasis: 'per_portion' as const,
          },
          confidenceLevel: 'high' as const,
          estimationMethod: 'level1_exact' as const,
          source: { id: '00000000-0000-4000-a000-000000000002', name: 'T', type: 'official_chain' as const, url: 'https://t.co' },
          similarityDistance: null,
        },
      },
    };

    mockUseVoiceSession.mockReturnValue({
      ...idleVoiceSession,
      state: 'done',
      lastResponse: { data: voiceResult },
    });

    rerender(<HablarShell />);

    // The voice-done useEffect fires: trackEvent('voice_success') + usageRefreshRef.current?.()
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('voice_success', expect.objectContaining({ intent: 'estimation' }));
    });

    // BUG-001: refresh spy must have been called once (was NOT called before this fix)
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
