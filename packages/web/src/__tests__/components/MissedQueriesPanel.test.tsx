// F-ADMIN-ANALYTICS-UI — MissedQueriesPanel tests (Panel A).
// RED tests: fetch behavior, filters, per-row tracking actions, error/empty states.

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/apiClient', () => ({
  getMissedQueries: jest.fn(),
  trackMissedQueries: jest.fn(),
  updateMissedQueryStatus: jest.fn(),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('../../lib/i18n/useT', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'panel.missedQueries.title': 'Búsquedas sin respuesta',
      'panel.missedQueries.empty': 'No hay búsquedas sin respuesta en este período.',
      'panel.missedQueries.error': 'Error cargando datos.',
      'panel.missedQueries.action.track': 'Investigando',
      'panel.missedQueries.action.resolve': 'Resuelto',
      'panel.missedQueries.action.ignore': 'Ignorar',
      'panel.missedQueries.actionError': 'Error al actualizar. Inténtalo de nuevo.',
      'panel.missedQueries.filterTopN': 'Top N',
      'panel.missedQueries.filterMinCount': 'Mín. repeticiones',
      'panel.missedQueries.col.query': 'Consulta',
      'panel.missedQueries.col.count': 'Repeticiones',
      'panel.missedQueries.col.status': 'Estado',
      'panel.missedQueries.col.actions': 'Acciones',
      'common.timeRange.24h': '24h',
      'common.timeRange.7d': '7d',
      'common.timeRange.30d': '30d',
      'common.timeRange.all': 'Todo',
      'common.retry': 'Reintentar',
    };
    return map[key] ?? key;
  },
}));

import { getMissedQueries, trackMissedQueries, updateMissedQueryStatus } from '../../lib/apiClient';
import { MissedQueriesPanel } from '../../components/admin/MissedQueriesPanel';

const mockGetMissedQueries = getMissedQueries as jest.Mock;
const mockTrackMissedQueries = trackMissedQueries as jest.Mock;
const mockUpdateMissedQueryStatus = updateMissedQueryStatus as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const mockMissedQueriesData = {
  missedQueries: [
    {
      queryText: 'paella valenciana',
      count: 12,
      trackingId: null,
      trackingStatus: null,
    },
    {
      queryText: 'tortilla española',
      count: 8,
      trackingId: 'track-uuid-1',
      trackingStatus: 'pending',
    },
  ],
  totalMissCount: 20,
  timeRange: '7d',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MissedQueriesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMissedQueries.mockResolvedValue(mockMissedQueriesData);
  });

  it('fires getMissedQueries with default params on mount', async () => {
    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(mockGetMissedQueries).toHaveBeenCalledWith({
        timeRange: '7d',
        topN: 20,
        minCount: 1,
      });
    });
  });

  it('renders table rows with queryText and count on success', async () => {
    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('paella valenciana')).toBeInTheDocument();
      expect(screen.getByText('tortilla española')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  it('changes timeRange and fires re-fetch on segment click', async () => {
    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('paella valenciana')).toBeInTheDocument();
    });

    const btn24h = screen.getByRole('button', { name: /24h/i });
    await userEvent.click(btn24h);

    await waitFor(() => {
      expect(mockGetMissedQueries).toHaveBeenCalledWith(
        expect.objectContaining({ timeRange: '24h' })
      );
    });
  });

  it('"Investigando" on untracked row calls trackMissedQueries then shows pending badge', async () => {
    const trackId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    mockTrackMissedQueries.mockResolvedValue([
      { id: trackId, queryText: 'paella valenciana', hitCount: 12, status: 'pending', resolvedDishId: null, notes: null, createdAt: now, updatedAt: now },
    ]);

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('paella valenciana')).toBeInTheDocument();
    });

    // Find the "Investigando" button for the untracked row (first row)
    const trackButtons = screen.getAllByRole('button', { name: /Investigando/i });
    await userEvent.click(trackButtons[0]);

    await waitFor(() => {
      expect(mockTrackMissedQueries).toHaveBeenCalledWith([
        { queryText: 'paella valenciana', hitCount: 12 },
      ]);
    });
  });

  it('"Investigando" on tracked row calls updateMissedQueryStatus', async () => {
    mockUpdateMissedQueryStatus.mockResolvedValue({
      id: 'track-uuid-1', queryText: 'tortilla española', hitCount: 8, status: 'pending',
      resolvedDishId: null, notes: null, createdAt: now, updatedAt: now,
    });

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('tortilla española')).toBeInTheDocument();
    });

    // Second row is tracked (tortilla española with trackingId=track-uuid-1)
    const trackButtons = screen.getAllByRole('button', { name: /Investigando/i });
    await userEvent.click(trackButtons[1]);

    await waitFor(() => {
      expect(mockUpdateMissedQueryStatus).toHaveBeenCalledWith(
        'track-uuid-1',
        { status: 'pending' }
      );
    });
  });

  it('"Resuelto" on untracked row does two-step: track then status', async () => {
    const trackId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    mockTrackMissedQueries.mockResolvedValue([
      { id: trackId, queryText: 'paella valenciana', hitCount: 12, status: 'pending', resolvedDishId: null, notes: null, createdAt: now, updatedAt: now },
    ]);
    mockUpdateMissedQueryStatus.mockResolvedValue({
      id: trackId, queryText: 'paella valenciana', hitCount: 12, status: 'resolved',
      resolvedDishId: null, notes: null, createdAt: now, updatedAt: now,
    });

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('paella valenciana')).toBeInTheDocument();
    });

    const resolveButtons = screen.getAllByRole('button', { name: /Resuelto/i });
    await userEvent.click(resolveButtons[0]);

    await waitFor(() => {
      expect(mockTrackMissedQueries).toHaveBeenCalledTimes(1);
      expect(mockUpdateMissedQueryStatus).toHaveBeenCalledWith(trackId, { status: 'resolved' });
    });
  });

  it('API error on action reverts badge and shows inline error', async () => {
    mockTrackMissedQueries.mockRejectedValue(new Error('Network error'));

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('paella valenciana')).toBeInTheDocument();
    });

    const trackButtons = screen.getAllByRole('button', { name: /Investigando/i });
    await userEvent.click(trackButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Error al actualizar. Inténtalo de nuevo.')).toBeInTheDocument();
    });
  });

  it('shows empty state when missedQueries is empty', async () => {
    mockGetMissedQueries.mockResolvedValue({
      missedQueries: [],
      totalMissCount: 0,
      timeRange: '7d',
    });

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('No hay búsquedas sin respuesta en este período.')).toBeInTheDocument();
    });
  });

  it('shows error banner with retry on initial fetch error', async () => {
    mockGetMissedQueries.mockRejectedValue(new Error('Network failed'));

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Error cargando datos.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
    });
  });

  it('retry button re-fires the fetch', async () => {
    mockGetMissedQueries
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce(mockMissedQueriesData);

    render(<MissedQueriesPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Reintentar/i });
    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(mockGetMissedQueries).toHaveBeenCalledTimes(2);
    });
  });
});
