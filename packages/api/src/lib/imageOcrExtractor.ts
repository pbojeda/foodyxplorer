// imageOcrExtractor — extracts text lines from an image buffer using Tesseract.js.
//
// Creates a Tesseract.js worker per call (create → recognize → terminate).
// Languages: spa + eng (Spanish primary, English fallback for column headers).
//
// All Tesseract errors are wrapped as OCR_FAILED (statusCode 422).
// Worker is always terminated in a finally block to release WASM memory.

import { createWorker } from 'tesseract.js';

/**
 * Extracts text lines from an image buffer using Tesseract.js OCR.
 *
 * @param buffer - Raw image buffer (JPEG or PNG).
 * @returns Array of trimmed, non-empty text lines from the OCR result.
 * @throws Error with code OCR_FAILED (statusCode 422) on any Tesseract error.
 */
export async function extractTextFromImage(buffer: Buffer): Promise<string[]> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    worker = await createWorker(['spa', 'eng']);
    const result = await worker.recognize(buffer);
    return result.data.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch (err) {
    const origMsg = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(`OCR extraction failed: ${origMsg}`),
      { statusCode: 422, code: 'OCR_FAILED' },
    );
  } finally {
    if (worker !== undefined) {
      await worker.terminate();
    }
  }
}
