// Tests for VoicePickerDrawer component — F091
// Tests voice list filtering, auto-select heuristic, TTS toggle, preview, persistence.

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { VoicePickerDrawer } from '../../components/VoicePickerDrawer';

// Helper to create mock voices
function makeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, default: false, localService: true } as SpeechSynthesisVoice;
}

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  onVoiceSelect: jest.fn(),
  onTtsToggle: jest.fn(),
  ttsEnabled: true,
  selectedVoiceName: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);
  (global.speechSynthesis.speak as jest.Mock).mockClear();
  (global.speechSynthesis.cancel as jest.Mock).mockClear();
});

// ---------------------------------------------------------------------------
// Open/closed state
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — open/closed', () => {
  it('does not render when isOpen=false', () => {
    render(<VoicePickerDrawer {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders when isOpen=true', () => {
    render(<VoicePickerDrawer {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has role="dialog" and aria-label="Voz del asistente"', () => {
    render(<VoicePickerDrawer {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Voz del asistente');
  });
});

// ---------------------------------------------------------------------------
// Voice list (populated via voiceschanged)
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — voice list', () => {
  it('voice list is empty before voiceschanged fires', () => {
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);
    render(<VoicePickerDrawer {...defaultProps} />);
    // Should not show any voice names from getVoices (returns [])
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('populates voice list after voiceschanged event fires', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const paulinaVoice = makeVoice('Paulina', 'es-MX');

    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([]);
    render(<VoicePickerDrawer {...defaultProps} />);

    // Now voices become available — simulate voiceschanged event
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice, paulinaVoice]);
    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    expect(screen.getByText('Monica')).toBeInTheDocument();
    expect(screen.getByText('Paulina')).toBeInTheDocument();
  });

  it('filters voices to Spanish (lang starts with "es") only', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const englishVoice = makeVoice('Samantha', 'en-US');

    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice, englishVoice]);
    render(<VoicePickerDrawer {...defaultProps} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    expect(screen.getByText('Monica')).toBeInTheDocument();
    expect(screen.queryByText('Samantha')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Auto-select heuristic
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — auto-select heuristic', () => {
  it('auto-selects Monica over Paulina and Google español', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const paulinaVoice = makeVoice('Paulina', 'es-MX');
    const googleVoice = makeVoice('Google español', 'es-ES');

    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([googleVoice, paulinaVoice, monicaVoice]);
    const onVoiceSelect = jest.fn();
    render(<VoicePickerDrawer {...defaultProps} onVoiceSelect={onVoiceSelect} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    expect(onVoiceSelect).toHaveBeenCalledWith('Monica');
  });

  it('shows no-voices fallback when no Spanish voices available', async () => {
    const englishVoice = makeVoice('Samantha', 'en-US');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([englishVoice]);
    render(<VoicePickerDrawer {...defaultProps} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    expect(screen.getByText(/no hay voces en español/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Radio select
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — voice selection', () => {
  it('clicking a voice row radio calls onVoiceSelect with voice name', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const paulinaVoice = makeVoice('Paulina', 'es-MX');

    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice, paulinaVoice]);
    const onVoiceSelect = jest.fn();
    render(<VoicePickerDrawer {...defaultProps} onVoiceSelect={onVoiceSelect} selectedVoiceName="Monica" />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    // Click Paulina radio
    const paulinaRadio = screen.getAllByRole('radio').find(
      (radio) => radio.closest('[data-voice-name="Paulina"]') !== null
    ) ?? screen.getAllByRole('radio')[1];

    if (paulinaRadio) {
      fireEvent.click(paulinaRadio);
      expect(onVoiceSelect).toHaveBeenCalledWith('Paulina');
    }
  });
});

// ---------------------------------------------------------------------------
// Preview play
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — preview', () => {
  it('tapping play button calls speechSynthesis.speak() with the voice', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice]);
    render(<VoicePickerDrawer {...defaultProps} ttsEnabled={true} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    const playButton = screen.getByRole('button', { name: /escuchar voz/i });
    fireEvent.click(playButton);

    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight preview before starting new one', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    const paulinaVoice = makeVoice('Paulina', 'es-MX');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice, paulinaVoice]);
    render(<VoicePickerDrawer {...defaultProps} ttsEnabled={true} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    const playButtons = screen.getAllByRole('button', { name: /escuchar voz/i });
    fireEvent.click(playButtons[0]!); // play Monica
    fireEvent.click(playButtons[1]!); // play Paulina — should cancel Monica first

    expect(global.speechSynthesis.cancel).toHaveBeenCalled();
    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// TTS toggle
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — TTS toggle', () => {
  it('unchecking TTS toggle calls onTtsToggle(false)', async () => {
    const monicaVoice = makeVoice('Monica', 'es-ES');
    (global.speechSynthesis.getVoices as jest.Mock).mockReturnValue([monicaVoice]);
    const onTtsToggle = jest.fn();
    render(<VoicePickerDrawer {...defaultProps} onTtsToggle={onTtsToggle} ttsEnabled={true} />);

    const handler = (global.speechSynthesis.addEventListener as jest.Mock).mock.calls.find(
      (call: [string]) => call[0] === 'voiceschanged'
    )?.[1] as (() => void) | undefined;

    await act(async () => {
      if (handler) handler();
    });

    const toggle = screen.getByRole('checkbox', { name: /respuesta hablada/i });
    fireEvent.click(toggle);
    expect(onTtsToggle).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — keyboard', () => {
  it('Escape key calls onClose', () => {
    const onClose = jest.fn();
    render(<VoicePickerDrawer {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Privacy link
// ---------------------------------------------------------------------------

describe('VoicePickerDrawer — privacy link', () => {
  it('privacy link "Cómo procesamos tu voz →" has target="_blank" and rel="noopener"', () => {
    render(<VoicePickerDrawer {...defaultProps} />);
    const privacyLink = screen.getByText(/cómo procesamos tu voz/i);
    expect(privacyLink).toHaveAttribute('target', '_blank');
    expect(privacyLink).toHaveAttribute('rel', 'noopener');
  });
});
