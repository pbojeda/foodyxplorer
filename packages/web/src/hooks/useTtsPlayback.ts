'use client';

// useTtsPlayback — lightweight SpeechSynthesis wrapper for F091 voice responses.
//
// Reads hablar_voice (voice name) and hablar_tts_enabled from localStorage.
// Exposes play(text), cancel(), isSpeaking, selectedVoice.
// Does NOT handle iOS SpeechSynthesis unlock — that is the MicButton's responsibility.
// Populates voice list via voiceschanged event (required for iOS).

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Best Spanish voice auto-select heuristic (shared with VoicePickerDrawer)
// Priority: Monica → Paulina → Siri (Spanish) → Google español → Google español US
//           → es-ES locale → es-MX locale → any es* locale → first available
// ---------------------------------------------------------------------------

export const SPANISH_VOICE_PRIORITY = [
  'Monica',
  'Paulina',
  'Siri (Spanish)',
  'Google español',
  'Google español de Estados Unidos',
];

export function selectBestVoice(
  voices: SpeechSynthesisVoice[],
  preferredName?: string | null,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  // Try preferred name from localStorage first
  if (preferredName) {
    const match = voices.find((v) => v.name === preferredName);
    if (match) return match;
  }

  const spanishVoices = voices.filter((v) => v.lang.startsWith('es'));

  if (spanishVoices.length === 0) {
    // No Spanish voices — fall back to first available
    return voices[0] ?? null;
  }

  // Try priority list
  for (const priorityName of SPANISH_VOICE_PRIORITY) {
    const match = spanishVoices.find((v) => v.name === priorityName);
    if (match) return match;
  }

  // Prefer es-ES then es-MX then any es*
  return (
    spanishVoices.find((v) => v.lang === 'es-ES') ??
    spanishVoices.find((v) => v.lang === 'es-MX') ??
    spanishVoices[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTtsPlaybackReturn {
  play: (text: string) => void;
  cancel: () => void;
  isSpeaking: boolean;
  selectedVoice: SpeechSynthesisVoice | null;
  ttsEnabled: boolean;
}

export function useTtsPlayback(): UseTtsPlaybackReturn {
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Read TTS enabled preference from localStorage
  function getTtsEnabled(): boolean {
    try {
      const val = localStorage.getItem('hablar_tts_enabled');
      if (val === null) return true; // default: enabled
      return val !== 'false';
    } catch {
      return true;
    }
  }

  const [ttsEnabled] = useState<boolean>(getTtsEnabled);

  // Read preferred voice name from localStorage
  function getStoredVoiceName(): string | null {
    try {
      return localStorage.getItem('hablar_voice');
    } catch {
      return null;
    }
  }

  function updateVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    const storedName = getStoredVoiceName();
    const best = selectBestVoice(voices, storedName);
    voiceRef.current = best;
    setSelectedVoice(best);
  }

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;

    // Initial population (non-iOS — getVoices() may return list synchronously)
    updateVoice();

    // iOS: voices only available after voiceschanged event
    const handleVoicesChanged = () => {
      updateVoice();
    };

    speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(
    (text: string) => {
      if (!getTtsEnabled()) return;
      if (typeof speechSynthesis === 'undefined') return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang ?? 'es-ES';

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      setIsSpeaking(true);
      speechSynthesis.speak(utterance);
    },
    [],
  );

  const cancel = useCallback(() => {
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return {
    play,
    cancel,
    isSpeaking,
    selectedVoice,
    ttsEnabled,
  };
}
