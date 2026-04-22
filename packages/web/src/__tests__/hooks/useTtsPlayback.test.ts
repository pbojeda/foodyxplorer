// Tests for useTtsPlayback hook — F091
// SpeechSynthesis is mocked in jest.setup.ts.

import { renderHook, act } from '@testing-library/react';
import { useTtsPlayback } from '@/hooks/useTtsPlayback';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();

  // Reset speechSynthesis mock to known state
  (global.speechSynthesis.speaking as boolean) = false;
  (global.speechSynthesis.speak as jest.Mock).mockClear();
  (global.speechSynthesis.cancel as jest.Mock).mockClear();
  (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Helper to create a mock SpeechSynthesisVoice
// ---------------------------------------------------------------------------

function makeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
  } as SpeechSynthesisVoice;
}

// ---------------------------------------------------------------------------
// TTS enabled / disabled
// ---------------------------------------------------------------------------

describe('useTtsPlayback — TTS toggle', () => {
  it('play() calls speechSynthesis.speak() when TTS is enabled (default)', () => {
    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Hola mundo');
    });

    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utterance = (global.speechSynthesis.speak as jest.Mock).mock.calls[0][0];
    expect(utterance.text).toBe('Hola mundo');
  });

  it('play() is a no-op when hablar_tts_enabled is "false"', () => {
    localStorage.setItem('hablar_tts_enabled', 'false');
    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Hola');
    });

    expect(global.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('play() is enabled when hablar_tts_enabled is "true"', () => {
    localStorage.setItem('hablar_tts_enabled', 'true');
    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Texto');
    });

    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------

describe('useTtsPlayback — cancel', () => {
  it('cancel() calls speechSynthesis.cancel()', () => {
    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.cancel();
    });

    expect(global.speechSynthesis.cancel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// isSpeaking
// ---------------------------------------------------------------------------

describe('useTtsPlayback — isSpeaking', () => {
  it('isSpeaking reflects speechSynthesis.speaking', () => {
    // Initially false
    const { result } = renderHook(() => useTtsPlayback());
    expect(result.current.isSpeaking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

describe('useTtsPlayback — voice selection', () => {
  it('uses stored voice from localStorage when available in getVoices()', () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const paulinaVoice = makeVoice('Paulina', 'es-ES');

    localStorage.setItem('hablar_voice', 'Paulina');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice, paulinaVoice]);

    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Hola');
    });

    const utterance = (global.speechSynthesis.speak as jest.Mock).mock.calls[0][0];
    expect(utterance.voice).toBe(paulinaVoice);
  });

  it('falls back to best heuristic when stored voice not in list', () => {
    const googleVoice = makeVoice('Google español', 'es-ES');
    const monicaVoice = makeVoice('Monica', 'es-ES');

    localStorage.setItem('hablar_voice', 'VoiceNotPresent');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([googleVoice, monicaVoice]);

    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Hola');
    });

    const utterance = (global.speechSynthesis.speak as jest.Mock).mock.calls[0][0];
    // Monica is higher priority in heuristic than Google español
    expect(utterance.voice).toBe(monicaVoice);
  });

  it('voice is null when no voices available', () => {
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);

    const { result } = renderHook(() => useTtsPlayback());

    act(() => {
      result.current.play('Hola');
    });

    const utterance = (global.speechSynthesis.speak as jest.Mock).mock.calls[0][0];
    expect(utterance.voice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// voiceschanged event
// ---------------------------------------------------------------------------

describe('useTtsPlayback — voiceschanged', () => {
  it('re-selects voice when voiceschanged fires', async () => {
    // Initially no voices
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);

    const { result } = renderHook(() => useTtsPlayback());

    // Initially no voice selected
    expect(result.current.selectedVoice).toBeNull();

    // Now voices become available
    const monicaVoice = makeVoice('Monica', 'es-ES');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice]);

    // Simulate voiceschanged event
    await act(async () => {
      const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
        (call: [string]) => call[0] === 'voiceschanged'
      )?.[1] as (() => void) | undefined;
      if (handler) handler();
    });

    expect(result.current.selectedVoice?.name).toBe('Monica');
  });
});
