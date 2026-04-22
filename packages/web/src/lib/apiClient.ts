// API client for nutriXplorer web.
//
// sendMessage(text, actorId, signal?) — thin wrapper around POST /conversation/message.
// Always applies a 15-second timeout via AbortSignal.any/timeout.
// Reads X-Actor-Id from response headers and calls persistActorId when it differs.
//
// sendPhotoAnalysis(file, actorId, signal?) — sends a plate photo to the Next.js
// Route Handler proxy at /api/analyze (POST). Always applies a 65-second timeout.
//
// sendVoiceMessage(blob, mimeType, durationSeconds, actorId, signal?) — sends audio
// blob directly to POST /conversation/audio. No proxy — direct to NEXT_PUBLIC_API_URL.
// No X-API-Key (voice is open to all tiers). Always applies a 15-second timeout.

import type { ConversationMessageResponse, MenuAnalysisResponse } from '@foodxplorer/shared';
import { persistActorId } from './actorId';

// ---------------------------------------------------------------------------
// ApiError — typed error for non-2xx or malformed responses
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, status?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Response shape guard
// ---------------------------------------------------------------------------

function isMenuAnalysisResponse(value: unknown): value is MenuAnalysisResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as Record<string, unknown>)['success'] === true &&
    'data' in value &&
    typeof (value as Record<string, unknown>)['data'] === 'object'
  );
}

function isConversationMessageResponse(value: unknown): value is ConversationMessageResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as Record<string, unknown>)['success'] === true &&
    'data' in value &&
    typeof (value as Record<string, unknown>)['data'] === 'object'
  );
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

/**
 * Sends a user text query to POST /conversation/message.
 *
 * @param text      User's query string.
 * @param actorId   The actor UUID (from actorId.ts).
 * @param signal    Optional external AbortSignal (e.g. from AbortController in HablarShell).
 *                  A 15-second timeout is ALWAYS applied in addition.
 * @returns         Parsed ConversationMessageResponse.
 * @throws ApiError on non-2xx responses or malformed JSON.
 * @throws DOMException (AbortError) when the request is aborted — NOT wrapped in ApiError.
 */
export async function sendMessage(
  text: string,
  actorId: string,
  signal?: AbortSignal,
): Promise<ConversationMessageResponse> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not defined. Set it in your .env.local file.'
    );
  }

  // Always enforce a 15-second hard timeout, merged with any external signal.
  const timeoutSignal = AbortSignal.timeout(15000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/conversation/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Actor-Id': actorId,
        'X-FXP-Source': 'web',
      },
      body: JSON.stringify({ text }),
      signal: combinedSignal,
    });
  } catch (err) {
    // Re-throw AbortError directly — callers handle stale request silencing
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    // TimeoutError from AbortSignal.timeout(15000) — wrap with specific code
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(
        'La consulta ha tardado demasiado. Inténtalo de nuevo.',
        'TIMEOUT_ERROR',
      );
    }
    // Network failure
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  // Read server-issued actor ID from response header
  const serverActorId = response.headers.get('X-Actor-Id');
  if (serverActorId && serverActorId !== actorId) {
    persistActorId(serverActorId);
  }

  // Parse JSON
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  // Handle error responses (non-2xx)
  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    const details = typeof errorObj['details'] === 'object' && errorObj['details'] !== null
      ? errorObj['details'] as Record<string, unknown>
      : undefined;
    throw new ApiError(message, code, response.status, details);
  }

  // Validate response shape
  if (!isConversationMessageResponse(json)) {
    throw new ApiError(
      'La respuesta del servidor tiene un formato inesperado.',
      'MALFORMED_RESPONSE',
      response.status,
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// sendPhotoAnalysis
// ---------------------------------------------------------------------------

/**
 * Sends a plate/menu photo to the Next.js Route Handler proxy at /api/analyze.
 * The Route Handler attaches the private API_KEY and proxies to POST /analyze/menu.
 * mode is always "identify" for single-dish photos (F092).
 *
 * @param file     The image File object selected by the user.
 * @param actorId  The actor UUID (from actorId.ts).
 * @param signal   Optional external AbortSignal (e.g. from AbortController in HablarShell).
 *                 A 65-second timeout is ALWAYS applied in addition.
 * @returns        Parsed MenuAnalysisResponse.
 * @throws ApiError on non-2xx responses or malformed JSON.
 * @throws DOMException (AbortError) when the request is aborted — NOT wrapped in ApiError.
 */
export async function sendPhotoAnalysis(
  file: File,
  actorId: string,
  signal?: AbortSignal,
): Promise<MenuAnalysisResponse> {
  // Always enforce a 65-second hard timeout (Vision API + cascade takes up to 60s).
  // Merges with any external signal (e.g. stale-request abort from HablarShell).
  const timeoutSignal = AbortSignal.timeout(65000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Build multipart FormData — do NOT set Content-Type manually; browser sets
  // the correct multipart/form-data; boundary=... value automatically.
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', 'identify');

  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'X-Actor-Id': actorId,
        'X-FXP-Source': 'web',
      },
      body: formData,
      signal: combinedSignal,
    });
  } catch (err) {
    // Re-throw AbortError directly — callers handle stale request silencing
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    // TimeoutError from AbortSignal.timeout(65000) — wrap with specific code
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(
        'El análisis ha tardado demasiado. Inténtalo de nuevo.',
        'TIMEOUT_ERROR',
      );
    }
    // Network failure
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  // Parse JSON
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    // BUG-PROD-001: Vercel's own platform 413 returns an HTML body, not JSON.
    // Detect the status before falling back to a generic PARSE_ERROR so the
    // UI can surface the size-specific message instead of "formato inesperado".
    if (response.status === 413) {
      throw new ApiError(
        'La foto es demasiado grande para subir.',
        'PAYLOAD_TOO_LARGE',
        413,
      );
    }
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  // Handle error responses (non-2xx)
  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    const details = typeof errorObj['details'] === 'object' && errorObj['details'] !== null
      ? errorObj['details'] as Record<string, unknown>
      : undefined;
    throw new ApiError(message, code, response.status, details);
  }

  // Validate response shape
  if (!isMenuAnalysisResponse(json)) {
    throw new ApiError(
      'La respuesta del servidor tiene un formato inesperado.',
      'MALFORMED_RESPONSE',
      response.status,
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// sendVoiceMessage
// ---------------------------------------------------------------------------

/**
 * Sends recorded audio to POST /conversation/audio directly (no Next.js proxy).
 * Voice is open to all tiers — no X-API-Key required.
 *
 * @param blob             The recorded audio Blob (webm or mp4).
 * @param mimeType         The MIME type string (e.g. "audio/webm;codecs=opus").
 *                         Used to derive the filename for Whisper MIME detection.
 * @param durationSeconds  Advisory audio duration in seconds. Server re-verifies.
 * @param actorId          The actor UUID (from actorId.ts).
 * @param signal           Optional external AbortSignal.
 *                         A 15-second timeout is ALWAYS applied in addition.
 * @returns                Parsed ConversationMessageResponse.
 * @throws ApiError on non-2xx responses or malformed JSON.
 * @throws DOMException (AbortError) when the request is aborted.
 */
export async function sendVoiceMessage(
  blob: Blob,
  mimeType: string,
  durationSeconds: number,
  actorId: string,
  signal?: AbortSignal,
): Promise<ConversationMessageResponse> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not defined. Set it in your .env.local file.'
    );
  }

  // Derive filename from MIME type base (strip codec params).
  // Example: "audio/webm;codecs=opus" -> "audio.webm"
  //          "audio/mp4"              -> "audio.mp4"
  const mimeBase = mimeType.split(';')[0]?.trim() ?? 'audio/webm';
  const ext = mimeBase.split('/')[1] ?? 'webm';
  const filename = `audio.${ext}`;

  // Build multipart FormData — browser sets Content-Type boundary automatically.
  const formData = new FormData();
  formData.append('audio', new File([blob], filename, { type: mimeBase }));
  formData.append('duration', String(Math.round(durationSeconds)));

  // Always enforce a 15-second hard timeout, merged with any external signal.
  const timeoutSignal = AbortSignal.timeout(15000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/conversation/audio`, {
      method: 'POST',
      headers: {
        'X-Actor-Id': actorId,
        'X-FXP-Source': 'web',
        // NO X-API-Key — voice is open to all tiers, keyed on actor/IP
      },
      body: formData,
      signal: combinedSignal,
    });
  } catch (err) {
    // Re-throw AbortError directly
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    // TimeoutError from AbortSignal.timeout(15000)
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(
        'La consulta ha tardado demasiado. Inténtalo de nuevo.',
        'TIMEOUT_ERROR',
      );
    }
    // Network failure
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  // Parse JSON
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('La respuesta del servidor no es JSON valido.', 'PARSE_ERROR', response.status);
  }

  // Handle error responses (non-2xx)
  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    const details = typeof errorObj['details'] === 'object' && errorObj['details'] !== null
      ? errorObj['details'] as Record<string, unknown>
      : undefined;
    throw new ApiError(message, code, response.status, details);
  }

  // Validate response shape
  if (!isConversationMessageResponse(json)) {
    throw new ApiError(
      'La respuesta del servidor tiene un formato inesperado.',
      'MALFORMED_RESPONSE',
      response.status,
    );
  }

  return json;
}
