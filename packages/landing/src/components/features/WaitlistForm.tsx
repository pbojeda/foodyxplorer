'use client';

import { useState, useRef } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { trackEvent, getUtmParams } from '@/lib/analytics';
import type { Variant } from '@/types';

const emailSchema = z.string().email('Introduce un email válido');

type WaitlistSource = 'hero' | 'cta' | 'footer';
type FormStatus = 'idle' | 'loading' | 'success' | 'error';

interface WaitlistFormProps {
  source: WaitlistSource;
  variant: Variant;
}

export function WaitlistForm({ source, variant }: WaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const startFiredRef = useRef(false);

  function getValidationError(): string | null {
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      return result.error.errors[0]?.message ?? 'Email inválido';
    }
    return null;
  }

  const validationError = touched ? getValidationError() : null;

  function handleFocus() {
    if (!startFiredRef.current) {
      startFiredRef.current = true;
      trackEvent({
        event: 'waitlist_submit_start',
        source,
        variant,
        lang: 'es',
        ...getUtmParams(),
      });
    }
  }

  function handleBlur() {
    setTouched(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);

    const validError = getValidationError();
    if (validError) {
      setErrorMessage(validError);
      return;
    }

    setStatus('loading');
    setErrorMessage(null);

    // Fire CTA analytics
    if (source === 'hero') {
      trackEvent({
        event: 'hero_cta_click',
        variant,
        lang: 'es',
        ...getUtmParams(),
      });
    } else {
      trackEvent({
        event: 'waitlist_cta_click',
        source,
        variant,
        lang: 'es',
        ...getUtmParams(),
      });
    }

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setStatus('success');
        trackEvent({
          event: 'waitlist_submit_success',
          variant,
          lang: 'es',
          ...getUtmParams(),
        });
      } else {
        let data: { error?: string } | undefined;
        try {
          data = await response.json();
        } catch { /* non-JSON response */ }
        setStatus('error');
        setErrorMessage(
          data?.error ?? 'Ha ocurrido un error. Inténtalo de nuevo.'
        );
        trackEvent({
          event: 'waitlist_submit_error',
          variant,
          lang: 'es',
          ...getUtmParams(),
        });
      }
    } catch {
      setStatus('error');
      setErrorMessage('Ha ocurrido un error. Inténtalo de nuevo.');
      trackEvent({
        event: 'waitlist_submit_error',
        variant,
        lang: 'es',
        ...getUtmParams(),
      });
    }
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 py-4"
      >
        <span className="text-emerald-500 text-2xl" aria-hidden="true">
          ✓
        </span>
        <p className="text-slate-700 font-medium">
          ¡Apuntado! Te avisamos en el lanzamiento.
        </p>
      </div>
    );
  }

  return (
    <form
      action="/api/waitlist"
      method="POST"
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3"
    >
      {/* Progressive enhancement: hidden variant input for no-JS form POST */}
      <input type="hidden" name="variant" value={variant} />

      <Input
        id={`waitlist-email-${source}`}
        label="Email"
        type="email"
        placeholder="tu@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        error={validationError ?? undefined}
        autoComplete="email"
        disabled={status === 'loading'}
      />

      {status === 'error' && errorMessage && (
        <p role="alert" className="text-sm text-red-500">
          {errorMessage}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        isLoading={status === 'loading'}
        disabled={status === 'loading'}
        className="w-full"
      >
        Únete a la waitlist
      </Button>

      <p className="text-xs text-slate-500 text-center">
        Sin spam. Solo lanzamiento y acceso temprano.
      </p>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {status === 'error' && errorMessage}
      </div>
    </form>
  );
}
