'use client';

import { useState, useRef } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { trackEvent, getUtmParams } from '@/lib/analytics';
import type { Variant } from '@/types';

const emailSchema = z.string().email('Introduce un email válido');

/**
 * Phone validation:
 * - Optional — empty string passes
 * - Format: +[country_code] [digits] e.g. +34 612345678 or +1 2125550100
 * - Regex: starts with +, 1-3 digit country code, optional space, 6-12 digits
 */
const phoneSchema = z
  .string()
  .optional()
  .refine(
    (val) => {
      if (!val || val.trim() === '') return true; // optional
      // Strip all spaces from the value for digit-count validation
      // Accept: +34612345678, +34 612345678, +34 612 345 678, +1 2125550100
      const stripped = val.replace(/\s/g, '');
      return /^\+\d{7,15}$/.test(stripped);
    },
    { message: 'Introduce un teléfono válido (ej: +34 612 345 678)' }
  );

type WaitlistSource = 'hero' | 'cta' | 'footer' | 'post-simulator';
type FormStatus = 'idle' | 'loading' | 'success' | 'error';

interface WaitlistFormProps {
  source: WaitlistSource;
  variant: Variant;
  /** When true, shows the phone field. Default: false. Phone is only shown in the final WaitlistCTA section. */
  showPhone?: boolean;
}

export function WaitlistForm({ source, variant, showPhone = false }: WaitlistFormProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const startFiredRef = useRef(false);

  function getEmailError(): string | null {
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      return result.error.errors[0]?.message ?? 'Email inválido';
    }
    return null;
  }

  function getPhoneError(): string | null {
    if (!phone.trim()) return null; // phone is optional
    const result = phoneSchema.safeParse(phone.trim());
    if (!result.success) {
      return result.error.errors[0]?.message ?? 'Teléfono inválido';
    }
    return null;
  }

  const emailError = touched ? getEmailError() : null;
  const phoneError = phoneTouched ? getPhoneError() : null;

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
    if (status === 'loading') return;
    setTouched(true);
    setPhoneTouched(true);

    const emailErr = getEmailError();
    const phoneErr = getPhoneError();

    if (emailErr || phoneErr) {
      setErrorMessage(emailErr ?? phoneErr ?? 'Revisa los campos del formulario.');
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
        body: JSON.stringify({ email, ...(phone.trim() ? { phone: phone.trim() } : {}), variant, source }),
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
        } catch {
          /* non-JSON response */
        }
        setStatus('error');
        setErrorMessage(data?.error ?? 'Ha ocurrido un error. Inténtalo de nuevo.');
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
      <div role="status" aria-live="polite" className="flex items-center gap-3 py-4">
        <span className="text-2xl text-emerald-500" aria-hidden="true">
          ✓
        </span>
        <p className="font-medium text-slate-700">¡Apuntado! Te avisamos en el lanzamiento.</p>
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
        error={emailError ?? undefined}
        autoComplete="email"
        disabled={status === 'loading'}
      />

      {/* Phone field — optional, only shown when showPhone=true */}
      {showPhone && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`waitlist-phone-${source}`}
            className="text-sm font-medium text-slate-700"
          >
            Teléfono <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            id={`waitlist-phone-${source}`}
            type="tel"
            placeholder="Tu teléfono (opcional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setPhoneTouched(true)}
            autoComplete="tel"
            disabled={status === 'loading'}
            aria-describedby={`waitlist-phone-help-${source}`}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition placeholder:text-slate-400 focus:border-botanical focus:ring-4 focus:ring-green-100 disabled:opacity-60"
          />
          {phoneError && (
            <p role="alert" className="text-sm text-red-500">
              {phoneError}
            </p>
          )}
          <p id={`waitlist-phone-help-${source}`} className="text-xs text-slate-400">
            Formato: +34 612 345 678 (opcional)
          </p>
        </div>
      )}

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

      <p className="text-center text-xs text-slate-500">
        Sin spam. Solo lanzamiento y acceso temprano.
      </p>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {status === 'error' && errorMessage}
      </div>
    </form>
  );
}
