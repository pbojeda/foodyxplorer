// Tests for VoiceOverlay component — F091
// Tests state rendering, focus trap, aria-live, pre-permission gate, error toasts.

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { VoiceOverlay } from '../../components/VoiceOverlay';
import type { VoiceState, VoiceErrorCode } from '../../types/voice';

const defaultProps = {
  isOpen: true,
  voiceState: 'idle' as VoiceState,
  onClose: jest.fn(),
  onStartRecording: jest.fn(),
  onStopRecording: jest.fn(),
  errorCode: null as VoiceErrorCode | null,
};

// Reset localStorage before each test
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Open/closed
// ---------------------------------------------------------------------------

describe('VoiceOverlay — open/closed', () => {
  it('does not render when isOpen=false', () => {
    render(<VoiceOverlay {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders with role="dialog" aria-modal="true" when isOpen=true', () => {
    render(<VoiceOverlay {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('dialog has aria-live="polite"', () => {
    render(<VoiceOverlay {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-live', 'polite');
  });
});

// ---------------------------------------------------------------------------
// State text
// ---------------------------------------------------------------------------

describe('VoiceOverlay — state text', () => {
  it('shows "Habla ahora" in listening state', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} voiceState="listening" />);
    expect(screen.getByText('Habla ahora')).toBeInTheDocument();
  });

  it('shows "Procesando..." in processing state', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} voiceState="processing" />);
    expect(screen.getByText('Procesando...')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pre-permission screen
// ---------------------------------------------------------------------------

describe('VoiceOverlay — pre-permission screen', () => {
  it('shows pre-permission screen when hablar_mic_consented is absent', () => {
    // localStorage is clear (no consent flag)
    render(<VoiceOverlay {...defaultProps} />);
    expect(screen.getByText('¿Podemos escucharte?')).toBeInTheDocument();
  });

  it('hides pre-permission screen when hablar_mic_consented is set', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} />);
    expect(screen.queryByText('¿Podemos escucharte?')).not.toBeInTheDocument();
  });

  it('pre-permission "Cancelar" button calls onClose', () => {
    const onClose = jest.fn();
    render(<VoiceOverlay {...defaultProps} onClose={onClose} />);
    const cancelBtn = screen.getByText('Cancelar');
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pre-permission "Permitir micrófono" sets localStorage and hides the screen', async () => {
    render(<VoiceOverlay {...defaultProps} />);
    const allowBtn = screen.getByText('Permitir micrófono');
    fireEvent.click(allowBtn);
    expect(localStorage.getItem('hablar_mic_consented')).toBe('shown');
    // Pre-permission screen should be gone after consent
    await waitFor(() => {
      expect(screen.queryByText('¿Podemos escucharte?')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Error toast
// ---------------------------------------------------------------------------

describe('VoiceOverlay — error toast', () => {
  it('renders element with role="alert" when errorCode="mic_permission"', () => {
    render(<VoiceOverlay {...defaultProps} errorCode="mic_permission" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('mic_permission error shows correct copy', () => {
    render(<VoiceOverlay {...defaultProps} errorCode="mic_permission" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/permiso.*micrófono|micrófono.*bloqueado/i);
  });

  it('empty_transcription error shows correct copy', () => {
    render(<VoiceOverlay {...defaultProps} errorCode="empty_transcription" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no detectamos.*voz|ninguna voz/i);
  });

  it('auto-dismisses mic_permission toast after 3s (fake timers)', async () => {
    jest.useFakeTimers();
    render(<VoiceOverlay {...defaultProps} errorCode="mic_permission" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    // After dismissal, error toast should be gone (but only if onClose or error clears)
    // The toast auto-dismisses — check it's no longer visible
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }, { timeout: 500 });
  });
});

// ---------------------------------------------------------------------------
// Voice settings pill
// ---------------------------------------------------------------------------

describe('VoiceOverlay — voice settings pill', () => {
  it('voice settings pill is visible in idle state (when consented)', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} voiceState="idle" />);
    expect(screen.getByRole('button', { name: /cambiar voz/i })).toBeInTheDocument();
  });

  it('voice settings pill is hidden in listening state', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} voiceState="listening" />);
    expect(screen.queryByRole('button', { name: /cambiar voz/i })).not.toBeInTheDocument();
  });

  it('voice settings pill is hidden in processing state', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} voiceState="processing" />);
    expect(screen.queryByRole('button', { name: /cambiar voz/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dismiss button
// ---------------------------------------------------------------------------

describe('VoiceOverlay — dismiss button', () => {
  it('Escape key calls onClose', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    const onClose = jest.fn();
    render(<VoiceOverlay {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismiss button has data-initial-focus attribute', () => {
    localStorage.setItem('hablar_mic_consented', 'shown');
    render(<VoiceOverlay {...defaultProps} />);
    const dismissBtn = screen.getByRole('button', { name: /cerrar/i });
    expect(dismissBtn).toHaveAttribute('data-initial-focus');
  });
});
