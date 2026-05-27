// HablarShell.fWebHistory — regression tests for the singleton→feed migration.
// Verifies that all pre-existing text/photo/voice behaviors continue working
// after HablarShell is refactored to use entries: TranscriptEntryData[].
// Also covers AC36 (retry adds new entry), AC47 (feed grows), AC54 (smoke).

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createConversationMessageResponse } from '../fixtures';

// ---------------------------------------------------------------------------
// Module mocks — same pattern as HablarShell.test.tsx
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('../../components/LoginCta', () => ({
  LoginCta: () => null,
}));

jest.mock('../../components/UserMenu', () => ({
  UserMenu: () => null,
}));

let capturedOnRefreshReady: ((fn: () => void) => void) | undefined;
jest.mock('../../components/UsageMeter', () => ({
  UsageMeter: ({ onRefreshReady }: { onRefreshReady?: (fn: () => void) => void }) => {
    capturedOnRefreshReady = onRefreshReady;
    return null;
  },
}));

jest.mock('../../components/RateLimitNudge', () => ({
  RateLimitNudge: () => <div data-testid="rate-limit-nudge" />,
}));

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

// Mock useSearchHistory — no-op by default
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

import { HablarShell } from '../../components/HablarShell';
import { sendMessage, sendPhotoAnalysis, ApiError } from '../../lib/apiClient';

const mockSendMessage = sendMessage as jest.Mock;
const mockSendPhotoAnalysis = sendPhotoAnalysis as jest.Mock;

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

async function typeAndSubmit(text: string) {
  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, text);
  await userEvent.type(textarea, '{Enter}');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HablarShell — F-WEB-HISTORY regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseVoiceSession.mockReturnValue(idleVoiceSession);
  });

  // AC54: smoke — renders without error after migration
  it('AC54: renders without crash (smoke)', () => {
    render(<HablarShell />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // Feed role and label
  it('renders TranscriptFeed with role="feed"', () => {
    render(<HablarShell />);
    expect(screen.getByRole('feed')).toBeInTheDocument();
  });

  // Submitting a query appends a new entry to the feed (NutritionCard visible)
  it('text query success: result card appears in feed', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });
  });

  // Submitting a second query adds a SECOND entry (append, not replace)
  it('AC36: two queries → two result articles in the feed', async () => {
    mockSendMessage
      .mockResolvedValueOnce(createConversationMessageResponse('estimation'))
      .mockResolvedValueOnce(createConversationMessageResponse('context_set'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');
    await waitFor(() => expect(screen.getByText('Big Mac')).toBeInTheDocument());

    await typeAndSubmit('estoy en mcdonalds');
    await waitFor(() => {
      const articles = screen.getAllByRole('article');
      expect(articles.length).toBeGreaterThanOrEqual(2);
    });
  });

  // Error → retry adds new entry below, not mutating the failed one
  it('AC36: error then retry adds new entry below the failed one', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new ApiError('Network error', 'NETWORK_ERROR'))
      .mockResolvedValueOnce(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Click Reintentar on the error entry
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    await waitFor(() => {
      // Should have at least 2 articles (error entry + new attempt)
      const articles = screen.getAllByRole('article');
      expect(articles.length).toBeGreaterThanOrEqual(2);
    });
  });

  // text_too_long stays as inline error, no new TranscriptEntry created
  it('G-CRIT: text_too_long sets inline error, does not create a TranscriptEntry', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('text_too_long'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');
    await waitFor(() => {
      expect(screen.getByText(/Demasiado largo/i)).toBeInTheDocument();
    });

    // No result articles should appear for text_too_long
    const articles = screen.queryAllByRole('article');
    expect(articles).toHaveLength(0);
  });

  // usageRefreshRef fires on success (BUG-001 regression)
  // Note: UsageMeter only renders for authenticated users (user !== null).
  // This test uses an anonymous user but calls capturedOnRefreshReady directly to
  // register the refresh spy into usageRefreshRef — this is the same technique
  // used by HablarShell.fWebTier.test.tsx.
  it('BUG-001: usageRefreshRef.current() fires after text query success', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));

    // Render with authenticated user so UsageMeter is shown
    const { useAuth } = require('../../hooks/useAuth') as { useAuth: jest.Mock };
    useAuth.mockReturnValueOnce({
      user: { id: 'user-1', email: 'test@example.com' },
      session: { access_token: 'test-token' },
      account: null,
      loading: false,
      error: null,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });

    render(<HablarShell />);

    const refreshSpy = jest.fn();
    capturedOnRefreshReady?.(refreshSpy);

    await typeAndSubmit('big mac');
    await waitFor(() => {
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  // RateLimitNudge appears on 429 for anonymous user
  it('RateLimitNudge shown on 429 for anonymous user', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit', 'RATE_LIMIT_EXCEEDED', 429)
    );
    render(<HablarShell />);

    await typeAndSubmit('big mac');
    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-nudge')).toBeInTheDocument();
    });
  });

  // HistoryPersistenceNudge appears after 2+ entries for anonymous user
  it('HistoryPersistenceNudge shown after 2 session entries for anonymous user', async () => {
    mockSendMessage
      .mockResolvedValueOnce(createConversationMessageResponse('estimation'))
      .mockResolvedValueOnce(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');
    await waitFor(() => expect(screen.getByText('Big Mac')).toBeInTheDocument());

    await typeAndSubmit('whopper');
    await waitFor(() => {
      // After 2 entries, persistence nudge should show
      expect(screen.getByText('Guarda tu historial entre sesiones')).toBeInTheDocument();
    });
  });

  // Voice success: result card appears in feed (via voiceSession done state)
  it('voice success: result appears in feed', async () => {
    const doneVoiceSession = {
      ...idleVoiceSession,
      state: 'done' as const,
      lastResponse: {
        data: createConversationMessageResponse('estimation').data,
      },
    };
    mockUseVoiceSession.mockReturnValue(doneVoiceSession);

    render(<HablarShell />);

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });
  });
});
