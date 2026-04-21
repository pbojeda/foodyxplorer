'use client';

// MicButton — interactive mic button for F091 voice input.
//
// Dual interaction model:
//   - Tap (< 200ms): calls onTap → opens VoiceOverlay
//   - Hold (>= 200ms): calls onHoldStart → inline hold-to-record
//
// iOS SpeechSynthesis unlock: speechSynthesis.speak('') called synchronously
// on first pointerdown (module-level guard — survives re-renders).
//
// Hold-to-record: haptic at 180ms, hold state at 200ms.
// Cancel zone: pointer moves > 80px left during hold → onHoldEnd(true).

import React, { useRef, useCallback } from 'react';
import type { VoiceState } from '@/types/voice';
import { VoiceBudgetBadge } from './VoiceBudgetBadge';

// ---------------------------------------------------------------------------
// Module-level iOS SpeechSynthesis unlock guard
// Must survive React component re-renders within the page session.
// ---------------------------------------------------------------------------

let iOSSpeechUnlocked = false;

function unlockiOSSpeech(): void {
  if (iOSSpeechUnlocked) return;
  if (typeof speechSynthesis === 'undefined') return;
  iOSSpeechUnlocked = true;
  const utterance = new SpeechSynthesisUtterance('');
  speechSynthesis.speak(utterance);
}

// Export for testing (allows reset between tests)
export function _resetiOSSpeechUnlock() {
  iOSSpeechUnlocked = false;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MicButtonProps {
  onTap?: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: (cancelled: boolean) => void;
  state?: VoiceState | 'idle' | 'processing' | 'recording';
  budgetCapActive?: boolean;
  size?: 'md' | 'lg';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noopBool = (_cancelled: boolean) => {};

export function MicButton({
  onTap = noop,
  onHoldStart = noop,
  onHoldEnd = noopBool,
  state = 'idle',
  budgetCapActive = false,
  size = 'md',
}: MicButtonProps) {
  const pressStartTimeRef = useRef<number>(0);
  const pressStartXRef = useRef<number>(0);
  const lastXRef = useRef<number>(0);
  const accumulatedDeltaXRef = useRef<number>(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hapticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldRef = useRef(false);
  const isDownRef = useRef(false);

  const isDisabled = state === 'processing' || state === 'uploading';

  const sizeClasses = size === 'lg'
    ? 'w-20 h-20'
    : 'w-12 h-12';

  function clearTimers() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (hapticTimerRef.current) clearTimeout(hapticTimerRef.current);
    holdTimerRef.current = null;
    hapticTimerRef.current = null;
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (isDisabled) return;

      // iOS SpeechSynthesis unlock — must be synchronous in gesture handler
      unlockiOSSpeech();

      isDownRef.current = true;
      isHoldRef.current = false;
      pressStartTimeRef.current = Date.now();
      pressStartXRef.current = e.clientX;
      lastXRef.current = e.clientX;
      accumulatedDeltaXRef.current = 0;

      // Haptic hint at 180ms
      hapticTimerRef.current = setTimeout(() => {
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      }, 180);

      // Hold threshold at 200ms
      holdTimerRef.current = setTimeout(() => {
        if (isDownRef.current) {
          isHoldRef.current = true;
          onHoldStart();
        }
      }, 200);

      // Capture pointer to receive events outside the button (not available in all envs)
      try {
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
      } catch {
        // Silently ignore — jsdom test environment may not support setPointerCapture
      }
    },
    [isDisabled, onHoldStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDownRef.current) return;
      const prevX = lastXRef.current;
      const moveDelta = e.clientX - prevX;
      lastXRef.current = e.clientX;
      // Accumulate leftward movement (only negative deltas count for cancel detection)
      if (moveDelta < 0) {
        accumulatedDeltaXRef.current += moveDelta;
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDownRef.current) return;
      isDownRef.current = false;
      clearTimers();

      const accumulated = accumulatedDeltaXRef.current;
      // Cancel if accumulated leftward movement > 80px
      // (accumulated is negative, compare < -80)
      const cancelled = isHoldRef.current && accumulated < -80;

      if (isHoldRef.current) {
        // Was in hold mode
        onHoldEnd(cancelled);
      } else {
        // Was a tap (< 200ms)
        onTap();
      }

      isHoldRef.current = false;
    },
    [onTap, onHoldEnd],
  );

  const handlePointerLeave = useCallback(
    (_e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDownRef.current) return;
      // Cancel if accumulated leftward movement > 80px
      const accumulated = accumulatedDeltaXRef.current;
      if (isHoldRef.current && accumulated < -80) {
        isDownRef.current = false;
        clearTimers();
        onHoldEnd(true);
        isHoldRef.current = false;
      }
    },
    [onHoldEnd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape' && isHoldRef.current && isDownRef.current) {
        // Cancel hold-to-record via keyboard (per spec §3.3)
        isDownRef.current = false;
        clearTimers();
        onHoldEnd(true);
        isHoldRef.current = false;
      }
    },
    [onHoldEnd],
  );

  const baseClasses = [
    'relative flex flex-shrink-0 items-center justify-center rounded-full',
    'transition-colors duration-150 focus:outline-none focus-visible:ring-2',
    'focus-visible:ring-brand-green focus-visible:ring-offset-2',
    sizeClasses,
    isDisabled
      ? 'cursor-not-allowed bg-slate-300 text-slate-400 opacity-60'
      : 'cursor-pointer bg-brand-green text-white shadow-md hover:bg-[#245220] active:bg-[#1C4019]',
    state === 'recording' || state === 'listening'
      ? 'scale-110 shadow-lg'
      : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-label="Buscar por voz"
      aria-description={budgetCapActive ? 'Búsqueda por voz temporalmente desactivada' : undefined}
      className={baseClasses}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      {/* Microphone SVG */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
        />
      </svg>

      {/* Budget cap badge */}
      {budgetCapActive && <VoiceBudgetBadge />}
    </button>
  );
}
