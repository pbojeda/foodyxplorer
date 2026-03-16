// Unit tests for lib/imageOcrExtractor.ts
//
// Mocks tesseract.js via vi.mock to avoid WASM initialization.
// Tests cover: happy path, OCR_FAILED, terminate-in-finally, text normalization.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock state so it is accessible before vi.mock() runs
// ---------------------------------------------------------------------------

const mockTerminate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRecognize  = vi.hoisted(() => vi.fn());
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
  vi.clearAllMocks();

  // Default: createWorker returns a worker with working recognize + terminate
  mockCreateWorker.mockResolvedValue({
    recognize:  mockRecognize,
    terminate:  mockTerminate,
  });

  // Default: recognize returns a multi-line text
  mockRecognize.mockResolvedValue({
    data: { text: 'Margherita 500 20 3\n  Big Mac  563 30 26\n\nPizza Pepperoni 520 22 5\n' },
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('extractTextFromImage — happy path', () => {
  it('returns trimmed non-empty lines from recognized text', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff]);
    const lines = await extractTextFromImage(buf);

    expect(lines).toEqual([
      'Margherita 500 20 3',
      'Big Mac  563 30 26',
      'Pizza Pepperoni 520 22 5',
    ]);
  });

  it('filters out empty lines from OCR output', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: 'Line one\n\n\nLine two\n\n' },
    });

    const lines = await extractTextFromImage(Buffer.from([0]));
    expect(lines).toHaveLength(2);
    expect(lines).toContain('Line one');
    expect(lines).toContain('Line two');
  });

  it('trims whitespace from each line', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: '   leading spaces\ntrailing spaces   \n  both  \n' },
    });

    const lines = await extractTextFromImage(Buffer.from([0]));
    expect(lines).toEqual(['leading spaces', 'trailing spaces', 'both']);
  });

  it('calls worker.terminate() in finally on success', async () => {
    await extractTextFromImage(Buffer.from([0]));
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('passes the buffer directly to worker.recognize()', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
    await extractTextFromImage(buf);
    expect(mockRecognize).toHaveBeenCalledWith(buf);
  });
});

// ---------------------------------------------------------------------------
// OCR_FAILED — recognize throws
// ---------------------------------------------------------------------------

describe('extractTextFromImage — OCR_FAILED', () => {
  it('throws OCR_FAILED (statusCode 422) when worker.recognize throws', async () => {
    mockRecognize.mockRejectedValue(new Error('WASM initialization error'));

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      code:       'OCR_FAILED',
      statusCode: 422,
    });
  });

  it('includes original error message in OCR_FAILED message', async () => {
    mockRecognize.mockRejectedValue(new Error('Segmentation fault in WASM'));

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      message: expect.stringContaining('Segmentation fault in WASM'),
    });
  });

  it('calls worker.terminate() in finally even when recognize throws', async () => {
    mockRecognize.mockRejectedValue(new Error('OCR error'));

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toThrow();
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('throws OCR_FAILED when createWorker throws', async () => {
    mockCreateWorker.mockRejectedValue(new Error('Cannot load tesseract WASM'));

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toMatchObject({
      code:       'OCR_FAILED',
      statusCode: 422,
    });
  });

  it('does NOT call terminate() when createWorker throws (no worker to terminate)', async () => {
    mockCreateWorker.mockRejectedValue(new Error('Cannot load tesseract WASM'));

    await expect(extractTextFromImage(Buffer.from([0]))).rejects.toThrow();
    // terminate should not have been called since worker was never created
    expect(mockTerminate).not.toHaveBeenCalled();
  });
});
