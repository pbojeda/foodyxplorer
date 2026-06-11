// F-ADMIN-ANALYTICS-UI — OverviewPanel tests (Panel C).
// RED tests: parallel fetch, scalar cards, webTotalQueries, independent errors, timeRange filter.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/apiClient', () => ({
  getQueriesAnalytics: jest.fn(),
  getWebMetricsAnalytics: jest.fn(),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('../../lib/i18n/useT', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'panel.overview.title': 'Vista general',
      'panel.overview.sections.engine': 'Métricas del motor',
      'panel.overview.sections.web': 'Métricas web',
      'panel.overview.sections.levels': 'Distribución por nivel',
      'panel.overview.sections.sources': 'Distribución por origen',
      'panel.overview.sections.topQueries': 'Consultas más frecuentes',
      'panel.overview.sections.topIntents': 'Intenciones más frecuentes',
      'panel.overview.card.totalQueries.label': 'Consultas totales',
      'panel.overview.card.totalQueries.caption': 'Peticiones procesadas por el motor',
      'panel.overview.card.cacheHitRate.label': 'Tasa de caché',
      'panel.overview.card.cacheHitRate.caption': 'Respuestas servidas desde caché',
      'panel.overview.card.avgResponseTimeMs.label': 'Tiempo de respuesta',
      'panel.overview.card.avgResponseTimeMs.caption': 'Media en milisegundos',
      'panel.overview.card.missRate.label': 'Tasa de fallos',
      'panel.overview.card.missRate.caption': 'Consultas sin resultado (nivel miss)',
      'panel.overview.card.webTotalQueries.label': 'Sesiones web · queries totales',
      'panel.overview.card.webTotalQueries.caption': 'Confirma que NEXT_PUBLIC_METRICS_ENDPOINT está activo',
      'panel.overview.level.l1': 'L1',
      'panel.overview.level.l2': 'L2',
      'panel.overview.level.l3': 'L3',
      'panel.overview.level.l4': 'L4',
      'panel.overview.level.miss': 'Miss',
      'panel.overview.source.api': 'API',
      'panel.overview.source.bot': 'Bot',
      'panel.overview.noTopQueries': 'Sin datos de consultas frecuentes.',
      'panel.overview.noTopIntents': 'Sin datos de intenciones frecuentes.',
      'panel.overview.errorEngine': 'Error al cargar métricas del motor.',
      'panel.overview.errorWeb': 'Error al cargar métricas web.',
      'panel.overview.col.query': 'Consulta',
      'panel.overview.col.count': 'Veces',
      'panel.overview.col.intent': 'Intención',
      'common.timeRange.label': 'Período',
      'common.timeRange.24h': '24h',
      'common.timeRange.7d': '7d',
      'common.timeRange.30d': '30d',
      'common.timeRange.all': 'Todo',
      'common.retry': 'Reintentar',
    };
    return map[key] ?? key;
  },
}));

import { getQueriesAnalytics, getWebMetricsAnalytics } from '../../lib/apiClient';
import { OverviewPanel } from '../../components/admin/OverviewPanel';

const mockGetQueriesAnalytics = getQueriesAnalytics as jest.Mock;
const mockGetWebMetricsAnalytics = getWebMetricsAnalytics as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockQueriesData = {
  totalQueries: 1500,
  cacheHitRate: 0.42,
  avgResponseTimeMs: 320,
  byLevel: { l1: 600, l2: 300, l3: 150, l4: 100, miss: 350 },
  bySource: { api: 1200, bot: 300 },
  topQueries: [
    { queryText: 'big mac', count: 45 },
    { queryText: 'ensalada césar', count: 32 },
  ],
  timeRange: '7d' as const,
};

const mockWebEventsData = {
  eventCount: 210,
  totalQueries: 87,
  totalSuccesses: 75,
  totalErrors: 12,
  totalRetries: 5,
  avgResponseTimeMs: 410,
  topIntents: [
    { intent: 'estimation', count: 60 },
    { intent: 'comparison', count: 15 },
  ],
  timeRange: '7d' as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OverviewPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQueriesAnalytics.mockResolvedValue(mockQueriesData);
    mockGetWebMetricsAnalytics.mockResolvedValue(mockWebEventsData);
  });

  it('fires both getQueriesAnalytics and getWebMetricsAnalytics with timeRange 7d on mount', async () => {
    render(<OverviewPanel />);

    await waitFor(() => {
      expect(mockGetQueriesAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ timeRange: '7d' })
      );
      expect(mockGetWebMetricsAnalytics).toHaveBeenCalledWith({ timeRange: '7d' });
    });
  });

  it('renders scalar cards with totalQueries, formatted cacheHitRate and missRate', async () => {
    render(<OverviewPanel />);

    await waitFor(() => {
      // totalQueries
      expect(screen.getByText('1500')).toBeInTheDocument();
      // cacheHitRate: 0.42 * 100 = 42.0%
      expect(screen.getByText('42.0%')).toBeInTheDocument();
      // missRate: 350 / 1500 * 100 = 23.3%
      expect(screen.getByText('23.3%')).toBeInTheDocument();
    });
  });

  it('renders webTotalQueries card from web-events data', async () => {
    render(<OverviewPanel />);

    await waitFor(() => {
      // webTotalQueries = 87 (from mockWebEventsData.totalQueries)
      expect(screen.getByText('87')).toBeInTheDocument();
      // Section label
      expect(screen.getByText('Métricas web')).toBeInTheDocument();
    });
  });

  it('getQueriesAnalytics failure shows engine error banner; webTotalQueries still renders', async () => {
    mockGetQueriesAnalytics.mockRejectedValue(new Error('Engine down'));

    render(<OverviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('Error al cargar métricas del motor.')).toBeInTheDocument();
      // webTotalQueries card still renders from webEventsData
      expect(screen.getByText('87')).toBeInTheDocument();
    });

    // Engine scalars should NOT be in DOM
    expect(screen.queryByText('1500')).not.toBeInTheDocument();
  });

  it('getWebMetricsAnalytics failure shows web error; engine scalars still render', async () => {
    mockGetWebMetricsAnalytics.mockRejectedValue(new Error('Web down'));

    render(<OverviewPanel />);

    await waitFor(() => {
      // Error may appear in multiple places (topIntents section + web section)
      const errorEls = screen.getAllByText('Error al cargar métricas web.');
      expect(errorEls.length).toBeGreaterThanOrEqual(1);
      // Engine scalars still render
      expect(screen.getByText('1500')).toBeInTheDocument();
    });

    // webTotalQueries should NOT be in DOM
    expect(screen.queryByText('87')).not.toBeInTheDocument();
  });

  it('timeRange segment change fires both fetches with new timeRange', async () => {
    render(<OverviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('1500')).toBeInTheDocument();
    });

    const btn24h = screen.getByRole('button', { name: /24h/i });
    await userEvent.click(btn24h);

    await waitFor(() => {
      expect(mockGetQueriesAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ timeRange: '24h' })
      );
      expect(mockGetWebMetricsAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ timeRange: '24h' })
      );
    });
  });
});
