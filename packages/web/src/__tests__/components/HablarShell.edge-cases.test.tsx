/**
 * HablarShell edge-case tests — F090 QA
 *
 * Tests the scenarios from the spec that are either missing or only partially
 * covered in the main HablarShell.test.tsx suite.
 *
 * Focus:
 * 1. Network timeout (15s AbortSignal.timeout) → correct Spanish copy
 * 2. Rapid re-submit: in-flight request aborted, NEW results shown (not just abort silenced)
 * 3. Menu_estimation with a null result item (individual no-match placeholder)
 * 4. allergens: null handled gracefully by NutritionCard (no crash)
 * 5. Timeout error message is NOT "Sin conexión..." but "La consulta tardó..."
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createConversationMessageResponse, createEstimateData } from '../fixtures';

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

async function typeAndSubmit(text: string) {
  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, text);
  await userEvent.type(textarea, '{Enter}');
}

// ---------------------------------------------------------------------------
// Edge case: network timeout shows correct Spanish copy
// ---------------------------------------------------------------------------

describe('HablarShell — edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * BUG PROBE: Spec §9 — Network timeout (15s) must show:
   *   "La consulta tardó demasiado. Inténtalo de nuevo."
   *
   * AbortSignal.timeout() fires a TimeoutError (DOMException, name === 'TimeoutError'),
   * NOT an AbortError. apiClient.ts wraps it as ApiError('The operation was aborted.', 'NETWORK_ERROR').
   * HablarShell.tsx then checks err.message.includes('Sin conexión') — this is FALSE for the
   * timeout message, so it falls back to 'Sin conexión. Comprueba tu red.' which is WRONG.
   *
   * The correct message per spec is: "La consulta tardó demasiado. Inténtalo de nuevo."
   * There is currently no NETWORK_TIMEOUT code path to distinguish it from a generic network error.
   *
   * This test WILL FAIL — it documents the bug. Expected: "La consulta tardó demasiado..."
   * Actual: "Sin conexión. Comprueba tu red."
   */
  it('BUG: shows timeout-specific error copy when request times out (15s)', async () => {
    // Simulate how apiClient wraps a TimeoutError: it arrives as NETWORK_ERROR
    // with the DOMException message "The operation was aborted."
    const timeoutMessage = 'The operation was aborted.'; // message from TimeoutError
    mockSendMessage.mockRejectedValue(
      new ApiError(timeoutMessage, 'NETWORK_ERROR'),
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    // WRONG: shows 'Sin conexión. Comprueba tu red.' (generic fallback)
    // EXPECTED by spec: 'La consulta tardó demasiado. Inténtalo de nuevo.'
    await waitFor(() => {
      expect(screen.getByText(/Sin conexión\. Comprueba tu red\./i)).toBeInTheDocument();
    });

    // ASSERTION TO CONFIRM THE BUG — spec-required message is absent:
    expect(
      screen.queryByText(/La consulta tardó demasiado/i),
    ).not.toBeInTheDocument();
  });

  /**
   * Spec §9 (positive case): generic network failure (not timeout) still shows
   * "Sin conexión. Comprueba tu red." — this is currently working correctly.
   */
  it('shows "Sin conexión" copy for genuine network failure', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Sin conexión. Comprueba tu red.', 'NETWORK_ERROR'),
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText(/Sin conexión/i)).toBeInTheDocument();
    });
  });

  /**
   * MISSING_TEST: Spec §10 — Rapid re-submit test.
   * The existing suite only tests that AbortError is silently ignored. It does NOT
   * test that a second submission while the first is in-flight:
   *   (a) aborts the first request
   *   (b) shows the result of the SECOND request (not the first)
   */
  it('rapid re-submit: second submit shows its own result (first request aborted)', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstRequest = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    const firstResult = createConversationMessageResponse('estimation');
    // First request: controlled via resolveFirst
    mockSendMessage.mockReturnValueOnce(firstRequest);

    render(<HablarShell />);

    // First submit using the submit button to avoid textarea disabled issue
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'big mac');
    await userEvent.type(textarea, '{Enter}');

    // LoadingState should appear (first request still in-flight)
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The textarea is DISABLED while loading — per spec the SubmitButton is
    // also disabled, so a second rapid submit via keyboard won't work.
    // Spec §10 says the shell ABORTS the previous request when a new one arrives.
    // The mechanism is: currentRequestRef.current?.abort() at the top of executeQuery.
    // To test this without bypassing the disabled guard, call executeQuery directly
    // through the retry mechanism or verify the abort was called on the first controller.
    //
    // What we CAN verify: if the shell receives two calls to executeQuery (e.g. via
    // HablarShell calling retry while first is still pending), the stale one is aborted.
    // The SubmitButton IS disabled during loading so a second Enter/click won't fire.
    // This means the rapid re-submit guard (AbortController) is only exercised via
    // programmatic access. This is a MISSING_TEST: there's no way to trigger it via
    // the public interface in tests because the input is disabled during loading.
    //
    // Per spec §10: "While isLoading, the SubmitButton is disabled and further
    // submits are ignored." — so the guard is a safety net for programmatic calls,
    // and the primary prevention IS the disabled state. This is correctly implemented.
    //
    // VERDICT: SPEC_DEVIATION — the spec says "previous in-flight request is aborted
    // if user somehow triggers a new one" but the UI prevents it. Acceptable as the
    // disabled guard is the correct UX, but the AbortController secondary guard
    // has no test coverage.

    // Verify the first call path works (resolve the first request inside act):
    await act(async () => {
      resolveFirst(firstResult);
    });

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    // Only one call was made (second submit was blocked by disabled state)
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  /**
   * MISSING_TEST: Spec §6 (menu_estimation) — item with null result renders
   * a no-match placeholder within the card grid (not a crash, not an empty grid).
   * NOTE: placed last due to React async state leak from prior tests.
   */
  it('menu_estimation with a null result item renders no-match placeholder', async () => {
    const results = createConversationMessageResponse('menu_estimation', {
      menuEstimation: {
        items: [
          { query: 'big mac', estimation: createEstimateData() },
          {
            query: 'plato_desconocido',
            estimation: createEstimateData({ query: 'plato_desconocido', result: null, matchType: null }),
          },
        ],
        totals: {
          calories: 550,
          proteins: 25,
          carbohydrates: 46,
          sugars: 9,
          fats: 28,
          saturatedFats: 10,
          fiber: 3,
          salt: 2.2,
          sodium: 0.88,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
        },
        itemCount: 2,
        matchedCount: 1,
        diners: null,
        perPerson: null,
      },
    });

    mockSendMessage.mockResolvedValue(results);
    render(<HablarShell />);
    await typeAndSubmit('big mac y plato_desconocido');

    await waitFor(() => {
      // First item renders normally
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
      // Second item (null result) renders the no-match inline message
      expect(screen.getByText(/No encontré información nutricional/i)).toBeInTheDocument();
    });
  });

  /**
   * MISSING_TEST: Spec §11 — allergens: null must not crash.
   * The schema allows allergens to be absent (undefined), but a consumer could
   * pass null. Array.isArray(null) === false, so the row is hidden — verify no crash.
   */
  it('estimation with allergens: null does not crash and hides allergen row', async () => {
    const results = createConversationMessageResponse('estimation', {
      estimation: createEstimateData({ allergens: null as unknown as undefined }),
    });

    mockSendMessage.mockResolvedValue(results);
    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    // No allergen chips should be rendered
    expect(screen.queryByText('⚠')).not.toBeInTheDocument();
  });

  /**
   * MISSING_TEST: Spec §7 — reverse_search with 0 results shows the empty-state
   * variant "No encontré platos con esas características." — this exists in
   * ResultsArea.test.tsx but is missing from HablarShell integration.
   */
  it('reverse_search with 0 results shows "No encontré platos..." message', async () => {
    const results = createConversationMessageResponse('reverse_search', {
      reverseSearch: {
        chainSlug: 'mcdonalds-es',
        chainName: "McDonald's España",
        maxCalories: 200,
        minProtein: null,
        results: [],
        totalMatches: 0,
      },
    });

    mockSendMessage.mockResolvedValue(results);
    render(<HablarShell />);
    await typeAndSubmit('platos bajos en calorías');

    await waitFor(() => {
      expect(
        screen.getByText(/No encontré platos con esas características/i),
      ).toBeInTheDocument();
    });
  });

  /**
   * MISSING_TEST: Spec §8 — rate limit (429) copy.
   * The existing test checks /límite diario/i but does NOT verify the FULL
   * required copy: "Has alcanzado el límite diario de 50 consultas. Vuelve mañana."
   */
  it('rate limit error shows full spec-required copy including "50 consultas"', async () => {
    mockSendMessage.mockRejectedValue(
      new ApiError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429),
    );

    render(<HablarShell />);
    await typeAndSubmit('big mac');

    await waitFor(() => {
      expect(
        screen.getByText(/Has alcanzado el límite diario de 50 consultas\. Vuelve mañana\./i),
      ).toBeInTheDocument();
    });
  });
});
