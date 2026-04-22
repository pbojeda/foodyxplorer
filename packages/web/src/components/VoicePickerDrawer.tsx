'use client';

// VoicePickerDrawer — bottom drawer for voice selection, TTS toggle, and privacy link.
// Slides over VoiceOverlay. Populated via voiceschanged event (iOS timing requirement).

import { useState, useEffect, useCallback, useRef } from 'react';
import { selectBestVoice, SPANISH_VOICE_PRIORITY } from '@/hooks/useTtsPlayback';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VoicePickerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceSelect: (voiceName: string) => void;
  onTtsToggle: (enabled: boolean) => void;
  ttsEnabled: boolean;
  selectedVoiceName: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoicePickerDrawer({
  isOpen,
  onClose,
  onVoiceSelect,
  onTtsToggle,
  ttsEnabled,
  selectedVoiceName,
}: VoicePickerDrawerProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [noSpanishVoices, setNoSpanishVoices] = useState(false);
  const [playingVoiceName, setPlayingVoiceName] = useState<string | null>(null);
  const didAutoSelectRef = useRef(false);

  const loadVoices = useCallback(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const allVoices = speechSynthesis.getVoices();
    const spanishVoices = allVoices.filter((v) => v.lang.startsWith('es'));

    if (spanishVoices.length === 0 && allVoices.length > 0) {
      setNoSpanishVoices(true);
      setVoices([]);
    } else {
      setNoSpanishVoices(false);
      setVoices(spanishVoices);
    }

    // Auto-select best voice on first load (only when no selection exists yet).
    // If the user already has a selectedVoiceName (from prior session or just picked
    // one), don't overwrite it — that would be a redundant write on every drawer open.
    if (!didAutoSelectRef.current && allVoices.length > 0 && !selectedVoiceName) {
      const best = selectBestVoice(allVoices, null);
      if (best) {
        didAutoSelectRef.current = true;
        onVoiceSelect(best.name);
      }
    }
  }, [onVoiceSelect, selectedVoiceName]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof speechSynthesis === 'undefined') return;

    // Initial load (may be empty on iOS)
    loadVoices();

    const handleVoicesChanged = () => {
      loadVoices();
    };

    speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    };
  }, [isOpen, loadVoices]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function handlePreviewPlay(voice: SpeechSynthesisVoice) {
    if (typeof speechSynthesis === 'undefined') return;
    // Cancel any in-flight preview
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      'Hola, soy tu asistente nutricional. ¿En qué puedo ayudarte?'
    );
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onend = () => setPlayingVoiceName(null);
    utterance.onerror = () => setPlayingVoiceName(null);

    setPlayingVoiceName(voice.name);
    speechSynthesis.speak(utterance);
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Voz del asistente"
      aria-modal="true"
      className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 shadow-2xl"
      style={{ maxHeight: '60vh', overflowY: 'auto' }}
    >
      {/* Drag handle */}
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />

      {/* Heading */}
      <h2 className="mb-3 text-[15px] font-semibold text-slate-700">Voz del asistente</h2>

      {/* Voice list */}
      {noSpanishVoices ? (
        <p className="mb-3 text-center text-sm text-amber-600">
          No hay voces en español disponibles en este dispositivo.
        </p>
      ) : voices.length > 0 ? (
        <ul role="list" className="mb-2">
          {voices.map((voice) => (
            <li
              key={voice.name}
              data-voice-name={voice.name}
              className="flex cursor-pointer items-center gap-3 rounded-lg border-b border-slate-100 px-2 py-3 hover:bg-slate-50 last:border-b-0"
            >
              {/* Radio */}
              <input
                type="radio"
                name="voice-select"
                value={voice.name}
                checked={selectedVoiceName === voice.name}
                onChange={() => onVoiceSelect(voice.name)}
                className="h-5 w-5 accent-[#2D5A27]"
              />

              {/* Name and locale */}
              <div className="flex-1">
                <span className="block text-[14px] font-medium text-slate-700">{voice.name}</span>
                <span className="block text-[11px] text-slate-400">
                  {voice.lang === 'es-ES' ? 'Español · España' : voice.lang === 'es-MX' ? 'Español · México' : voice.lang}
                </span>
              </div>

              {/* Preview play button */}
              <button
                type="button"
                aria-label={`Escuchar voz ${voice.name}`}
                disabled={!ttsEnabled}
                onClick={() => handlePreviewPlay(voice)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 transition-colors duration-150 hover:bg-[#2D5A27] hover:text-white disabled:opacity-40"
              >
                {playingVoiceName === voice.name ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {voices.length > 0 && (
        <p className="mb-4 text-center text-[11px] text-slate-400">
          Las voces disponibles dependen de tu dispositivo.
        </p>
      )}

      {/* TTS toggle */}
      <div className="flex items-center justify-between border-t border-slate-100 py-3 mt-2">
        <div>
          <label
            htmlFor="tts-toggle"
            className="block cursor-pointer text-[14px] font-medium text-slate-700"
          >
            Respuesta hablada
          </label>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Desactiva si usas un lector de pantalla
          </span>
        </div>
        <input
          id="tts-toggle"
          type="checkbox"
          role="checkbox"
          aria-label="Respuesta hablada"
          checked={ttsEnabled}
          onChange={(e) => onTtsToggle(e.target.checked)}
          className="h-5 w-9 cursor-pointer accent-[#2D5A27]"
        />
      </div>

      {/* Privacy link */}
      <a
        href="/privacidad#voz"
        target="_blank"
        rel="noopener"
        className="mt-3 block text-center text-[11px] text-slate-400 underline hover:text-slate-600"
      >
        Cómo procesamos tu voz →
      </a>
    </div>
  );
}
