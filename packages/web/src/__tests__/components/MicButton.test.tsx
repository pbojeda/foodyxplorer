// MicButton tests — F091
// Tests tap/hold interaction, haptic timing, iOS SpeechSynthesis unlock,
// drag-cancel, budget-cap state, and aria attributes.
// Replaces the 4 placeholder tests from the stub.

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MicButton, _resetiOSSpeechUnlock } from '../../components/MicButton';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (global.speechSynthesis.speak as jest.Mock).mockClear();
  (global.navigator.vibrate as jest.Mock).mockClear();
  // Reset module-level iOS unlock guard between tests
  _resetiOSSpeechUnlock();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('MicButton — rendering', () => {
  it('renders enabled button with aria-label "Buscar por voz" in idle state', () => {
    const onTap = jest.fn();
    render(<MicButton state="idle" onTap={onTap} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-label', 'Buscar por voz');
  });

  it('renders disabled button when state="processing"', () => {
    render(<MicButton state="processing" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders size lg: button has w-20 h-20 classes', () => {
    render(<MicButton size="lg" state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('w-20');
    expect(button.className).toContain('h-20');
  });
});

// ---------------------------------------------------------------------------
// Tap vs hold gesture
// ---------------------------------------------------------------------------

describe('MicButton — tap vs hold', () => {
  it('pointerdown + pointerup < 200ms calls onTap, not onHoldStart', () => {
    const onTap = jest.fn();
    const onHoldStart = jest.fn();
    render(<MicButton state="idle" onTap={onTap} onHoldStart={onHoldStart} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');

    jest.setSystemTime(1000);
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });

    jest.setSystemTime(1100); // 100ms later — tap
    fireEvent.pointerUp(button, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('pointerdown held >= 200ms calls onHoldStart', async () => {
    const onTap = jest.fn();
    const onHoldStart = jest.fn();
    render(<MicButton state="idle" onTap={onTap} onHoldStart={onHoldStart} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');

    jest.setSystemTime(1000);
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(onHoldStart).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('pointerup after hold calls onHoldEnd(false) — no cancel', async () => {
    const onHoldEnd = jest.fn();
    render(<MicButton state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={onHoldEnd} />);
    const button = screen.getByRole('button');

    jest.setSystemTime(1000);
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    fireEvent.pointerUp(button, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(onHoldEnd).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Haptic hint
// ---------------------------------------------------------------------------

describe('MicButton — haptic', () => {
  it('calls navigator.vibrate(10) at ~180ms mark', async () => {
    render(<MicButton state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');

    jest.setSystemTime(1000);
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });

    // At 179ms — no haptic yet
    await act(async () => {
      jest.advanceTimersByTime(179);
    });
    expect(global.navigator.vibrate).not.toHaveBeenCalled();

    // At 180ms — haptic fires
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(global.navigator.vibrate).toHaveBeenCalledWith(10);
  });
});

// ---------------------------------------------------------------------------
// iOS SpeechSynthesis unlock
// ---------------------------------------------------------------------------

describe('MicButton — iOS SpeechSynthesis unlock', () => {
  it('calls speechSynthesis.speak() synchronously on first pointerdown', () => {
    render(<MicButton state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');

    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
    const utterance = (global.speechSynthesis.speak as jest.Mock).mock.calls[0][0];
    expect(utterance.text).toBe('');
  });

  it('speaks only once across multiple pointerdown events (guard)', () => {
    render(<MicButton state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={jest.fn()} />);
    const button = screen.getByRole('button');

    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 100, clientY: 100, pointerId: 1 });

    // unlock should only fire once per page session
    expect(global.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Drag-cancel
// ---------------------------------------------------------------------------

describe('MicButton — drag cancel', () => {
  it('Escape key during hold calls onHoldEnd(true) — cancel', async () => {
    // Tests the cancel path: per spec §3.3, Escape cancels hold-to-record on desktop.
    // Note: drag-cancel via pointer movement requires native PointerEvent.clientX support
    // which is not available in jsdom; keyboard cancel tests the same onHoldEnd(true) path.
    const onHoldEnd = jest.fn();
    render(<MicButton state="idle" onTap={jest.fn()} onHoldStart={jest.fn()} onHoldEnd={onHoldEnd} />);
    const button = screen.getByRole('button');

    jest.setSystemTime(1000);
    fireEvent.pointerDown(button, { pointerId: 1 });

    // Enter hold state
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    // Press Escape to cancel hold
    fireEvent.keyDown(button, { key: 'Escape' });

    expect(onHoldEnd).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// Budget cap state
// ---------------------------------------------------------------------------

describe('MicButton — budget cap', () => {
  it('renders VoiceBudgetBadge (amber dot) when budgetCapActive=true', () => {
    render(
      <MicButton
        state="idle"
        budgetCapActive
        onTap={jest.fn()}
        onHoldStart={jest.fn()}
        onHoldEnd={jest.fn()}
      />
    );
    // Budget badge should be present in DOM
    expect(document.querySelector('[data-testid="voice-budget-badge"]')).not.toBeNull();
  });

  it('sets aria-label reflecting the disabled state when budgetCapActive=true', () => {
    render(
      <MicButton
        state="idle"
        budgetCapActive
        onTap={jest.fn()}
        onHoldStart={jest.fn()}
        onHoldEnd={jest.fn()}
      />
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute(
      'aria-label',
      'Buscar por voz — temporalmente desactivada'
    );
  });
});

describe('MicButton — forwardRef (AC15 focus return)', () => {
  it('forwards the ref to the underlying button element', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <MicButton
        ref={ref}
        state="idle"
        onTap={jest.fn()}
        onHoldStart={jest.fn()}
        onHoldEnd={jest.fn()}
      />
    );
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('ref-focused button is the same element as getByRole("button")', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <MicButton
        ref={ref}
        state="idle"
        onTap={jest.fn()}
        onHoldStart={jest.fn()}
        onHoldEnd={jest.fn()}
      />
    );
    const byRole = screen.getByRole('button');
    expect(ref.current).toBe(byRole);
    ref.current?.focus();
    expect(document.activeElement).toBe(byRole);
  });
});
