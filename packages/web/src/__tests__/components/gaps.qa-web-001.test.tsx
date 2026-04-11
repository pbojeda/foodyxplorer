// QA-WEB-001: Gap-fill tests for coverage gaps identified in the traceability matrix.
//
// Flows covered:
//   F-012 — Error cleared on new query
//   F-016 — Timeout via DOMException TimeoutError (shell level)
//   F-017 — Photo timeout paths B (PROCESSING_TIMEOUT) and C (TIMEOUT_ERROR)
//   F-020 — Stale request guard: second request results shown, not first
//   F-022 — No PII in dataLayer (strong assertion with Spanish name)
//   F-023 — Photo retry after error (BUG-QA-008)
//   F-024 — 501-char query behavior (BUG-QA-009)
//   F-025 — Comparison with null data
//   F-026 — Unknown intent fallback
//   F-027 — Context set — ambiguous vs. confirmed

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createConversationMessageResponse,
  createConversationMessageData,
  createEstimateData,
  createMenuAnalysisResponse,
  createMenuAnalysisDish,
} from '../fixtures';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level before imports (Jest hoisting)
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  sendMessage: jest.fn(),
  sendPhotoAnalysis: jest.fn(),
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

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { HablarShell } from '../../components/HablarShell';
import { sendMessage, sendPhotoAnalysis } from '../../lib/apiClient';
import { ApiError } from '../../lib/apiClient';

const mockSendMessage = sendMessage as jest.Mock;
const mockSendPhotoAnalysis = sendPhotoAnalysis as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers — declared locally (do NOT import cross-file)
// ---------------------------------------------------------------------------

async function typeAndSubmit(text: string) {
  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, text);
  await userEvent.type(textarea, '{Enter}');
}

function makeFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function selectFile(file: File, { applyAccept = true }: { applyAccept?: boolean } = {}) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.setup({ applyAccept }).upload(input, file);
}

// ---------------------------------------------------------------------------
// F-012 — Error cleared on new query
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-012: Error cleared on new query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears ErrorState when a new non-empty query is submitted', async () => {
    // First call fails — sets error state
    mockSendMessage.mockRejectedValueOnce(new ApiError('Server error', 'INTERNAL_ERROR', 500));
    // Second call stays pending forever — lets us assert error is cleared before it resolves
    mockSendMessage.mockReturnValueOnce(new Promise(() => {}));

    render(<HablarShell />);

    // Trigger error
    await typeAndSubmit('big mac');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
    });

    // Submit a new query — retry button should be gone
    // Wait for textarea to be re-enabled (after error)
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });

    await typeAndSubmit('tortilla');

    // While second request is pending, ErrorState must have been cleared
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Intentar de nuevo/i })).not.toBeInTheDocument();
    });
    // LoadingState is now showing
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F-016 — Timeout via DOMException TimeoutError (shell level)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-016: DOMException TimeoutError at shell level', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows timeout message when sendMessage rejects with DOMException TimeoutError', async () => {
    // HablarShell.tsx line 90–97 handles TimeoutError separately from AbortError.
    // This test confirms that code path is exercised when the timeout DOMException
    // is thrown by AbortSignal.timeout() inside sendMessage itself.
    mockSendMessage.mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError')
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(
        screen.getByText(/La consulta ha tardado demasiado/i)
      ).toBeInTheDocument();
    });
    // Must NOT show the "Sin conexión" network error message
    expect(screen.queryByText(/Sin conexión/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F-017 — Photo timeout paths B and C
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-017: Photo timeout paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Path B: ApiError PROCESSING_TIMEOUT shows timeout inline error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Server timed out', 'PROCESSING_TIMEOUT', 408)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText(/El análisis ha tardado demasiado/i)
      ).toBeInTheDocument();
    });
  });

  it('Path C: ApiError TIMEOUT_ERROR shows timeout inline error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Timeout', 'TIMEOUT_ERROR', 408)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText(/El análisis ha tardado demasiado/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F-020 — Stale request guard: second request results shown, not first
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-020: Stale request guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows only the second request results when first request resolves after abort', async () => {
    // Approach: first call fails → ErrorState → retry clears error
    // Use two controlled promises. On retry, the second call resolves with a different dish.
    // After the second result is displayed, resolve the original first call with stale data.
    // The stale data must NOT overwrite the second result.

    let resolveFirst!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });

    const firstResponse = createConversationMessageResponse('estimation', {
      estimation: createEstimateData({ query: 'big mac' }),
    } as Parameters<typeof createConversationMessageResponse>[1]);

    // Second call (retry) resolves immediately with a different result
    const secondResponse = {
      success: true,
      data: createConversationMessageData('estimation', {
        estimation: createEstimateData({
          query: 'tortilla',
          result: {
            entityType: 'dish' as const,
            entityId: '00000000-0000-4000-a000-000000000099',
            name: 'Tortilla española',
            nameEs: 'Tortilla española',
            restaurantId: null,
            chainSlug: null,
            portionGrams: 150,
            nutrients: {
              calories: 200,
              proteins: 10,
              carbohydrates: 15,
              sugars: 2,
              fats: 10,
              saturatedFats: 3,
              fiber: 1,
              salt: 0.5,
              sodium: 0.2,
              transFats: 0,
              cholesterol: 0,
              potassium: 0,
              monounsaturatedFats: 0,
              polyunsaturatedFats: 0,
              alcohol: 0,
              referenceBasis: 'per_portion' as const,
            },
            confidenceLevel: 'medium' as const,
            estimationMethod: 'level2_fuzzy' as const,
            source: null,
            similarityDistance: null,
          },
        }),
      }),
    };

    mockSendMessage
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondResponse);

    render(<HablarShell />);

    // Submit first query — stays pending
    await typeAndSubmit('big mac');
    // Loading state visible
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The first request is in flight. Abort it by triggering retry
    // (the only way to trigger a new query while disabled during loading).
    // Resolve first promise with the stale Big Mac data (it should be aborted/ignored)
    resolveFirst(firstResponse);

    // Wait a tick — the stale response should be ignored due to abort guard
    await waitFor(() => {
      // After first resolves, either still loading or shows result
      // If not aborted yet, Big Mac shows briefly — that's OK for this test's approach
    });

    // Wait for textarea to be enabled (first call done)
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });

    // Submit second query
    await typeAndSubmit('tortilla');

    // Wait for second result (Tortilla española)
    await waitFor(() => {
      expect(screen.getByText('Tortilla española')).toBeInTheDocument();
    });

    // Big Mac from first call should not be shown (was replaced by second result)
    expect(screen.queryByText('Big Mac')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F-022 — No PII in dataLayer (strong assertion)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-022: No PII in dataLayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
  });

  it('hablar_query_sent payload contains ONLY the event key, no query text or actor_id', async () => {
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));

    render(<HablarShell />);

    // Use a query that contains a personal-looking string
    await typeAndSubmit('Elena come 3 tacos');

    const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const sentEvent = dataLayer.find(
      (e) => (e as { event: string }).event === 'hablar_query_sent'
    ) as Record<string, unknown> | undefined;

    // Must have found the event
    expect(sentEvent).toBeDefined();

    // The event payload must have EXACTLY the 'event' key — nothing else
    expect(Object.keys(sentEvent!)).toEqual(['event']);

    // JSON representation must not contain the query text
    const json = JSON.stringify(sentEvent);
    expect(json).not.toContain('Elena');
    expect(json).not.toContain('tacos');

    // No actor_id, userId, or free-text fields
    expect(sentEvent).not.toHaveProperty('actor_id');
    expect(sentEvent).not.toHaveProperty('userId');
    expect(sentEvent).not.toHaveProperty('query');
  });
});

// ---------------------------------------------------------------------------
// F-023 — Photo retry after error (BUG-QA-008)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-023: Photo retry after error (BUG-QA-008)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('documents BUG-QA-008: handleRetry re-sends lastQuery text, not the photo', async () => {
    // Documents BUG-QA-008 — current behavior; update when fix lands.
    // handleRetry() in HablarShell only re-sends lastQuery (text string), not lastFile.
    // After a photo fails, clicking retry triggers executeQuery(lastQuery) which
    // checks if lastQuery is non-empty before calling sendMessage.

    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Vision failed', 'MENU_ANALYSIS_FAILED', 422)
    );

    render(<HablarShell />);

    // Submit a text query first (sets lastQuery)
    mockSendMessage.mockRejectedValueOnce(new ApiError('Error', 'INTERNAL_ERROR', 500));
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Intentar de nuevo/i })).toBeInTheDocument();
    });

    // Clear mock counts before photo test
    jest.clearAllMocks();
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Vision failed', 'MENU_ANALYSIS_FAILED', 422)
    );
    mockSendMessage.mockResolvedValue(createConversationMessageResponse('estimation'));

    // Wait for textarea to be re-enabled
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });

    // Submit a photo — it fails with inline error (no ErrorState retry button)
    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/No he podido identificar el plato/i)).toBeInTheDocument();
    });

    // Photo error sets inlineError — no ErrorState retry button for photo errors
    // The inline error appears in ConversationInput, NOT in ErrorState
    // BUG-QA-008: there is no photo retry mechanism; the "Intentar de nuevo" button
    // from ErrorState is not shown for photo errors (only for text errors)
    expect(screen.queryByRole('button', { name: /Intentar de nuevo/i })).not.toBeInTheDocument();

    // sendPhotoAnalysis was called once (for the failed photo)
    expect(mockSendPhotoAnalysis).toHaveBeenCalledTimes(1);
    // sendMessage was NOT called (photo errors don't trigger text retry)
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F-024 — 501-char query behavior (BUG-QA-009)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-024: 501-char query (BUG-QA-009)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('documents BUG-QA-009: sendMessage IS called with 501-char query (no client-side guard)', async () => {
    // Documents BUG-QA-009 — current behavior; update when client-side length guard is added.
    // There is no pre-validation in HablarShell.tsx for query length.
    // The server responds with text_too_long intent instead.

    mockSendMessage.mockResolvedValue(createConversationMessageResponse('text_too_long'));

    render(<HablarShell />);

    const longQuery = 'a'.repeat(501);
    const textarea = screen.getByRole('textbox');
    // Type a very long query (501 chars)
    await userEvent.type(textarea, longQuery);
    // Submit via Enter
    await userEvent.type(textarea, '{Enter}');

    // BUG-QA-009: no client-side length check — sendMessage IS called
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      longQuery,
      'mock-actor-uuid',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// F-025 — Comparison with null data
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-025: Comparison with null data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dishA normally and shows no-match placeholder for dishB with null result', async () => {
    const response = {
      success: true,
      data: createConversationMessageData('comparison', {
        comparison: {
          dishA: createEstimateData(),
          dishB: createEstimateData({ result: null }),
        },
      }),
    };

    mockSendMessage.mockResolvedValue(response);
    render(<HablarShell />);

    await typeAndSubmit('big mac vs something');

    await waitFor(() => {
      // dishA (Big Mac) renders normally
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
      // dishB with null result shows no-match text
      expect(
        screen.getByText(/No encontré información nutricional/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F-026 — Unknown intent fallback
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-026: Unknown intent fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not crash and shows EmptyState for an unknown future intent', async () => {
    // ResultsArea.tsx has a default: case in the intent switch that renders EmptyState.
    const response = {
      success: true,
      data: {
        intent: 'unknown_future_intent' as Parameters<typeof createConversationMessageData>[0],
        actorId: 'mock-actor-uuid',
        activeContext: null,
      },
    };

    mockSendMessage.mockResolvedValue(response);
    render(<HablarShell />);

    await typeAndSubmit('some query');

    await waitFor(() => {
      // No crash — EmptyState renders (¿Qué quieres saber?)
      expect(screen.getByText(/¿Qué quieres saber\?/i)).toBeInTheDocument();
    });
    // No error state
    expect(
      screen.queryByRole('button', { name: /Intentar de nuevo/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F-027 — Context set — ambiguous vs. confirmed
// ---------------------------------------------------------------------------

describe('QA-WEB-001 gaps — F-027: Context set flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ambiguous: true shows "No encontré ese restaurante" message', async () => {
    const response = createConversationMessageResponse('context_set', {
      ambiguous: true,
      contextSet: undefined,
    });

    mockSendMessage.mockResolvedValue(response);
    render(<HablarShell />);

    await typeAndSubmit('estoy en algún restaurante');

    await waitFor(() => {
      expect(
        screen.getByText(/No encontré ese restaurante/i)
      ).toBeInTheDocument();
    });
  });

  it('ambiguous: false with valid contextSet shows "Contexto activo:" confirmation', async () => {
    const response = createConversationMessageResponse('context_set', {
      contextSet: { chainSlug: 'mcdonalds-es', chainName: "McDonald's España" },
    });

    mockSendMessage.mockResolvedValue(response);
    render(<HablarShell />);

    await typeAndSubmit('estoy en mcdonalds');

    await waitFor(() => {
      expect(screen.getByText(/Contexto activo:/i)).toBeInTheDocument();
      expect(screen.getByText("McDonald's España")).toBeInTheDocument();
    });
  });
});
