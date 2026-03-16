// Edge-case tests for lib/imageOcrExtractor.ts
//
// Covers gaps not addressed in the developer-written unit tests:
//   1. OCR returns empty string (zero lines) → returns []
//   2. OCR returns only whitespace lines → returns []
//   3. worker.terminate() itself throws → still throws OCR_FAILED (not unhandled)
//   4. Non-Error thrown inside recognize (e.g. a string rejection) → OCR_FAILED
//   5. OCR text with only single-space lines → filtered out
//   6. createWorker called with ['spa', 'eng'] language array (spec requirement)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock state (must be before vi.mock)
// ---------------------------------------------------------------------------

const mockTerminate    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRecognize    = vi.hoisted(() => vi.fn());
const mockCreateWorker = vi.hoisted(() => vi.fn());

vi.mock('tesseract.js', () => ({
  createWorker: mockCreateWorker,
}));

// Import AFTER vi.mock
import { extractTextFromImage } from '../lib/imageOcrExtractor.js';

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Use resetAllMocks to clear both call history AND mock implementations
  // (clearAllMocks only clears calls, not implementations set via mockRejectedValue)
  vi.resetAllMocks();

  mockTerminate.mockResolvedValue(undefined);

  mockCreateWorker.mockResolvedValue({
    recognize:  mockRecognize,
    terminate:  mockTerminate,
  });

  // Default: recognize returns valid text
  mockRecognize.mockResolvedValue({
    data: { text: 'Line one\nLine two\n' },
  });
});

afterEach(() => {
  // Ensure mockTerminate is always reset to a safe state so it does not
  // bleed into subsequent tests. This is critical because EC-O2 sets
  // mockTerminate.mockRejectedValue() which vi.clearAllMocks() does not undo.
  mockTerminate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// EC-O1: Empty OCR result
//
// When Tesseract finds no text, result.data.text is an empty string.
// The function should return an empty array — not throw.
// The route will then throw NO_NUTRITIONAL_DATA_FOUND.
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O1: empty OCR output', () => {
  it('returns empty array when OCR result.data.text is an empty string', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '' } });

    const lines = await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));
    expect(lines).toEqual([]);
    expect(Array.isArray(lines)).toBe(true);
  });

  it('returns empty array when OCR result contains only newlines', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '\n\n\n\n\n' } });

    const lines = await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));
    expect(lines).toEqual([]);
  });

  it('returns empty array when OCR result contains only whitespace and newlines', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '   \n  \t  \n \n' } });

    const lines = await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));
    expect(lines).toEqual([]);
  });

  it('still calls terminate() when OCR returns empty string', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '' } });

    await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));
    expect(mockTerminate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// EC-O2: worker.terminate() itself throws
//
// terminate() errors are swallowed in the finally block so they don't escape
// or shadow OCR_FAILED from the catch block. The meaningful error (from
// createWorker or recognize) is the one that matters.
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O2: worker.terminate() throws', () => {
  it('swallows terminate() error on success path — returns valid result', async () => {
    mockRecognize.mockResolvedValue({ data: { text: 'Valid output\n' } });
    mockTerminate.mockRejectedValue(new Error('WASM teardown failed'));

    // recognize succeeded, terminate error is swallowed → valid result returned
    const lines = await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));
    expect(lines).toEqual(['Valid output']);
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('swallows terminate() error on failure path — throws OCR_FAILED from recognize', async () => {
    mockRecognize.mockRejectedValue(new Error('Recognize failed'));
    mockTerminate.mockRejectedValue(new Error('Terminate also failed'));

    // recognize failed → OCR_FAILED propagated, terminate error swallowed
    await expect(extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]))).rejects.toMatchObject({
      code: 'OCR_FAILED',
      statusCode: 422,
    });
    expect(mockTerminate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// EC-O3: Non-Error thrown inside recognize
//
// If Tesseract rejects with a string or non-Error object, the implementation
// handles it via String(err) in the message. Verify OCR_FAILED is still thrown.
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O3: non-Error rejection from recognize', () => {
  it('throws OCR_FAILED when recognize rejects with a string', async () => {
    mockRecognize.mockRejectedValue('WASM_CRASH');

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      code:       'OCR_FAILED',
      statusCode: 422,
    });
  });

  it('throws OCR_FAILED when recognize rejects with a plain object', async () => {
    mockRecognize.mockRejectedValue({ type: 'error', details: 'WASM out of memory' });

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      code:       'OCR_FAILED',
      statusCode: 422,
    });
  });

  it('throws OCR_FAILED when createWorker rejects with a string', async () => {
    mockCreateWorker.mockRejectedValue('Cannot load language data');

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      code:       'OCR_FAILED',
      statusCode: 422,
    });
  });
});

// ---------------------------------------------------------------------------
// EC-O4: createWorker is called with correct language array
//
// Spec: createWorker(['spa', 'eng']) — Spanish primary, English fallback.
// The developer test verifies recognize is called with the buffer but does
// NOT verify createWorker is called with the correct language array.
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O4: language configuration', () => {
  it("calls createWorker with ['spa', 'eng'] as the language array", async () => {
    await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));

    expect(mockCreateWorker).toHaveBeenCalledOnce();
    expect(mockCreateWorker).toHaveBeenCalledWith(['spa', 'eng']);
  });

  it('does NOT call createWorker with a single string argument (must be array)', async () => {
    await extractTextFromImage(Buffer.from([0xff, 0xd8, 0xff]));

    const callArgs = mockCreateWorker.mock.calls[0] as unknown[];
    // First argument must be an array, not a string like 'spa+eng'
    expect(Array.isArray(callArgs[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EC-O5: Lines with only a single space character
//
// Tesseract sometimes outputs lines with a single space. After trim(), these
// become empty strings and should be filtered out.
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O5: single-space lines filtered out', () => {
  it('filters lines that are only a single space after trim()', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: 'Real line\n \n  \nAnother real line\n' },
    });

    const lines = await extractTextFromImage(Buffer.from([0]));
    expect(lines).toEqual(['Real line', 'Another real line']);
    expect(lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// EC-O6: OCR result with tab characters
//
// Nutritional tables may produce tab-separated columns. Tabs are whitespace
// and should be trimmed from leading/trailing positions, but mid-line tabs
// should be preserved (they are part of the text content).
// ---------------------------------------------------------------------------

describe('extractTextFromImage — EC-O6: tab handling', () => {
  it('trims leading/trailing tabs from lines', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: '\tMargherita 500\t\nPizza\n' },
    });

    const lines = await extractTextFromImage(Buffer.from([0]));
    expect(lines[0]).toBe('Margherita 500');
  });

  it('preserves mid-line tab characters (column separators)', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: 'Margherita\t500\t20\t15\n' },
    });

    const lines = await extractTextFromImage(Buffer.from([0]));
    expect(lines[0]).toBe('Margherita\t500\t20\t15');
  });
});
