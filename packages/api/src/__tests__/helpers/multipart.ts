// Shared multipart body builder for integration tests (F091)
// Extracted from f075.audio.route.test.ts:198 for reuse in F091 route tests.

export const MULTIPART_BOUNDARY = '----TestBoundary7x8y9z';

/**
 * Build a minimal multipart/form-data body with an audio file part and a
 * duration text field. Additional text fields can be added via extraFields.
 */
export function buildMultipartBody(opts: {
  audioPart?: { content: Buffer; filename: string; mimeType: string } | null;
  duration?: string | null;
  extraFields?: Record<string, string>;
}): Buffer {
  const boundary = MULTIPART_BOUNDARY;
  const parts: Buffer[] = [];

  if (opts.audioPart !== undefined && opts.audioPart !== null) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${opts.audioPart.filename}"\r\nContent-Type: ${opts.audioPart.mimeType}\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(opts.audioPart.content);
    parts.push(Buffer.from('\r\n'));
  }

  if (opts.duration !== null && opts.duration !== undefined) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="duration"\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(Buffer.from(opts.duration));
    parts.push(Buffer.from('\r\n'));
  }

  for (const [key, value] of Object.entries(opts.extraFields ?? {})) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n`;
    parts.push(Buffer.from(header));
    parts.push(Buffer.from(value));
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return Buffer.concat(parts);
}
