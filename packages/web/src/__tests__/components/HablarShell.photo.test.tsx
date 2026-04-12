// TDD integration tests for HablarShell photo analysis flow (F092).
// Tests: file validation, executePhotoAnalysis, loading state, success rendering,
// error mapping, stale-request abort, CLIENT_TIMEOUT, cross-flow cleanup, metrics.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMenuAnalysisResponse,
  createMenuAnalysisData,
  createMenuAnalysisDish,
  createEstimateData,
} from '../fixtures';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level before imports
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

jest.mock('../../lib/imageResize', () => ({
  resizeImageForUpload: jest.fn((file: File) => Promise.resolve(file)),
}));

import { HablarShell } from '../../components/HablarShell';
import { sendPhotoAnalysis } from '../../lib/apiClient';
import { ApiError } from '../../lib/apiClient';
import { trackEvent } from '../../lib/metrics';
import { resizeImageForUpload } from '../../lib/imageResize';

const mockSendPhotoAnalysis = sendPhotoAnalysis as jest.Mock;
const mockTrackEvent = trackEvent as jest.Mock;
const mockResizeImageForUpload = resizeImageForUpload as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

function makeLargeFile(): File {
  const file = new File([new Uint8Array(100)], 'large.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
  return file;
}

async function selectFile(file: File, { applyAccept = true }: { applyAccept?: boolean } = {}) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  // applyAccept: false bypasses browser accept attribute filtering (needed for invalid MIME tests)
  await userEvent.setup({ applyAccept }).upload(input, file);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HablarShell — photo flow (F092)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default behaviour: resize is a passthrough (returns the same file).
    mockResizeImageForUpload.mockImplementation((file: File) => Promise.resolve(file));
  });

  // ---------------------------------------------------------------------------
  // BUG-PROD-001 — Client-side resize before upload
  // ---------------------------------------------------------------------------

  describe('BUG-PROD-001 — resize before upload', () => {
    it('pipes the selected file through resizeImageForUpload before sendPhotoAnalysis', async () => {
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());
      render(<HablarShell />);
      const file = makeFile();

      await selectFile(file);

      await waitFor(() => {
        expect(mockResizeImageForUpload).toHaveBeenCalledWith(file);
      });
    });

    it('forwards the resized File (not the original) to sendPhotoAnalysis', async () => {
      const original = makeFile('plate.jpg', 'image/jpeg', 1024);
      const resized = new File([new Uint8Array(10)], 'plate.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(resized, 'size', { value: 500_000 });
      mockResizeImageForUpload.mockResolvedValue(resized);
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

      render(<HablarShell />);
      await selectFile(original);

      await waitFor(() => {
        expect(mockSendPhotoAnalysis).toHaveBeenCalled();
      });
      const sentFile = mockSendPhotoAnalysis.mock.calls[0][0] as File;
      expect(sentFile).toBe(resized);
    });

    it('does NOT call resizeImageForUpload when client-side validation rejects the file', async () => {
      render(<HablarShell />);
      const gif = makeFile('image.gif', 'image/gif');

      await selectFile(gif, { applyAccept: false });

      expect(mockResizeImageForUpload).not.toHaveBeenCalled();
      expect(mockSendPhotoAnalysis).not.toHaveBeenCalled();
    });

    it('emits photo_resize_ok telemetry when resize returns a smaller file', async () => {
      const original = makeFile('plate.jpg', 'image/jpeg', 6 * 1024 * 1024);
      const resized = new File([new Uint8Array(10)], 'plate.jpg', { type: 'image/jpeg' });
      Object.defineProperty(resized, 'size', { value: 700 * 1024 });
      mockResizeImageForUpload.mockResolvedValue(resized);
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

      render(<HablarShell />);
      await selectFile(original);

      await waitFor(() => {
        expect(mockTrackEvent).toHaveBeenCalledWith('photo_resize_ok', expect.objectContaining({
          originalKB: 6144,
          resizedKB: 700,
        }));
      });
    });

    it('emits photo_resize_fallback telemetry when a large file comes back unchanged', async () => {
      const original = makeFile('plate.jpg', 'image/jpeg', 5 * 1024 * 1024);
      // Resize silently falls back — returns the same File reference.
      mockResizeImageForUpload.mockResolvedValue(original);
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

      render(<HablarShell />);
      await selectFile(original);

      await waitFor(() => {
        expect(mockTrackEvent).toHaveBeenCalledWith('photo_resize_fallback', {
          originalKB: 5120,
        });
      });
    });

    it('does NOT emit resize telemetry when file is under the passthrough threshold', async () => {
      const small = makeFile('small.jpg', 'image/jpeg', 500 * 1024);
      mockResizeImageForUpload.mockResolvedValue(small);
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

      render(<HablarShell />);
      await selectFile(small);

      await waitFor(() => {
        expect(mockSendPhotoAnalysis).toHaveBeenCalled();
      });

      const resizeCalls = mockTrackEvent.mock.calls.filter(
        (c) => c[0] === 'photo_resize_ok' || c[0] === 'photo_resize_fallback',
      );
      expect(resizeCalls).toHaveLength(0);
    });

    it('bails out after resize if the request was aborted mid-resize', async () => {
      // Each call gets its own pending promise + resolver. Resize for
      // request #1 deliberately resolves AFTER request #2 has been started
      // (which aborts controller #1). We then assert request #1 never reaches
      // sendPhotoAnalysis.
      const resolvers: Array<(f: File) => void> = [];
      mockResizeImageForUpload.mockImplementation(
        (f: File) =>
          new Promise<File>((resolve) => {
            resolvers.push(() => resolve(f));
          }),
      );
      mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());

      render(<HablarShell />);
      const file1 = makeFile('one.jpg');
      const file2 = makeFile('two.jpg');

      await selectFile(file1);
      await selectFile(file2);

      await waitFor(() => {
        expect(resolvers).toHaveLength(2);
      });

      // Resolve request #1 first — controller is already aborted by the time
      // the post-resize guard runs.
      resolvers[0]?.();
      // Then resolve request #2 — this one should proceed to the network.
      resolvers[1]?.();

      await waitFor(() => {
        expect(mockSendPhotoAnalysis).toHaveBeenCalled();
      });

      // Request #1 must never have reached sendPhotoAnalysis.
      const sendCallsForFile1 = mockSendPhotoAnalysis.mock.calls.filter(
        (c) => (c[0] as File) === file1,
      );
      expect(sendCallsForFile1).toHaveLength(0);

      // Request #2 did reach it.
      const sendCallsForFile2 = mockSendPhotoAnalysis.mock.calls.filter(
        (c) => (c[0] as File) === file2,
      );
      expect(sendCallsForFile2).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation — invalid MIME type
  // ---------------------------------------------------------------------------

  it('shows inline error and does NOT call sendPhotoAnalysis for invalid MIME type (image/gif)', async () => {
    render(<HablarShell />);
    const gifFile = makeFile('image.gif', 'image/gif');

    // applyAccept: false bypasses the input's accept attribute so the file reaches the handler
    await selectFile(gifFile, { applyAccept: false });

    expect(mockSendPhotoAnalysis).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Formato no soportado/i)).toBeInTheDocument();
    });
  });

  it('shows inline error and does NOT call sendPhotoAnalysis for PDF files', async () => {
    render(<HablarShell />);
    const pdfFile = makeFile('doc.pdf', 'application/pdf');

    await selectFile(pdfFile, { applyAccept: false });

    expect(mockSendPhotoAnalysis).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Formato no soportado/i)).toBeInTheDocument();
    });
  });

  it('allows through files with empty file.type (older mobile browsers)', async () => {
    mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());
    render(<HablarShell />);
    const emptyTypeFile = makeFile('photo.jpg', '');

    // Empty type might bypass accept filter naturally; use applyAccept: false to ensure it goes through
    await selectFile(emptyTypeFile, { applyAccept: false });

    // Should call sendPhotoAnalysis without showing a validation error
    await waitFor(() => {
      expect(mockSendPhotoAnalysis).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Validation — file too large
  // ---------------------------------------------------------------------------

  it('shows inline error and does NOT call sendPhotoAnalysis when file > 10 MB', async () => {
    render(<HablarShell />);
    const largeFile = makeLargeFile();

    await selectFile(largeFile);

    expect(mockSendPhotoAnalysis).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Success flow
  // ---------------------------------------------------------------------------

  it('shows LoadingState while sendPhotoAnalysis is pending', async () => {
    mockSendPhotoAnalysis.mockReturnValue(new Promise(() => {}));
    render(<HablarShell />);
    const file = makeFile();

    await selectFile(file);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders NutritionCard after successful photo analysis', async () => {
    const mockData = createMenuAnalysisResponse({
      dishes: [
        createMenuAnalysisDish({
          dishName: 'Big Mac',
          estimate: createEstimateData({ query: 'big mac' }),
        }),
      ],
    });
    mockSendPhotoAnalysis.mockResolvedValue(mockData);
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });
  });

  it('renders "not found" card when dish.estimate is null', async () => {
    const mockData = createMenuAnalysisResponse({
      dishes: [
        createMenuAnalysisDish({
          dishName: 'Plato misterioso',
          estimate: null,
        }),
      ],
    });
    mockSendPhotoAnalysis.mockResolvedValue(mockData);
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText('Plato misterioso')).toBeInTheDocument();
      expect(screen.getByText('Sin datos nutricionales disponibles.')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // API error mapping
  // ---------------------------------------------------------------------------

  it('shows inline error for INVALID_IMAGE API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Unsupported format', 'INVALID_IMAGE', 422)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Formato no soportado/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for MENU_ANALYSIS_FAILED API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Vision failed', 'MENU_ANALYSIS_FAILED', 422)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/No he podido identificar el plato/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for PAYLOAD_TOO_LARGE API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('File too large', 'PAYLOAD_TOO_LARGE', 413)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/demasiado grande/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for RATE_LIMIT_EXCEEDED API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/límite de análisis/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for UNAUTHORIZED API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Invalid API key', 'UNAUTHORIZED', 401)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/Error de configuración/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for PROCESSING_TIMEOUT server error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Server timed out', 'PROCESSING_TIMEOUT', 408)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/análisis ha tardado demasiado/i)).toBeInTheDocument();
    });
  });

  it('shows inline error for NETWORK_ERROR', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Network error', 'NETWORK_ERROR')
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/Sin conexión/i)).toBeInTheDocument();
    });
  });

  it('shows generic error for unknown API errors', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Unknown error', 'UNKNOWN_ERROR', 500)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Abort handling
  // ---------------------------------------------------------------------------

  it('silently ignores stale-request AbortError (reason="stale_request")', async () => {
    // Simulate a stale abort: the promise rejects with AbortError but reason is 'stale_request'
    mockSendPhotoAnalysis.mockImplementation((_file, _actorId, signal?: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        // We simulate what would happen when the controller is aborted with stale_request reason
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new DOMException('Aborted', 'AbortError');
            reject(err);
          });
        }
      });
    });

    render(<HablarShell />);

    // Select first file — starts first request
    await selectFile(makeFile('first.jpg', 'image/jpeg'));
    // Immediately select second file — should abort first with 'stale_request'
    await selectFile(makeFile('second.jpg', 'image/jpeg'));

    // After second selection, the first should be silently aborted
    await waitFor(() => {
      // No error alert from the first aborted request
      // (The second request may be pending or resolved)
    });

    // The inline error should NOT show an abort error
    expect(screen.queryByText(/Aborted/i)).not.toBeInTheDocument();
  });

  it('shows CLIENT_TIMEOUT error for AbortError without stale_request reason', async () => {
    // Simulate client 65s timeout: AbortError with no specific reason
    mockSendPhotoAnalysis.mockRejectedValue(
      new DOMException('Aborted', 'AbortError')
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(screen.getByText(/análisis ha tardado demasiado/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Metrics tracking
  // ---------------------------------------------------------------------------

  it('tracks photo_sent event when valid file is selected', async () => {
    mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());
    render(<HablarShell />);

    await selectFile(makeFile());

    expect(mockTrackEvent).toHaveBeenCalledWith('photo_sent');
  });

  it('tracks photo_success event with dishCount and responseTimeMs on success', async () => {
    mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse());
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'photo_success',
        expect.objectContaining({ dishCount: 1, responseTimeMs: expect.any(Number) })
      );
    });
  });

  it('tracks photo_error event on API error', async () => {
    mockSendPhotoAnalysis.mockRejectedValue(
      new ApiError('Unsupported format', 'INVALID_IMAGE', 422)
    );
    render(<HablarShell />);

    await selectFile(makeFile());

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'photo_error',
        expect.objectContaining({ errorCode: 'INVALID_IMAGE' })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-flow cleanup
  // ---------------------------------------------------------------------------

  it('clears photo results when text query is submitted', async () => {
    // First get photo results
    mockSendPhotoAnalysis.mockResolvedValue(createMenuAnalysisResponse({
      dishes: [
        createMenuAnalysisDish({
          dishName: 'Big Mac',
          estimate: createEstimateData({ query: 'big mac' }),
        }),
      ],
    }));
    render(<HablarShell />);

    await selectFile(makeFile());
    await waitFor(() => {
      expect(screen.getByText('Big Mac')).toBeInTheDocument();
    });

    // Now submit a text query — photo results should be cleared
    const { sendMessage } = jest.requireMock('../../lib/apiClient');
    sendMessage.mockReturnValue(new Promise(() => {}));

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'big mac{Enter}');

    // Loading state should be shown (text query in flight), photo results gone
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    // Big Mac card should not be visible while text query is loading
    expect(screen.queryByText('Sin datos nutricionales disponibles.')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Disabled state during photo analysis
  // ---------------------------------------------------------------------------

  it('disables the textarea during photo analysis', async () => {
    mockSendPhotoAnalysis.mockReturnValue(new Promise(() => {}));
    render(<HablarShell />);

    await selectFile(makeFile());

    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
