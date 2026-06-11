// F-ADMIN-ANALYTICS-UI — ResponseReviewPanel tests (Panel B).
// RED tests: fetch, filters, expand-row, empty/error states, NOT_PROVISIONED inline.

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/apiClient', () => ({
  getHistorySample: jest.fn(),
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('../../lib/i18n/useT', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'panel.responseReview.title': 'Respuestas para revisar',
      'panel.responseReview.filterIntent': 'Intención:',
      'panel.responseReview.filterHours': 'Horas',
      'panel.responseReview.filterLimit': 'Límite',
      'panel.responseReview.filterHoursValidation': 'Entre 1 y 720',
      'panel.responseReview.filterLimitValidation': 'Entre 1 y 100',
      'panel.responseReview.filterIntentAll': 'Todos',
      'panel.responseReview.summary': 'Últimas {count} entradas en las últimas {hours} horas',
      'panel.responseReview.col.query': 'Consulta',
      'panel.responseReview.col.intent': 'Intención',
      'panel.responseReview.col.kind': 'Tipo',
      'panel.responseReview.col.createdAt': 'Cuándo',
      'panel.responseReview.col.expand': '',
      'panel.responseReview.expandAriaLabel': 'Ver respuesta completa',
      'panel.responseReview.collapseAriaLabel': 'Cerrar respuesta',
      'panel.responseReview.rawJson': 'Ver JSON bruto',
      'panel.responseReview.hideJson': 'Ocultar JSON',
      'panel.responseReview.empty': 'No hay entradas en el período seleccionado.',
      'panel.responseReview.error': 'Error cargando muestras.',
      'common.retry': 'Reintentar',
      'intent.estimation': 'Estimación',
      'intent.comparison': 'Comparación',
      'intent.menu_estimation': 'Menú',
      'intent.reverse_search': 'Búsqueda inversa',
      'intent.context_set': 'Contexto',
      'intent.text_too_long': 'Texto largo',
      'intent.follow_up_attribute': 'Seguimiento',
      'intent.follow_up_refinement': 'Refinamiento',
      'common.kind.text': 'Texto',
      'common.kind.voice': 'Voz',
    };
    return map[key] ?? key;
  },
}));

// Mock ResultBody as a simple div so expand-row tests don't depend on NutritionCard chain
jest.mock('../../components/ResultBody', () => ({
  ResultBody: ({ data }: { data: { intent: string } }) => (
    <div data-testid="result-body">ResultBody:{data.intent}</div>
  ),
}));

import { getHistorySample } from '../../lib/apiClient';
import { ResponseReviewPanel } from '../../components/admin/ResponseReviewPanel';

const mockGetHistorySample = getHistorySample as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const nowIso = new Date().toISOString();

const mockEntry1 = {
  id: 'entry-uuid-1',
  kind: 'text' as const,
  queryText: 'qué tiene un croissant',
  resultData: {
    intent: 'estimation' as const,
    estimation: {
      name: 'Croissant',
      nameEs: 'Croissant',
      kcal: 231,
      protein: 5.2,
      carbs: 26.3,
      fat: 12.0,
      portions: [],
      confidence: 'high' as const,
      source: 'usda' as const,
    },
    actorId: 'actor-uuid-stripped',
  },
  createdAt: nowIso,
};

const mockEntry2 = {
  id: 'entry-uuid-2',
  kind: 'voice' as const,
  queryText: 'big mac vs whopper',
  resultData: {
    intent: 'comparison' as const,
    left: {
      name: 'Big Mac',
      nameEs: 'Big Mac',
      kcal: 563,
      protein: 26,
      carbs: 45,
      fat: 33,
      portions: [],
      confidence: 'high' as const,
      source: 'usda' as const,
    },
    right: {
      name: 'Whopper',
      nameEs: 'Whopper',
      kcal: 657,
      protein: 28,
      carbs: 49,
      fat: 40,
      portions: [],
      confidence: 'high' as const,
      source: 'usda' as const,
    },
    actorId: 'actor-uuid-stripped',
  },
  createdAt: nowIso,
};

const mockHistorySampleData = {
  items: [mockEntry1, mockEntry2],
  hours: 24,
  limit: 20,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponseReviewPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHistorySample.mockResolvedValue(mockHistorySampleData);
  });

  it('fires getHistorySample with default params on mount (no intent)', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(mockGetHistorySample).toHaveBeenCalledWith({
        hours: 24,
        limit: 20,
      });
    });
  });

  it('renders table rows with queryText, intent badge, kind badge on success', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
      expect(screen.getByText('big mac vs whopper')).toBeInTheDocument();
      expect(screen.getAllByText('Estimación').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Comparación').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Texto')).toBeInTheDocument();
      expect(screen.getByText('Voz')).toBeInTheDocument();
    });
  });

  it('selecting intent "Estimación" fires re-fetch with intent param', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'estimation');

    await waitFor(() => {
      expect(mockGetHistorySample).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'estimation' })
      );
    });
  });

  it('selecting "Todos" fires re-fetch without intent param', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
    });

    // First select an intent
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'estimation');

    await waitFor(() => {
      expect(mockGetHistorySample).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'estimation' })
      );
    });

    // Then select "Todos"
    await userEvent.selectOptions(select, '');

    await waitFor(() => {
      const lastCall = mockGetHistorySample.mock.calls[mockGetHistorySample.mock.calls.length - 1][0];
      expect(lastCall).not.toHaveProperty('intent');
    });
  });

  it('hours input blur with 48 fires re-fetch with hours: 48', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
    });

    const hoursInput = screen.getByLabelText(/Horas/i);
    await userEvent.clear(hoursInput);
    await userEvent.type(hoursInput, '48');
    fireEvent.blur(hoursInput);

    await waitFor(() => {
      expect(mockGetHistorySample).toHaveBeenCalledWith(
        expect.objectContaining({ hours: 48 })
      );
    });
  });

  it('clicking expand icon toggles row expansion and renders ResultBody', async () => {
    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
    });

    // ResultBody should not be in DOM yet
    expect(screen.queryAllByTestId('result-body')).toHaveLength(0);

    // Click the first expand button
    const expandButtons = screen.getAllByRole('button', { name: /Ver respuesta completa/i });
    await userEvent.click(expandButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByTestId('result-body').length).toBeGreaterThanOrEqual(1);
    });

    // Clicking again should collapse
    await userEvent.click(expandButtons[0]);

    await waitFor(() => {
      expect(screen.queryAllByTestId('result-body')).toHaveLength(0);
    });
  });

  it('shows empty state when items is empty', async () => {
    mockGetHistorySample.mockResolvedValue({ items: [], hours: 24, limit: 20 });

    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(
        screen.getByText('No hay entradas en el período seleccionado.')
      ).toBeInTheDocument();
    });
  });

  it('shows error banner with retry when fetch throws', async () => {
    mockGetHistorySample.mockRejectedValue(new Error('Network failed'));

    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByText('Error cargando muestras.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
    });
  });

  it('retry button re-fires fetch', async () => {
    mockGetHistorySample
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce(mockHistorySampleData);

    render(<ResponseReviewPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    await waitFor(() => {
      expect(mockGetHistorySample).toHaveBeenCalledTimes(2);
      expect(screen.getByText('qué tiene un croissant')).toBeInTheDocument();
    });
  });
});
