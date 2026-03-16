// pdfDownloader — downloads a PDF from a URL and returns it as a Buffer.
//
// Enforces:
//   - 30-second request timeout via AbortSignal.timeout
//   - Non-2xx HTTP status → FETCH_FAILED
//   - Content-Type not application/pdf or application/octet-stream → INVALID_PDF
//   - Response body > 20 MB → PAYLOAD_TOO_LARGE
//   - Network / DNS / AbortError → FETCH_FAILED
//
// The optional fetchImpl parameter enables test-time dependency injection
// (same DI pattern as htmlFetcher.ts). Production code uses the global fetch.

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Downloads the PDF at the given URL and returns its bytes as a Buffer.
 *
 * @param url       - A valid http/https URL pointing to a PDF file.
 * @param fetchImpl - Optional fetch implementation for testing (defaults to global fetch).
 * @throws Error with code FETCH_FAILED      — non-2xx response or network error
 * @throws Error with code INVALID_PDF       — response Content-Type is not PDF/octet-stream
 * @throws Error with code PAYLOAD_TOO_LARGE — response body exceeds 20 MB
 */
export async function downloadPdf(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Network error, DNS failure, or AbortError
    throw Object.assign(
      new Error(`Failed to download PDF: ${(err as Error).message}`),
      { statusCode: 422, code: 'FETCH_FAILED' },
    );
  }

  // Non-2xx HTTP status
  if (!response.ok) {
    throw Object.assign(
      new Error(`Failed to download PDF: HTTP ${response.status}`),
      { statusCode: 422, code: 'FETCH_FAILED' },
    );
  }

  // Content-Type validation
  const contentType = response.headers.get('content-type') ?? '';
  const ctLower = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ctLower !== 'application/pdf' && ctLower !== 'application/octet-stream') {
    throw Object.assign(
      new Error(`URL did not return a PDF (Content-Type: ${contentType})`),
      { statusCode: 422, code: 'INVALID_PDF' },
    );
  }

  // Stream accumulation with size cap
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (response.body === null) {
    throw Object.assign(
      new Error('Failed to download PDF: response body is null'),
      { statusCode: 422, code: 'FETCH_FAILED' },
    );
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value !== undefined) {
        totalBytes += value.byteLength;

        if (totalBytes > MAX_PDF_BYTES) {
          reader.cancel().catch(() => undefined);
          throw Object.assign(
            new Error('PDF exceeds the 20 MB size limit'),
            { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' },
          );
        }

        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}
