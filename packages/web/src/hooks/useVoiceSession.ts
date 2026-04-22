'use client';

// useVoiceSession — wraps MediaRecorder + AnalyserNode silence detection
// + sendVoiceMessage fetch behind a VoiceSession interface.
//
// MIME auto-detection: prefers audio/webm;codecs=opus, falls back to audio/mp4.
// Silence detection: AnalyserNode RMS < 0.01 for 2000ms → auto-stop.
// Max duration: 120s hard limit.
// StrictMode guard: start() is a no-op if already recording.
// Retry: after error, retained Blob can be re-submitted via retry() without re-recording.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConversationMessageResponse } from '@foodxplorer/shared';
import { sendVoiceMessage, ApiError } from '@/lib/apiClient';
import type { VoiceSessionState, VoiceErrorCode } from '@/types/voice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoiceSessionError {
  code: VoiceErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export interface UseVoiceSessionReturn {
  state: VoiceSessionState;
  mimeType: string;
  durationMs: number;
  lastResponse: ConversationMessageResponse | null;
  error: VoiceSessionError | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// MIME detection (evaluated once at module load, not per hook instance)
// ---------------------------------------------------------------------------

function detectMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/ogg')) return 'audio/ogg';
  return 'audio/webm'; // last resort
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILENCE_THRESHOLD = 0.01; // RMS amplitude
const SILENCE_DURATION_MS = 2000;
const SILENCE_POLL_MS = 100;
const MAX_DURATION_MS = 120_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceSession(actorId: string): UseVoiceSessionReturn {
  const mimeType = useRef<string>(detectMimeType()).current;

  const [state, setState] = useState<VoiceSessionState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [lastResponse, setLastResponse] = useState<ConversationMessageResponse | null>(null);
  const [error, setError] = useState<VoiceSessionError | null>(null);

  // Mirror of state in a ref for synchronous reads inside callbacks/closures
  const stateRef = useRef<VoiceSessionState>('idle');
  function setStateSynced(s: VoiceSessionState) {
    stateRef.current = s;
    setState(s);
  }

  // Internal refs — survive re-renders, not exposed
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const retainedBlobRef = useRef<Blob | null>(null);
  const silenceMsRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupAudio() {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    silenceTimerRef.current = null;
    maxDurationTimerRef.current = null;

    if (audioContextRef.current) {
      try { void audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    recorderRef.current = null;
    chunksRef.current = [];
    silenceMsRef.current = 0;
  }

  async function uploadBlob(blob: Blob) {
    const duration = (Date.now() - startTimeRef.current) / 1000;

    let response: ConversationMessageResponse;
    try {
      response = await sendVoiceMessage(blob, mimeType, duration, actorId);
      retainedBlobRef.current = null; // clear retained on success
      setLastResponse(response);
      setError(null);
      setStateSynced('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const errorCode: VoiceErrorCode | string =
          err.code === 'RATE_LIMIT_EXCEEDED'
            ? 'rate_limit'
            : err.code === 'IP_VOICE_LIMIT_EXCEEDED'
            ? 'ip_limit'
            : err.code === 'VOICE_BUDGET_EXHAUSTED'
            ? 'budget_cap'
            : err.code === 'EMPTY_TRANSCRIPTION'
            ? 'empty_transcription'
            : err.code === 'TRANSCRIPTION_FAILED'
            ? 'whisper_failure'
            : err.code === 'NETWORK_ERROR'
            ? 'network'
            : err.code;
        setError({
          code: errorCode,
          message: err.message,
          details: err.details,
        });
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        // Silently ignore abort
        setStateSynced('idle');
        return;
      } else {
        setError({ code: 'network', message: err instanceof Error ? err.message : 'Unknown error' });
      }
      setStateSynced('error');
    }
  }

  const start = useCallback(async () => {
    // StrictMode guard: no-op if already recording
    if (stateRef.current === 'recording' || recorderRef.current !== null) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      const domErr = err as { name?: string };
      let code: VoiceErrorCode = 'mic_hardware';
      if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
        code = 'mic_permission';
      }
      setError({ code, message: err instanceof Error ? err.message : 'Microphone error' });
      setStateSynced('error');
      return;
    }

    const stream = streamRef.current!;
    chunksRef.current = [];
    silenceMsRef.current = 0;
    startTimeRef.current = Date.now();

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: { data: Blob }) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      setDurationMs(Date.now() - startTimeRef.current);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      retainedBlobRef.current = blob;

      // Use stateRef.current for synchronous read (state closure would be stale)
      if (stateRef.current !== 'idle') {
        setStateSynced('uploading');
        uploadBlob(blob);
      }
      cleanupAudio();
    };

    // Silence detection via AnalyserNode
    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      silenceTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);

        // Compute RMS of normalized signal
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const normalized = (buffer[i]! - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);

        if (rms < SILENCE_THRESHOLD) {
          silenceMsRef.current += SILENCE_POLL_MS;
          if (silenceMsRef.current >= SILENCE_DURATION_MS) {
            // Auto-stop on sustained silence
            silenceMsRef.current = 0;
            if (recorderRef.current && recorderRef.current.state === 'recording') {
              recorderRef.current.stop();
            }
          }
        } else {
          silenceMsRef.current = 0;
        }
      }, SILENCE_POLL_MS);
    } catch {
      // AudioContext unavailable — silence detection disabled, manual stop required
    }

    // 120s max duration hard stop
    maxDurationTimerRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
    }, MAX_DURATION_MS);

    recorder.start(100); // collect chunks every 100ms
    setStateSynced('recording');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, mimeType]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      // Set uploading before stop() — onstop will also set it (idempotent)
      setStateSynced('uploading');
      recorderRef.current.stop();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    silenceTimerRef.current = null;
    maxDurationTimerRef.current = null;

    if (recorderRef.current) {
      // Override onstop to skip upload
      recorderRef.current.onstop = null;
      if (recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    }

    if (audioContextRef.current) {
      try { void audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    retainedBlobRef.current = null;
    chunksRef.current = [];
    setError(null);
    setStateSynced('idle');
  }, []);

  const retry = useCallback(() => {
    if (!retainedBlobRef.current) return;
    const blob = retainedBlobRef.current;
    setStateSynced('uploading');
    setError(null);
    uploadBlob(blob);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, mimeType]);

  return {
    state,
    mimeType,
    durationMs,
    lastResponse,
    error,
    start,
    stop,
    cancel,
    retry,
  };
}
