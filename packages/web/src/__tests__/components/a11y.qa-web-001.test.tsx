// QA-WEB-001: Accessibility assertion tests.
//
// Areas covered:
//   LoadingState — role="status", sr-only text
//   NutritionCard — aria-label with dish name + calories
//   ConversationInput textarea — aria-label
//   PhotoButton — aria-label
//   MicButton — aria-label, disabled
//   SubmitButton — aria-label
//   ConversationInput inline error — role="alert"
//   ErrorState SVG icon — aria-hidden
//   BUG-QA-007 — ErrorState missing role="alert" on root element
//   All inputs disabled during loading (G6)
//   Keyboard Tab order: textarea before photo input (G5)

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createEstimateData } from '../fixtures';

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
import { LoadingState } from '../../components/LoadingState';
import { NutritionCard } from '../../components/NutritionCard';
import { ConversationInput } from '../../components/ConversationInput';
import { MicButton } from '../../components/MicButton';
import { SubmitButton } from '../../components/SubmitButton';
import { ErrorState } from '../../components/ErrorState';

// ---------------------------------------------------------------------------
// LoadingState accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — LoadingState', () => {
  it('has role="status"', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('contains sr-only element with text "Buscando información nutricional..."', () => {
    render(<LoadingState />);
    const srOnly = document.querySelector('.sr-only');
    expect(srOnly).toBeInTheDocument();
    expect(srOnly?.textContent).toBe('Buscando información nutricional...');
  });
});

// ---------------------------------------------------------------------------
// NutritionCard accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — NutritionCard', () => {
  it('has aria-label containing dish name and calorie count', () => {
    const data = createEstimateData();
    render(<NutritionCard estimateData={data} />);

    // Big Mac, 550 calories → aria-label="Big Mac: 550 calorías"
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Big Mac: 550 calorías');
  });
});

// ---------------------------------------------------------------------------
// ConversationInput textarea accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — ConversationInput textarea', () => {
  it('textarea has aria-label="Escribe tu consulta"', () => {
    render(
      <ConversationInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onPhotoSelect={() => {}}
        isLoading={false}
        inlineError={null}
      />
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-label', 'Escribe tu consulta');
  });

  it('inline error renders with role="alert"', () => {
    render(
      <ConversationInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onPhotoSelect={() => {}}
        isLoading={false}
        inlineError="Formato no soportado. Usa JPEG, PNG o WebP."
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Formato no soportado. Usa JPEG, PNG o WebP.');
  });
});

// ---------------------------------------------------------------------------
// PhotoButton accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — PhotoButton', () => {
  it('has aria-label="Subir foto del plato"', () => {
    // PhotoButton is rendered inside ConversationInput → render via HablarShell
    render(
      <ConversationInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onPhotoSelect={() => {}}
        isLoading={false}
        inlineError={null}
      />
    );

    const photoButton = screen.getByRole('button', { name: 'Subir foto del plato' });
    expect(photoButton).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MicButton accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — MicButton', () => {
  it('has an aria-label attribute', () => {
    render(<MicButton />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label');
    expect(button.getAttribute('aria-label')).not.toBe('');
  });

  it('is disabled (stub component)', () => {
    render(<MicButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// SubmitButton accessibility
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — SubmitButton', () => {
  it('has aria-label="Buscar"', () => {
    render(<SubmitButton onSubmit={() => {}} isLoading={false} />);
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ErrorState icon + BUG-QA-007
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — ErrorState', () => {
  it('SVG icon has aria-hidden="true"', () => {
    render(<ErrorState message="Error de prueba" onRetry={() => {}} />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('documents BUG-QA-007: root div does NOT have role="alert" (screen readers miss error)', () => {
    // Documents BUG-QA-007 — current behavior; update when role="alert" is added.
    // ErrorState does not have role="alert" on the root element.
    // Screen readers will not announce the error automatically.
    render(<ErrorState message="Error de prueba" onRetry={() => {}} />);

    // Confirms the P2 bug: queryByRole('alert') returns null
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// All inputs disabled during loading (G6)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — G6: All inputs disabled during loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('textarea is disabled while text request is pending', async () => {
    const { sendMessage } = jest.requireMock('../../lib/apiClient');
    sendMessage.mockReturnValue(new Promise(() => {})); // never resolves

    render(<HablarShell />);

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'big mac{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeDisabled();
    });
  });

  it('PhotoButton is disabled while photo analysis is pending', async () => {
    const { sendPhotoAnalysis } = jest.requireMock('../../lib/apiClient');
    sendPhotoAnalysis.mockReturnValue(new Promise(() => {})); // never resolves

    render(<HablarShell />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.setup({ applyAccept: true }).upload(input, file);

    await waitFor(() => {
      // During photo analysis, isPhotoLoading=true → textarea AND photo button disabled
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    const photoButton = screen.getByRole('button', { name: 'Subir foto del plato' });
    expect(photoButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard Tab order (G5)
// ---------------------------------------------------------------------------

describe('QA-WEB-001 a11y — G5: Keyboard Tab order', () => {
  it('textarea appears before PhotoButton file input in DOM order', () => {
    render(
      <ConversationInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onPhotoSelect={() => {}}
        isLoading={false}
        inlineError={null}
      />
    );

    const allInputs = document.querySelectorAll('textarea, input[type="file"]');
    expect(allInputs.length).toBeGreaterThanOrEqual(2);

    // Textarea should come before file input in document order
    const [first, second] = Array.from(allInputs);
    expect(first.tagName.toLowerCase()).toBe('textarea');
    expect((second as HTMLInputElement).type).toBe('file');
  });
});
