// useSearchHistory tests — AC38, AC39, AC40, AC48, AC49
// AC38: mount fetch fires GET /history on mount; maps to TranscriptEntryData (isPersisted=true).
// AC39: loadMore fires GET /history?cursor=X; prepends older entries.
// AC40: hasMoreHistory/isLoadingMore state.
// AC48: history_loaded telemetry with { count }.
// AC49: history_load_more telemetry with { page }.
// AC63 (drift tolerance): drifted entry is skipped, valid ones render.

import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  getHistory: jest.fn(),
  deleteHistoryEntry: jest.fn(),
  clearHistory: jest.fn(),
  setAuthToken: jest.fn(),
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

import { useSearchHistory } from '../../hooks/useSearchHistory';
import { getHistory, deleteHistoryEntry, clearHistory } from '../../lib/apiClient';
import { trackEvent } from '../../lib/metrics';
import type { TranscriptEntryData } from '../../types/history';
import type { HistoryPageResult } from '../../lib/apiClient';

const mockGetHistory = getHistory as jest.Mock;
const mockDeleteHistoryEntry = deleteHistoryEntry as jest.Mock;
const mockClearHistory = clearHistory as jest.Mock;
const mockTrackEvent = trackEvent as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHistoryResult(count: number, cursor: string | null = null): HistoryPageResult {
  const entries: TranscriptEntryData[] = Array.from({ length: count }, (_, i) => ({
    entryId: `entry-${i}`,
    queryText: `query ${i}`,
    inputMode: 'text' as const,
    timestamp: new Date(`2026-05-27T${String(10 + i).padStart(2, '0')}:00:00`),
    isLoading: false,
    result: null,
    photoData: null,
    error: null,
    isPersisted: true,
  }));
  return { entries, nextCursor: cursor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSearchHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // No-op when authToken is null
  it('returns empty state and no-op functions when authToken is null', () => {
    const { result } = renderHook(() => useSearchHistory({ authToken: null }));
    expect(result.current.persistedEntries).toEqual([]);
    expect(result.current.hasMoreHistory).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.isLoadingHistory).toBe(false);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  // AC38: mount fetch fires when authToken provided
  it('AC38: fires GET /history on mount when authToken is set', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(3, null));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    expect(mockGetHistory).toHaveBeenCalledWith(null, 10);
    expect(result.current.persistedEntries).toHaveLength(3);
  });

  // AC38: entries mapped with isPersisted=true
  it('AC38: all returned entries have isPersisted=true', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(2, null));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    result.current.persistedEntries.forEach((e) => {
      expect(e.isPersisted).toBe(true);
    });
  });

  // AC40: hasMoreHistory=true when nextCursor non-null
  it('AC40: hasMoreHistory=true when API returns non-null cursor', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(10, 'cursor-abc'));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    expect(result.current.hasMoreHistory).toBe(true);
  });

  it('AC40: hasMoreHistory=false when API returns null cursor', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(5, null));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    expect(result.current.hasMoreHistory).toBe(false);
  });

  // AC48: history_loaded fired with count
  it('AC48: trackEvent history_loaded fired with entry count after mount', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(7, null));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    expect(mockTrackEvent).toHaveBeenCalledWith('history_loaded', { count: 7 });
  });

  // AC39: loadMore prepends older entries
  it('BUG-WEB-HISTORY-LOADMORE-IO-ROOT-001: rapid duplicate loadMore calls (sync) trigger only ONE getHistory request', async () => {
    // Regression guard for the sync in-flight ref guard added to loadMore.
    // Pre-fix: an IntersectionObserver firing twice in rapid succession (before
    // React commits setIsLoadingMore(true)) caused TWO getHistory requests for the
    // same cursor, doubling the prepend. The sync ref short-circuits the 2nd call.
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(3, 'cursor-page2'));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    mockGetHistory.mockClear();
    const olderResp = makeHistoryResult(2, null);
    mockGetHistory.mockResolvedValueOnce(olderResp);

    // Fire loadMore twice synchronously within the same React update tick.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    // Exactly ONE getHistory call (the second was short-circuited by the in-flight ref).
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
    // 3 initial + 2 prepended = 5 total (NOT 7 from a duplicate prepend).
    expect(result.current.persistedEntries).toHaveLength(5);
  });

  it('AC39: loadMore prepends older entries above existing', async () => {
    // Initial load: 3 entries
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(3, 'cursor-page2'));

    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    const initialIds = result.current.persistedEntries.map((e) => e.entryId);
    expect(initialIds).toHaveLength(3);

    // Prepare loadMore response
    const olderEntries = makeHistoryResult(2, null);
    olderEntries.entries[0].entryId = 'older-0';
    olderEntries.entries[1].entryId = 'older-1';
    mockGetHistory.mockResolvedValueOnce(olderEntries);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    // Older entries appear before the initial ones
    const allIds = result.current.persistedEntries.map((e) => e.entryId);
    expect(allIds[0]).toBe('older-0');
    expect(allIds[1]).toBe('older-1');
    expect(allIds.slice(2)).toEqual(initialIds);
  });

  // AC49: history_load_more fired with page number
  it('AC49: trackEvent history_load_more fired with incrementing page on loadMore', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(3, 'cursor-p2'));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(2, null));
    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(mockTrackEvent).toHaveBeenCalledWith('history_load_more', { page: 1 });
  });

  // Deploy-skew: fetch error swallowed, persistedEntries stays []
  it('deploy-skew: API error on mount is swallowed, returns empty entries', async () => {
    mockGetHistory.mockRejectedValueOnce(new Error('404 Not Found'));
    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    expect(result.current.persistedEntries).toEqual([]);
    expect(result.current.hasMoreHistory).toBe(false);
  });

  // deleteEntry: optimistic removal + API call
  it('deleteEntry removes entry optimistically from state', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(3, null));
    mockDeleteHistoryEntry.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    const targetId = result.current.persistedEntries[1].entryId;

    act(() => {
      result.current.deleteEntry(targetId);
    });

    expect(result.current.persistedEntries).toHaveLength(2);
    expect(result.current.persistedEntries.find((e) => e.entryId === targetId)).toBeUndefined();
    expect(mockDeleteHistoryEntry).toHaveBeenCalledWith(targetId);
  });

  // clearAll: clears all entries + API call
  it('clearAll clears all persistedEntries and calls clearHistory', async () => {
    mockGetHistory.mockResolvedValueOnce(makeHistoryResult(5, null));
    mockClearHistory.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    expect(result.current.persistedEntries).toHaveLength(5);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.persistedEntries).toEqual([]);
    expect(result.current.hasMoreHistory).toBe(false);
    expect(mockClearHistory).toHaveBeenCalledTimes(1);
  });

  // AC63: drifted entry skipped (per-entry parse in apiClient)
  // This test verifies that getHistory (mocked here) still returns only valid entries.
  // The actual per-entry skip logic is in apiClient — here we confirm the hook
  // accepts whatever getHistory returns (already filtered).
  it('AC63: hook accepts partially-valid entry list from getHistory', async () => {
    const result2 = makeHistoryResult(2, null);
    mockGetHistory.mockResolvedValueOnce(result2);

    const { result } = renderHook(() => useSearchHistory({ authToken: 'test-token' }));
    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    expect(result.current.persistedEntries).toHaveLength(2);
  });
});
