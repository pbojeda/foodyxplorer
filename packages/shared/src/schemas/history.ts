// Zod schemas for F-WEB-HISTORY — Search history (persisted history for authenticated accounts).
//
// SearchHistoryKindSchema  — enum text | voice (photo is OUT of v1 per fork D3)
// SearchHistoryEntrySchema — single row as returned by GET /history
// HistoryPageSchema        — paginated response from GET /history (entries + nextCursor)
//
// Design decisions:
//   - resultData is typed as ConversationMessageDataSchema (the real response union), NOT an
//     untyped record. conversation.ts does NOT import history.ts, so this import is one-way and
//     non-circular (verified). Strict typing lets the shared layer catch schema drift instead of
//     silently accepting payloads the transcript renderer no longer supports (cross-model C2).
//     Drift handling: the web validates each entry individually via safeParse and SKIPS entries
//     that fail (e.g. a very old payload predating a ConversationMessageData change) — a skipped
//     stale entry is graceful degradation, never a fatal page error. (Schema versioning of
//     result_jsonb is deferred — YAGNI for v1; strict typing is the correctness fix.)
//   - queryText max is 2000 to match POST /conversation/message body.text (.max(2000)). A query
//     of 501–2000 chars yields a *successful* `text_too_long` intent (HTTP 200), so it IS on the
//     persistence success path; a 500 cap would reject a valid history row (cross-model C3).
//   - createdAt is a string (ISO 8601). DB stores timestamptz, API serializes to ISO string.
//   - nextCursor is nullable — null when there are no older entries beyond this page.
//   - All new fields are required (no optional()-for-deploy-skew) because F-WEB-HISTORY is a
//     new feature that ships atomically: the web and api deploy together. If the api is rolled
//     back, the web falls back to session-only mode (the fetch is best-effort — errors are
//     swallowed gracefully by HablarShell).

import { z } from 'zod';
import { ConversationMessageDataSchema } from './conversation.js';

// ---------------------------------------------------------------------------
// SearchHistoryKind — enum stored in DB as search_history_kind
// ---------------------------------------------------------------------------

/**
 * The input modality that produced the history entry.
 * - `text`  — user typed a query via ConversationInput.
 * - `voice` — user submitted a voice query (Whisper transcription path).
 * Photo is explicitly excluded from persisted history v1 (fork D3).
 */
export const SearchHistoryKindSchema = z.enum(['text', 'voice']);
export type SearchHistoryKind = z.infer<typeof SearchHistoryKindSchema>;

// ---------------------------------------------------------------------------
// SearchHistoryEntry — single persisted history row (GET /history response item)
// ---------------------------------------------------------------------------

/**
 * Single entry in a user's persisted search history.
 *
 * `resultData` is the full `ConversationMessageData` payload returned by
 * POST /conversation/message (or /conversation/audio) at the time the query was
 * made. The web uses it to re-render the result card(s) — across ALL intent
 * shapes (estimation, comparison, contextSet, text_too_long, …) — without a new
 * estimation request. Typed strictly so schema drift is caught at the boundary.
 *
 * Forward-compat: this schema does NOT use .optional() fields because this is
 * a brand-new feature with a coordinated deploy. Unlike F-WEB-TIER where `tier`
 * was added to an existing API response, history entries are entirely new data.
 */
export const SearchHistoryEntrySchema = z.object({
  id: z.string().uuid().describe('UUID primary key of the search_history row.'),
  kind: SearchHistoryKindSchema.describe('Modality that produced this entry: text or voice.'),
  queryText: z.string().min(1).max(2000).describe(
    'The user-submitted query text (or Whisper transcript for voice). ' +
    'Max 2000 chars mirrors POST /conversation/message body.text limit (.max(2000)); ' +
    'a 501–2000 char query is a successful text_too_long intent and is still persisted.',
  ),
  resultData: ConversationMessageDataSchema.describe(
    'Full ConversationMessageData payload stored at query time. ' +
    'Used by the web to re-render the result card(s) for any intent without a new request. ' +
    'The web safeParses each entry and skips any that fail (very old drifted payloads).',
  ),
  createdAt: z.string().datetime().describe(
    'ISO 8601 timestamp (UTC) when this entry was created. ' +
    'Matches search_history.created_at (timestamptz).',
  ),
});

export type SearchHistoryEntry = z.infer<typeof SearchHistoryEntrySchema>;

// ---------------------------------------------------------------------------
// HistoryPage — paginated response from GET /history
// ---------------------------------------------------------------------------

/**
 * Cursor-paginated response for GET /history.
 *
 * Entries are ordered newest-first (the API returns them in
 * (created_at DESC, id DESC) order). The web reverses them before prepending
 * to the TranscriptFeed (which displays oldest-at-top per W16).
 *
 * Cursor pagination:
 *   - `nextCursor` is an opaque string encoding `created_at + id` of the
 *     oldest entry in the current page. Pass it as `?cursor=` to load the
 *     next (older) batch.
 *   - `null` means there are no older entries — infinite scroll sentinel
 *     should stop observing.
 */
export const HistoryPageSchema = z.object({
  entries: z.array(SearchHistoryEntrySchema).describe(
    'Batch of history entries, newest-first. ' +
    'Empty array when there are no more entries (sentinel stop condition).',
  ),
  nextCursor: z.string().nullable().describe(
    'Opaque cursor for the next (older) page. ' +
    'Null when this is the last page (no older entries exist).',
  ),
});

export type HistoryPage = z.infer<typeof HistoryPageSchema>;
