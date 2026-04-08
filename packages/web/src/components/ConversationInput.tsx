'use client';

// ConversationInput — fixed-bottom input bar for the /hablar shell.
// Handles: text input, Enter-to-submit, Shift+Enter newline, disabled during loading.

import { useRef, useEffect } from 'react';
import { SubmitButton } from './SubmitButton';
import { MicButton } from './MicButton';
import { PhotoButton } from './PhotoButton';

interface ConversationInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  inlineError: string | null;
}

export function ConversationInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  inlineError,
}: ConversationInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea up to 3 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24; // approx 1.5rem
    const maxHeight = lineHeight * 3 + 24; // 3 lines + padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSubmit();
      }
    }
  }

  const showSubmit = value.trim().length > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-sm">
      {inlineError && (
        <p role="alert" className="mb-1.5 text-sm text-red-600">
          {inlineError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="¿Qué quieres saber?"
          rows={1}
          className="flex-1 resize-none overflow-hidden rounded-2xl border border-slate-200 bg-paper px-4 py-3 text-base text-slate-700 placeholder:text-slate-400 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/15 disabled:opacity-60"
          style={{ minHeight: '48px' }}
          aria-label="Escribe tu consulta"
        />
        <PhotoButton />
        <MicButton />
        {showSubmit && (
          <SubmitButton onSubmit={onSubmit} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}
