// imageDownloader — downloads an image from a URL and returns it as a Buffer.
//
// Enforces:
//   - 30-second request timeout via AbortSignal.timeout
//   - Non-2xx HTTP status → FETCH_FAILED
//   - Content-Type not image/* or application/octet-stream → INVALID_IMAGE
//   - Response body > 10 MB → PAYLOAD_TOO_LARGE
//   - Network / DNS / AbortError → FETCH_FAILED
//
// The optional fetchImpl parameter enables test-time dependency injection
// (same DI pattern as pdfDownloader.ts). Production code uses the global fetch.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// Allowed Content-Type base types (lowercased, without parameters).
// application/octet-stream is included as a CDN fallback — magic bytes
// validation in the route is the authoritative format check.
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);

/**
 * Downloads the image at the given URL and returns its bytes as a Buffer.
 *
 * @param url       - A valid http/https URL pointing to an image file.
 * @param fetchImpl - Optional fetch implementation for testing (defaults to global fetch).
 * @throws Error with code FETCH_FAILED      — non-2xx response, network error, or null body
 * @throws Error with code INVALID_IMAGE     — response Content-Type is not image/* or octet-stream
 * @throws Error with code PAYLOAD_TOO_LARGE — response body exceeds 10 MB
 */
export async function downloadImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string }> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Network error, DNS failure, or AbortError
    throw Object.assign(
      new Error(`Failed to download image: ${(err as Error).message}`),
      { statusCode: 422, code: 'FETCH_FAILED' },
    );
  }

  // Non-2xx HTTP status
  if (!response.ok) {
    throw Object.assign(
      new Error(`Failed to download image: HTTP ${response.status}`),
      { statusCode: 422, code: 'FETCH_FAILED' },
    );
  }

  // Content-Type validation
  const contentType = response.headers.get('content-type') ?? '';
  const ctBase = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  const isImageType = ctBase.startsWith('image/');
  const isAllowed = isImageType || ALLOWED_CONTENT_TYPES.has(ctBase);

  if (!isAllowed) {
    throw Object.assign(
      new Error(`URL did not return an image (Content-Type: ${contentType})`),
      { statusCode: 422, code: 'INVALID_IMAGE' },
    );
  }

  // Stream accumulation with size cap
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (response.body === null) {
    throw Object.assign(
      new Error('Failed to download image: response body is null'),
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

        if (totalBytes > MAX_IMAGE_BYTES) {
          reader.cancel().catch(() => undefined);
          throw Object.assign(
            new Error('Image exceeds the 10 MB size limit'),
            { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' },
          );
        }

        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { buffer: Buffer.concat(chunks), contentType };
}
