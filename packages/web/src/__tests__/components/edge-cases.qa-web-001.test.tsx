// QA-WEB-001: Component edge case tests.
//
// Areas covered:
//   BUG-QA-004 — ConfidenceBadge crashes on unknown level
//   NutritionCard — 0 calories, large values, long name, null source, empty/null allergens
//   Photo error codes — all ApiError paths in executePhotoAnalysis
//   Photo: null estimate dish in photoResults
//   Photo: empty MIME type (older mobile)

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createEstimateData,
  createEstimateResult,
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
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { NutritionCard } from '../../components/NutritionCard';
import { sendPhotoAnalysis } from '../../lib/apiClient';
import { ApiError } from '../../lib/apiClient';

const mockSendPhotoAnalysis = sendPhotoAnalysis as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function selectFile(file: File, { applyAccept = true }: { applyAccept?: boolean } = {}) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.setup({ applyAccept }).upload(input, file);
}

// ---------------------------------------------------------------------------
// BUG-QA-004 — ConfidenceBadge unknown level
// ---------------------------------------------------------------------------

describe('QA-WEB-001 edge cases — BUG-QA-004: ConfidenceBadge unknown level', () => {
  it('documents BUG-QA-004: ConfidenceBadge crashes with TypeError on unknown level', () => {
    // Documents BUG-QA-004 — current behavior; update when fix lands.
    // BADGE_CONFIG['unknown'] returns undefined, so destructuring throws TypeError.
    // This test PASSES by asserting that the crash occurs (locks in current broken behavior).
    expect(() => {
      render(<ConfidenceBadge level={'unknown' as 'high'} />);
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// NutritionCard edge cases
// ---------------------------------------------------------------------------

describe('QA-WEB-001 edge cases — NutritionCard', () => {
  it('renders "0" KCAL for calories = 0 without crash', () => {
    const data = createEstimateData({
      result: createEstimateResult({
        nutrients: {
          calories: 0,
          proteins: 0,
          carbohydrates: 0,
          sugars: 0,
          fats: 0,
          saturatedFats: 0,
          fiber: 0,
          salt: 0,
          sodium: 0,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_portion',
        },
      }),
    });

    render(<NutritionCard estimateData={data} />);

    // Should render "0" not empty string — multiple 0s appear (calories + macros)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('KCAL')).toBeInTheDocument();
  });

  it('renders rounded large calorie value (99999) without crash', () => {
    const data = createEstimateData({
      result: createEstimateResult({
        nutrients: {
          calories: 99999,
          proteins: 100,
          carbohydrates: 200,
          sugars: 50,
          fats: 80,
          saturatedFats: 20,
          fiber: 5,
          salt: 3,
          sodium: 1.2,
          transFats: 0,
          cholesterol: 0,
          potassium: 0,
          monounsaturatedFats: 0,
          polyunsaturatedFats: 0,
          alcohol: 0,
          referenceBasis: 'per_portion',
        },
      }),
    });

    render(<NutritionCard estimateData={data} />);

    expect(screen.getByText('99999')).toBeInTheDocument();
  });

  it('renders long dish name (200 chars) without overflow crash', () => {
    const longName = 'A'.repeat(200);
    const data = createEstimateData({
      result: createEstimateResult({ name: longName, nameEs: longName }),
    });

    render(<NutritionCard estimateData={data} />);

    // The 200-char name should be rendered in the heading
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(longName);
  });

  it('does not crash and hides source row when result.source is null', () => {
    const data = createEstimateData({
      result: createEstimateResult({ source: null }),
    });

    render(<NutritionCard estimateData={data} />);

    // Should not show any source text — just no footer
    expect(screen.queryByText(/McDonald/i)).not.toBeInTheDocument();
    // No crash — Big Mac heading still there
    expect(screen.getByText('Big Mac')).toBeInTheDocument();
  });

  it('does not crash and renders no allergen chips when allergens is empty array', () => {
    const data = createEstimateData({ allergens: [] });

    render(<NutritionCard estimateData={data} />);

    // No crash, no chips — Big Mac card renders
    expect(screen.getByText('Big Mac')).toBeInTheDocument();
  });

  it('does not crash when allergens is null (cast)', () => {
    const data = createEstimateData({ allergens: null as unknown as [] });

    render(<NutritionCard estimateData={data} />);

    // Array.isArray(null) === false — no chip rendered, no crash
    expect(screen.getByText('Big Mac')).toBeInTheDocument();
  });

  it('renders no-match placeholder when result is null', () => {
    const data = createEstimateData({ result: null });

    render(<NutritionCard estimateData={data} />);

    expect(screen.getByText(/No encontré información nutricional/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Photo error codes — all ApiError paths in executePhotoAnalysis
// ---------------------------------------------------------------------------

describe('QA-WEB-001 edge cases — Photo API error codes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('INVALID_IMAGE → "Formato no soportado. Usa JPEG, PNG o WebP."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Unsupported format', 'INVALID_IMAGE', 422)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('Formato no soportado. Usa JPEG, PNG o WebP.')
      ).toBeInTheDocument();
    });
  });

  it('MENU_ANALYSIS_FAILED → "No he podido identificar el plato. Intenta con otra foto."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Vision failed', 'MENU_ANALYSIS_FAILED', 422)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('No he podido identificar el plato. Intenta con otra foto.')
      ).toBeInTheDocument();
    });
  });

  it('PAYLOAD_TOO_LARGE → "La foto es demasiado grande. Máximo 10 MB."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('File too large', 'PAYLOAD_TOO_LARGE', 413)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('La foto es demasiado grande. Máximo 10 MB.')
      ).toBeInTheDocument();
    });
  });

  it('RATE_LIMIT_EXCEEDED → "Has alcanzado el límite de análisis por foto. Inténtalo más tarde."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText(
          'Has alcanzado el límite de análisis por foto. Inténtalo más tarde.'
        )
      ).toBeInTheDocument();
    });
  });

  it('UNAUTHORIZED → "Error de configuración. Contacta con soporte."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Invalid API key', 'UNAUTHORIZED', 401)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('Error de configuración. Contacta con soporte.')
      ).toBeInTheDocument();
    });
  });

  it('NETWORK_ERROR → "Sin conexión. Comprueba tu red."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Network error', 'NETWORK_ERROR')
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText('Sin conexión. Comprueba tu red.')).toBeInTheDocument();
    });
  });

  it('Unknown code → "No se pudo analizar la foto. Inténtalo de nuevo."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Some weird error', 'COMPLETELY_UNKNOWN_CODE', 500)
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('No se pudo analizar la foto. Inténtalo de nuevo.')
      ).toBeInTheDocument();
    });
  });

  it('Non-ApiError plain Error → "No se pudo analizar la foto. Inténtalo de nuevo."', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(new Error('Unexpected plain error'));

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(
        screen.getByText('No se pudo analizar la foto. Inténtalo de nuevo.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Photo: null estimate dish in photoResults
// ---------------------------------------------------------------------------

describe('QA-WEB-001 edge cases — Photo null estimate dish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Sin datos nutricionales disponibles." for a dish with null estimate', async () => {
    mockSendPhotoAnalysis.mockResolvedValue(
      createMenuAnalysisResponse({
        dishes: [
          createMenuAnalysisDish({ dishName: 'Plato misterioso', estimate: null }),
        ],
      })
    );

    render(<HablarShell />);
    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText('Plato misterioso')).toBeInTheDocument();
      expect(screen.getByText('Sin datos nutricionales disponibles.')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Photo: empty MIME type (older mobile browsers)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 edge cases — Photo empty MIME type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows through files with empty MIME type (older mobile) and calls sendPhotoAnalysis', async () => {
    // HablarShell.tsx line 129 comment: "Allow empty file.type through (older mobile browsers)"
    mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

    render(<HablarShell />);
    const emptyTypeFile = makeFile('photo.jpg', '', 1024);

    // applyAccept: false bypasses the accept attribute filter so empty MIME gets through
    await selectFile(emptyTypeFile, { applyAccept: false });

    await waitFor(() => {
      expect(mockSendPhotoAnalysis).toHaveBeenCalledTimes(1);
    });
    // No validation error shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
