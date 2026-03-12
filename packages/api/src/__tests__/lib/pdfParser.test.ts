// Unit tests for lib/pdfParser.ts
//
// Tests the thin pdf-parse wrapper. Uses a minimal in-memory PDF buffer.
// No mocks — wires through the real pdf-parse library.

import { describe, it, expect } from 'vitest';
import { extractText } from '../../lib/pdfParser.js';

// Minimal valid PDF buffer (1 page, contains the word "Hello")
// This is the smallest valid PDF structure that pdf-parse can process.
const MINIMAL_PDF_TEXT = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>
stream
BT /F1 12 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000360 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
441
%%EOF`;

describe('extractText', () => {
  it('returns a string array from a minimal valid PDF buffer', async () => {
    const buffer = Buffer.from(MINIMAL_PDF_TEXT);
    const result = await extractText(buffer);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('throws on empty buffer', async () => {
    const buffer = Buffer.alloc(0);

    await expect(extractText(buffer)).rejects.toThrow();
  });

  it('throws UNSUPPORTED_PDF when PDF has no extractable text', async () => {
    // A valid PDF with no text content — page exists but text is empty
    const emptyTextPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
196
%%EOF`;

    const buffer = Buffer.from(emptyTextPdf);
    await expect(extractText(buffer)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PDF',
      statusCode: 422,
    });
  });
});
