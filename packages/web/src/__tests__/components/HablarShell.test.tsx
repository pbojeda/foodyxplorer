import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createConversationMessageResponse } from '../fixtures';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level before imports
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  sendMessage: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number | undefined;
    constructor(message: string, code: string, status?: number) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
}));

import { HablarShell } from '../../components/HablarShell';
import { sendMessage } from '../../lib/apiClient';
import { ApiError } from '../../lib/apiClient';

const mockSendMessage = sendMessage as jest.Mock;

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

describe('HablarShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows EmptyState on initial render', () => {
    render(<HablarShell />);
    expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
  });

  it('shows the input textarea on initial render', () => {
    render(<HablarShell />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows LoadingState while fetch is pending', async () => {
    // Never resolves — stays pending
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders NutritionCard after successful estimation response', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });
  });

  it('renders ContextConfirmation after context_set response', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('context_set'));
    render(<HablarShell />);

    await typeAndSubmit('estoy en mcdonalds');

    await waitFor(() => {
      expect(screen.getByText(/Contexto activo:/i)).toBeInTheDocument();
    });
  });

  it('shows ErrorState with retry after API 500 error', async () => {
    mockSendMessage.mockRejectedValue(new ApiError('Server error', 'INTERNAL_ERROR', 500));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
    });
  });

  it('shows network error message in ErrorState', async () => {
    mockSendMessage.mockRejectedValue(new ApiError('Sin conexión. Comprueba tu red.', 'NETWORK_ERROR'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/Sin conexión/i)).toBeInTheDocument();
    });
  });

  it('shows rate limit error message in ErrorState', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Has alcanzado el límite diario de 50 consultas. Vuelve mañana.', 'RATE_LIMIT_EXCEEDED', 429)
    );
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/límite diario/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for text_too_long intent (not ErrorState)', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('text_too_long'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Demasiado largo/i)).toBeInTheDocument();
    });

    // Should NOT show full ErrorState retry button
    expect(screen.queryByRole('button', { name: /Intentar de nuevo/i })).not.toBeInTheDocument();
  });

  it('does not call sendMessage when query is empty', async () => {
    render(<HablarShell />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '{Enter}');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not call sendMessage when query is whitespace only', async () => {
    render(<HablarShell />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '   {Enter}');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('silently ignores AbortError (stale request)', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSendMessage.mockRejectedValue(abortError);
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    // Wait a tick — should NOT show ErrorState
    await waitFor(() => {
      // After AbortError, still shows EmptyState (no error surfaced)
      expect(screen.queryByRole('button', { name: /Intentar de nuevo/i })).not.toBeInTheDocument();
    });
  });

  it('re-sends last query when onRetry is called', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new ApiError('Error', 'INTERNAL_ERROR', 500))
      .mockResolvedValueOnce(createConversationMessageResponse('estimation'));

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Intentar de nuevo/i }));

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it('renders the nutriXplorer app bar header', () => {
    render(<HablarShell />);
    expect(screen.getByText(/nutriXplorer/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F093 — hablar_query_sent dataLayer push
// ---------------------------------------------------------------------------

describe('F093 — HablarShell hablar_query_sent analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
  });

  it('pushes hablar_query_sent to window.dataLayer when form is submitted', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual(
      expect.arrayContaining([{ event: 'hablar_query_sent' }])
    );
  });

  it('initializes dataLayer if undefined before pushing hablar_query_sent', async () => {
    delete (window as Window & { dataLayer?: unknown[] }).dataLayer;
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toBeDefined();
    expect(
      ((window as Window & { dataLayer?: unknown[] }).dataLayer ?? []).some(
        (e) => (e as { event: string }).event === 'hablar_query_sent'
      )
    ).toBe(true);
  });

  it('does NOT push hablar_query_sent when query is empty', async () => {
    render(<HablarShell />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '{Enter}');
    expect((window as Window & { dataLayer?: unknown[] }).dataLayer ?? []).toHaveLength(0);
  });

  it('pushes hablar_query_sent even when the API call fails', async () => {
    mockSendMessage.mockRejectedValue(new ApiError('Error', 'INTERNAL_ERROR', 500));
    render(<HablarShell />);

    await typeAndSubmit('big mac');

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual(
      expect.arrayContaining([{ event: 'hablar_query_sent' }])
    );
  });
});
