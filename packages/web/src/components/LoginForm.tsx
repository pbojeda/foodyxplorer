'use client';

// LoginForm — F107a (ADR-025 R3 §6)
// Email magic link login form.
// NO Google button — deferred to F107a-FU1.
// Handles ?error=callback_failed and ?error=auth_required query params.

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export function LoginForm() {
  const searchParams = useSearchParams();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const urlError = searchParams.get('error');

  function getUrlErrorMessage(): string | null {
    if (urlError === 'callback_failed') {
      return 'El enlace de acceso ha expirado o ha sido cancelado. Solicita uno nuevo.';
    }
    if (urlError === 'auth_required') {
      return 'Inicia sesión para continuar.';
    }
    return null;
  }

  const urlErrorMessage = getUrlErrorMessage();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : '/auth/callback';

    try {
      await signIn('email', { email: email.trim(), redirectTo });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'No se pudo enviar el enlace. Inténtalo de nuevo.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-bold text-brand-green">nutriXplorer</h1>

        {submitted ? (
          /* AC18 — success state */
          <div role="status" className="text-center">
            <p className="text-base font-medium text-botanical">
              Revisa tu correo — te hemos enviado un enlace de acceso.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Puede tardar unos segundos en llegar.
            </p>
          </div>
        ) : (
          /* Login form */
          <form onSubmit={handleSubmit} noValidate>
            {/* URL error messages — AC22 */}
            {urlErrorMessage && (
              <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {urlErrorMessage}
              </div>
            )}

            {/* Submit error */}
            {submitError && (
              <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {submitError}
              </div>
            )}

            <div className="mb-4">
              <label
                htmlFor="login-email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Enviando...' : 'Entrar con email'}
            </button>

            {/* F107a-FU1: Google OAuth button goes here */}
          </form>
        )}
      </div>
    </main>
  );
}
