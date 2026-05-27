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
//
// getMe() — GET /me with bearer; parses MeResponseSchema; throws ApiError on failure.
// getUsage() — GET /me/usage with bearer; parses UsageResponseSchema; throws ApiError.
//
// F-WEB-TIER: sendPhotoAnalysis now attaches Authorization: Bearer when authToken set.

import type { ConversationMessageResponse, MenuAnalysisResponse, MeResponse, UsageResponse } from '@foodxplorer/shared';
import { MeResponseSchema, UsageResponseSchema, SearchHistoryEntrySchema } from '@foodxplorer/shared';
import type { TranscriptEntryData } from '@/types/history';
import { z } from 'zod';

// API envelope wrappers for getMe / getUsage responses
export interface MeEnvelope { success: true; data: MeResponse }
export interface UsageEnvelope { success: true; data: UsageResponse }
import { persistActorId } from './actorId';

// ---------------------------------------------------------------------------
// F107a — Auth token state (ADR-025 R3 §4)
// Module-level singleton: set by HablarShell via useAuth session changes.
// ---------------------------------------------------------------------------

let authToken: string | null = null;

/**
 * Sets the current auth token for outbound API requests.
 * Called by HablarShell whenever the Supabase session changes.
 * Pass null to clear (anonymous mode).
 */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

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
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
 * Defaults to mode='auto' (menu/carta analysis). Pass mode='identify' for single-dish.
 *
 * @param file     The image File object selected by the user.
 * @param actorId  The actor UUID (from actorId.ts).
 * @param signal   Optional external AbortSignal (e.g. from AbortController in HablarShell).
 *                 A 65-second timeout is ALWAYS applied in addition.
 * @param mode     Analysis mode — 'auto' (default, menu/carta) or 'identify' (single dish).
 * @returns        Parsed MenuAnalysisResponse.
 * @throws ApiError on non-2xx responses or malformed JSON.
 * @throws DOMException (AbortError) when the request is aborted — NOT wrapped in ApiError.
 */
export async function sendPhotoAnalysis(
  file: File,
  actorId: string,
  signal?: AbortSignal,
  mode: 'auto' | 'identify' = 'auto',
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
  formData.append('mode', mode);

  let response: Response;
  try {
    // F-WEB-TIER: attach bearer when set so the proxy can forward it to Fastify
    // for account tier resolution (photo rate limits per-account).
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'X-Actor-Id': actorId,
        'X-FXP-Source': 'web',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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

// ---------------------------------------------------------------------------
// getMe — F-WEB-TIER
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's account data from GET /me.
 * Requires authToken to be set via setAuthToken() before calling.
 * Triggers account provisioning + actor linking via /me's existing F107a-FU2 path.
 *
 * @returns Parsed MeResponse.
 * @throws ApiError with UNAUTHORIZED if no token is set.
 * @throws ApiError on non-2xx or parse failure.
 */
export async function getMe(): Promise<MeEnvelope> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not defined.');
  }
  if (!authToken) {
    throw new ApiError('No auth token — call setAuthToken first.', 'UNAUTHORIZED', 401);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
  }

  // API returns { success: true, data: { account, actor } }
  const dataField = (json as Record<string, unknown>)['data'];
  const parsedData = MeResponseSchema.safeParse(dataField);
  if (!parsedData.success) {
    throw new ApiError('La respuesta de /me tiene formato inesperado.', 'MALFORMED_RESPONSE', response.status);
  }

  return { success: true, data: parsedData.data };
}

// ---------------------------------------------------------------------------
// getUsage — F-WEB-TIER
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's daily usage from GET /me/usage.
 * Requires authToken to be set via setAuthToken() before calling.
 * Read-only — never increments quota counters.
 *
 * @returns Parsed UsageResponse (tier, resetAt, buckets).
 * @throws ApiError with UNAUTHORIZED if no token is set.
 * @throws ApiError on non-2xx or parse failure.
 */
export async function getUsage(): Promise<UsageEnvelope> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not defined.');
  }
  if (!authToken) {
    throw new ApiError('No auth token — call setAuthToken first.', 'UNAUTHORIZED', 401);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/me/usage`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
  }

  // API returns { success: true, data: { tier, resetAt, buckets } }
  const dataField = (json as Record<string, unknown>)['data'];
  const parsedData = UsageResponseSchema.safeParse(dataField);
  if (!parsedData.success) {
    throw new ApiError('La respuesta de /me/usage tiene formato inesperado.', 'MALFORMED_RESPONSE', response.status);
  }

  return { success: true, data: parsedData.data };
}

// ---------------------------------------------------------------------------
// F-WEB-HISTORY: getHistory / deleteHistoryEntry / clearHistory
// ---------------------------------------------------------------------------

// Loose envelope schema for the first parse (cross-model X1 — per-entry parse).
// We do NOT parse the whole page with HistoryPageSchema because one drifted entry
// would reject the entire page. Parse the envelope first, then each entry individually.
const LooseHistoryEnvelopeSchema = z.object({
  entries: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
});

export interface HistoryPageResult {
  entries: TranscriptEntryData[];
  nextCursor: string | null;
}

/**
 * Fetches a cursor-paginated page of search history from GET /history.
 * Requires authToken to be set via setAuthToken() before calling.
 *
 * Per-entry parse (cross-model X1): each entry is individually safeParsed;
 * entries failing SearchHistoryEntrySchema are silently skipped (drift tolerance).
 *
 * @param cursor  Opaque cursor string from the previous page; omit for first page.
 * @param limit   Number of entries per page (1–50, default 10).
 * @returns       Parsed entries (oldest-first, already reversed) + nextCursor.
 * @throws ApiError on non-2xx or malformed envelope.
 */
export async function getHistory(
  cursor?: string | null,
  limit = 10,
): Promise<HistoryPageResult> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not defined.');
  }
  if (!authToken) {
    throw new ApiError('No auth token — call setAuthToken first.', 'UNAUTHORIZED', 401);
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/history?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('La respuesta del servidor no es JSON válido.', 'PARSE_ERROR', response.status);
  }

  if (!response.ok) {
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
  }

  // Parse loose envelope first (cross-model X1)
  const dataField = (json as Record<string, unknown>)['data'];
  const envelopeParsed = LooseHistoryEnvelopeSchema.safeParse(dataField);
  if (!envelopeParsed.success) {
    throw new ApiError('La respuesta de /history tiene formato inesperado.', 'MALFORMED_RESPONSE', response.status);
  }

  const { entries: rawEntries, nextCursor } = envelopeParsed.data;

  // Per-entry safe parse — skip drifted entries (cross-model C2)
  const validEntries: TranscriptEntryData[] = [];
  for (const rawEntry of rawEntries) {
    const parsed = SearchHistoryEntrySchema.safeParse(rawEntry);
    if (!parsed.success) {
      // Skip: schema drift (very old payload) — graceful degradation, not fatal
      continue;
    }
    const entry = parsed.data;
    validEntries.push({
      entryId: entry.id,
      queryText: entry.queryText,
      inputMode: entry.kind === 'voice' ? 'voice' : 'text',
      timestamp: new Date(entry.createdAt),
      isLoading: false,
      result: entry.resultData,
      photoData: null,
      error: null,
      isPersisted: true,
    });
  }

  // API returns newest-first; TranscriptFeed displays oldest-at-top (W16).
  // Reverse so the oldest in this page is at index 0.
  validEntries.reverse();

  return { entries: validEntries, nextCursor };
}

/**
 * Deletes a single history entry via DELETE /history/{id}.
 * Requires authToken to be set via setAuthToken() before calling.
 *
 * @throws ApiError on non-204 response (including 404 — entry not found or not owned).
 */
export async function deleteHistoryEntry(id: string): Promise<void> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not defined.');
  }
  if (!authToken) {
    throw new ApiError('No auth token — call setAuthToken first.', 'UNAUTHORIZED', 401);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
  }
}

/**
 * Clears all history for the authenticated account via DELETE /history.
 * Requires authToken to be set via setAuthToken() before calling.
 *
 * @throws ApiError on non-204 response.
 */
export async function clearHistory(): Promise<void> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not defined.');
  }
  if (!authToken) {
    throw new ApiError('No auth token — call setAuthToken first.', 'UNAUTHORIZED', 401);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/history`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    const errorBody = json as Record<string, unknown>;
    const errorObj = (errorBody?.['error'] ?? {}) as Record<string, unknown>;
    const code = typeof errorObj['code'] === 'string' ? errorObj['code'] : 'API_ERROR';
    const message = typeof errorObj['message'] === 'string' ? errorObj['message'] : `HTTP ${response.status}`;
    throw new ApiError(message, code, response.status);
  }
}
