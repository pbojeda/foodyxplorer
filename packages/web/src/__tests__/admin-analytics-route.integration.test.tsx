// F-ADMIN-ANALYTICS-UI — Integration tests for admin analytics route.
// Tests AdminGuard pass-through and 403 branches with panel rendering.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../hooks/useAuth');
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/admin/analytics',
}));

jest.mock('../lib/apiClient', () => ({
  getMissedQueries: jest.fn().mockResolvedValue({
    missedQueries: [],
    totalMissCount: 0,
    timeRange: '7d',
  }),
  getHistorySample: jest.fn().mockResolvedValue({
    items: [],
    hours: 24,
    limit: 20,
  }),
  getQueriesAnalytics: jest.fn().mockResolvedValue({
    totalQueries: 0,
    cacheHitRate: 0,
    avgResponseTimeMs: null,
    byLevel: { l1: 0, l2: 0, l3: 0, l4: 0, miss: 0 },
    bySource: { api: 0, bot: 0 },
    topQueries: [],
    timeRange: '7d',
  }),
  getWebMetricsAnalytics: jest.fn().mockResolvedValue({
    eventCount: 0,
    totalQueries: 0,
    totalSuccesses: 0,
    totalErrors: 0,
    totalRetries: 0,
    avgResponseTimeMs: null,
    topIntents: [],
    timeRange: '7d',
  }),
}));

jest.mock('../lib/metrics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('../lib/i18n/useT', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      // AdminGuard keys
      'layout.loading': 'Verificando acceso...',
      'layout.403.forbidden.title': 'Acceso denegado',
      'layout.403.forbidden.body': 'Se requiere nivel administrador para acceder a este panel.',
      'layout.403.forbidden.cta': 'Volver',
      'layout.403.notProvisioned.title': 'Acceso restringido',
      'layout.403.notProvisioned.body': 'No se pudo verificar tu cuenta.',
      'layout.403.notProvisioned.hint': 'Llama a /me primero.',
      'layout.403.notProvisioned.cta': 'Ir a nutriXplorer',
      'layout.403.verifyFailed.title': 'Acceso denegado',
      'layout.403.verifyFailed.body': 'No se pudo verificar el nivel de cuenta.',
      'layout.403.verifyFailed.cta': 'Volver',
      'layout.brandName': 'nutriXplorer',
      'layout.adminSuffix': 'admin',
      'layout.navAnalytics': 'Analytics',
      // Panel keys — minimal set for headings
      'panel.missedQueries.title': 'Búsquedas sin respuesta',
      'panel.responseReview.title': 'Respuestas para revisar',
      'panel.overview.title': 'Vista general',
      'panel.missedQueries.empty': 'No hay búsquedas sin respuesta en este período.',
      'panel.responseReview.empty': 'No hay entradas en el período seleccionado.',
      'panel.overview.sections.engine': 'Métricas del motor',
      'panel.overview.sections.web': 'Métricas web',
      'panel.overview.noTopQueries': 'Sin datos de consultas frecuentes.',
      'panel.overview.noTopIntents': 'Sin datos de intenciones frecuentes.',
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
      'common.timeRange.label': 'Período',
      'common.timeRange.24h': '24h',
      'common.timeRange.7d': '7d',
      'common.timeRange.30d': '30d',
      'common.timeRange.all': 'Todo',
      'common.retry': 'Reintentar',
      'panel.missedQueries.col.query': 'Consulta',
      'panel.missedQueries.col.count': 'Repeticiones',
      'panel.missedQueries.col.status': 'Estado',
      'panel.missedQueries.col.actions': 'Acciones',
      'panel.missedQueries.filterTopN': 'Top N',
      'panel.missedQueries.filterMinCount': 'Mín. repeticiones',
      'panel.missedQueries.error': 'Error cargando datos.',
      'panel.responseReview.filterIntent': 'Intención:',
      'panel.responseReview.filterHours': 'Horas',
      'panel.responseReview.filterLimit': 'Límite',
      'panel.responseReview.filterIntentAll': 'Todos',
      'panel.responseReview.col.query': 'Consulta',
      'panel.responseReview.col.intent': 'Intención',
      'panel.responseReview.col.kind': 'Tipo',
      'panel.responseReview.col.createdAt': 'Cuándo',
      'panel.responseReview.expandAriaLabel': 'Ver respuesta completa',
      'panel.responseReview.error': 'Error cargando muestras.',
      'panel.overview.col.query': 'Consulta',
      'panel.overview.col.count': 'Veces',
      'panel.overview.col.intent': 'Intención',
      'panel.overview.sections.levels': 'Distribución por nivel',
      'panel.overview.sections.sources': 'Distribución por origen',
      'panel.overview.sections.topQueries': 'Consultas más frecuentes',
      'panel.overview.sections.topIntents': 'Intenciones más frecuentes',
      'panel.overview.errorEngine': 'Error al cargar métricas del motor.',
      'panel.overview.errorWeb': 'Error al cargar métricas web.',
    };
    return map[key] ?? key;
  },
}));

import { useAuth } from '../hooks/useAuth';
import AdminAnalyticsPage from '../app/admin/analytics/page';
import { AdminGuard } from '../components/admin/AdminGuard';

const mockUseAuth = useAuth as jest.Mock;

// Compose: wrap page in AdminGuard (mirrors admin/layout.tsx)
function AdminAnalyticsRoute() {
  return (
    <AdminGuard>
      <AdminAnalyticsPage />
    </AdminGuard>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin analytics route (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('admin tier → AdminGuard passes → all 3 panel headings visible', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'admin@test.com' },
      account: { tier: 'admin', accountId: 'acc-1' },
      loading: false,
      accountErrorCode: null,
    });

    render(<AdminAnalyticsRoute />);

    await waitFor(() => {
      expect(screen.getByText('Búsquedas sin respuesta')).toBeInTheDocument();
      expect(screen.getByText('Respuestas para revisar')).toBeInTheDocument();
      expect(screen.getByText('Vista general')).toBeInTheDocument();
    });
  });

  it('non-admin tier → 403 "Acceso denegado" heading, panels NOT in DOM', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-2', email: 'user@test.com' },
      account: { tier: 'free', accountId: 'acc-2' },
      loading: false,
      accountErrorCode: null,
    });

    render(<AdminAnalyticsRoute />);

    await waitFor(() => {
      expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    });

    expect(screen.queryByText('Búsquedas sin respuesta')).not.toBeInTheDocument();
    expect(screen.queryByText('Respuestas para revisar')).not.toBeInTheDocument();
    expect(screen.queryByText('Vista general')).not.toBeInTheDocument();
  });

  it('null user → router.replace called with /login?redirectTo=%2Fadmin%2Fanalytics', async () => {
    mockReplace.mockClear();

    mockUseAuth.mockReturnValue({
      user: null,
      account: null,
      loading: false,
      accountErrorCode: null,
    });

    render(<AdminAnalyticsRoute />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/login?redirectTo=%2Fadmin%2Fanalytics'
      );
    });
  });
});
