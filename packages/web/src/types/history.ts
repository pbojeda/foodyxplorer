// Client-only types for F-WEB-HISTORY session transcript + persisted history.
// These are UI-layer types, NOT Zod schemas. The canonical API schemas live in
// @foodxplorer/shared (SearchHistoryEntrySchema / HistoryPageSchema).

import type { ConversationMessageData, MenuAnalysisData } from '@foodxplorer/shared';

/**
 * Represents a single query+result pair in the TranscriptFeed.
 *
 * Session-only entries: entryId = crypto.randomUUID(), isPersisted = false.
 * Persisted entries (from GET /history): entryId = search_history.id (UUID),
 *   isPersisted = true, timestamp = new Date(entry.createdAt).
 *
 * Photo entries: inputMode = 'photo', photoData is set, result is null.
 * Text/voice entries: inputMode = 'text' | 'voice', result is set, photoData is null.
 */
export interface TranscriptEntryData {
  /** Stable ID for React key and optimistic updates. UUID. */
  entryId: string;

  /** The user-submitted query text (or voice placeholder while in-flight). */
  queryText: string;

  /** Input modality — determines icon and result body renderer. */
  inputMode: 'text' | 'voice' | 'photo';

  /** When the entry was created (local time for session entries, server time for persisted). */
  timestamp: Date;

  /** True while the API call is in-flight (shimmer is shown). */
  isLoading: boolean;

  /** Set when the API call has settled with a successful response (text/voice only). */
  result: ConversationMessageData | null;

  /** Set for photo entries — MenuAnalysisData from POST /api/analyze. */
  photoData: MenuAnalysisData | null;

  /** Set when the API call failed (per-entry inline error). */
  error: string | null;

  /**
   * True for entries pre-loaded from GET /history (shows "Guardado" badge).
   * False for entries created during the current session.
   */
  isPersisted: boolean;
}
