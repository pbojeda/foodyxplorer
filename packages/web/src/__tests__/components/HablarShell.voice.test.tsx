// HablarShell voice integration tests (F091).
//
// Focus: budget-cap pre-flight fetch on mount, overlay open/close via mic button
// tap, voice_start metric emission, and budget-cap gating of the mic button.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level before HablarShell import
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  sendMessage: jest.fn(),
  sendPhotoAnalysis: jest.fn(),
  sendVoiceMessage: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number | undefined;
    details: Record<string, unknown> | undefined;
    constructor(
      message: string,
      code: string,
      status?: number,
      details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

const mockTrackEvent = jest.fn();
jest.mock('../../lib/metrics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  flushMetrics: jest.fn(),
}));

// useVoiceSession is a stateful hook — in this integration suite we only need
// to verify HablarShell wiring, not the hook internals (hook has its own
// dedicated test file). Return a stable idle session.
jest.mock('../../hooks/useVoiceSession', () => ({
  useVoiceSession: jest.fn().mockReturnValue({
    state: 'idle',
    mimeType: 'audio/webm',
    durationMs: 0,
    lastResponse: null,
    error: null,
    start: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
  }),
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

import { HablarShell } from '../../components/HablarShell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_API_URL = process.env['NEXT_PUBLIC_API_URL'];
const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env['NEXT_PUBLIC_API_URL'] = 'https://api.test';
  global.fetch = mockFetch;
});

afterEach(() => {
  if (ORIGINAL_API_URL === undefined) {
    delete process.env['NEXT_PUBLIC_API_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_URL'] = ORIGINAL_API_URL;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HablarShell — voice budget pre-flight (F091)', () => {
  it('calls GET /health/voice-budget with NEXT_PUBLIC_API_URL on mount', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        exhausted: false,
        spendEur: 10,
        capEur: 100,
        alertLevel: 'none',
        monthKey: '2026-04',
      }),
    });
    render(<HablarShell />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test/health/voice-budget',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('fails-open on fetch error — voice remains enabled', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<HablarShell />);
    // MicButton still rendered and not in budget-cap state
    const micButton = await screen.findByRole('button', { name: /buscar por voz$/i });
    expect(micButton).toBeInTheDocument();
    expect(micButton).not.toHaveAccessibleName(/temporalmente desactivada/i);
  });

  it('renders MicButton in budget-cap state when /health/voice-budget returns exhausted=true', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        exhausted: true,
        spendEur: 100,
        capEur: 100,
        alertLevel: 'cap',
        monthKey: '2026-04',
      }),
    });
    render(<HablarShell />);
    const micButton = await screen.findByRole('button', {
      name: /buscar por voz — temporalmente desactivada/i,
    });
    expect(micButton).toBeInTheDocument();
  });
});

describe('HablarShell — voice overlay open (F091)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        exhausted: false,
        spendEur: 0,
        capEur: 100,
        alertLevel: 'none',
        monthKey: '2026-04',
      }),
    });
  });

  it('tapping MicButton opens VoiceOverlay and emits voice_start metric', async () => {
    render(<HablarShell />);
    // Wait for the budget fetch to resolve
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const micButton = screen.getByRole('button', { name: /buscar por voz$/i });
    await userEvent.click(micButton);

    // Overlay opens
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // voice_start metric was emitted
    expect(mockTrackEvent).toHaveBeenCalledWith('voice_start');
  });

  it('does not open VoiceOverlay when budget is exhausted', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        exhausted: true,
        spendEur: 100,
        capEur: 100,
        alertLevel: 'cap',
        monthKey: '2026-04',
      }),
    });
    render(<HablarShell />);
    const micButton = await screen.findByRole('button', {
      name: /buscar por voz — temporalmente desactivada/i,
    });
    // Tap dispatches pointer events inside MicButton but openVoiceOverlay
    // short-circuits on budgetCapActive — so no dialog should appear.
    await userEvent.click(micButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockTrackEvent).not.toHaveBeenCalledWith('voice_start');
  });
});
