// Frontend-local TypeScript types for F091 voice feature.
// Not in shared package — these are web-specific UI types.

// ---------------------------------------------------------------------------
// VoiceErrorCode — all voice-specific error states
// ---------------------------------------------------------------------------

export type VoiceErrorCode =
  | 'mic_permission'
  | 'mic_hardware'
  | 'empty_transcription'
  | 'network'
  | 'rate_limit'
  | 'ip_limit'
  | 'whisper_failure'
  | 'budget_cap'
  | 'tts_unavailable';

// ---------------------------------------------------------------------------
// VoiceSessionState — state machine for voice recording + upload
// ---------------------------------------------------------------------------

export type VoiceSessionState =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'done'
  | 'error';

// ---------------------------------------------------------------------------
// VoiceBudgetData — mirrors GET /health/voice-budget response shape
// ---------------------------------------------------------------------------

export interface VoiceBudgetData {
  exhausted: boolean;
  spendEur: number;
  capEur: number;
  alertLevel: 'none' | 'warn40' | 'warn70' | 'warn90' | 'warn100' | 'cap';
  monthKey: string;
}

// ---------------------------------------------------------------------------
// VoiceState — UI state machine for HablarShell voice flow
// ---------------------------------------------------------------------------

export type VoiceState =
  | 'idle'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'results'
  | 'error';
