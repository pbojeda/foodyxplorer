// PDF text extraction wrapper around pdf-parse v2.
//
// extractText(buffer) → string[]
//
// pdf-parse@2.x uses a PDFParse class with { data: buffer } constructor options.
// Returns one string per page.
// Throws UNSUPPORTED_PDF if the PDF contains no extractable text
// (e.g. image-based / scanned PDF).

import { PDFParse } from 'pdf-parse';

/**
 * Extracts text from a PDF buffer and returns it as an array of page strings.
 *
 * Uses pdf-parse@2.x PDFParse class API:
 *   new PDFParse({ data: buffer, verbosity: 0 }).getText()
 *
 * @param buffer - Raw PDF file buffer
 * @returns Array of page text strings (one per page), non-empty strings only
 * @throws UNSUPPORTED_PDF if the PDF contains no extractable text
 * @throws Error if pdf-parse fails to parse the buffer
 */
export async function extractText(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: buffer, verbosity: 0 });
  const result = await parser.getText();

  // result.pages is an array of { text: string; num: number }
  const pages = result.pages
    .map((p) => p.text.trim())
    .filter((text) => text.length > 0);

  if (pages.length === 0) {
    throw Object.assign(
      new Error('PDF contains no extractable text'),
      { statusCode: 422, code: 'UNSUPPORTED_PDF' },
    );
  }

  return pages;
}
