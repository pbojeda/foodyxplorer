// API client for nutriXplorer web.
//
// sendMessage(text, actorId, signal?) — thin wrapper around POST /conversation/message.
// Always applies a 15-second timeout via AbortSignal.any/timeout.
// Reads X-Actor-Id from response headers and calls persistActorId when it differs.
//
// sendPhotoAnalysis(file, actorId, signal?) — sends a plate photo to the Next.js
// Route Handler proxy at /api/analyze (POST). Always applies a 65-second timeout.

import type { ConversationMessageResponse, MenuAnalysisResponse } from '@foodxplorer/shared';
import { persistActorId } from './actorId';

// ---------------------------------------------------------------------------
// ApiError — typed error for non-2xx or malformed responses
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
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
    throw new ApiError(message, code, response.status);
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
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  // Handle error responses (non-2xx)
  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
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
