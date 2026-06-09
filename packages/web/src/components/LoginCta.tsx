'use client';

// LoginCta — F-WEB-TIER (AC17–AC21)
// Compact "Iniciar sesión" ghost button rendered in the HablarShell header
// when the user is logged out and auth has resolved (authLoading === false).
//
// Fires login_cta_shown on mount (once per session).
// Fires login_cta_clicked on click, then navigates to /login.
// Returns null while authLoading or when user is non-null.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/metrics';

export function LoginCta(): JSX.Element | null {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Don't render while auth is resolving or if user is already logged in
  const shouldRender = !authLoading && !user;

  useEffect(() => {
    if (!shouldRender) return;
    trackEvent('login_cta_shown');
  }, [shouldRender]);

  if (!shouldRender) return null;

  function handleClick() {
    trackEvent('login_cta_clicked');
    router.push('/login');
  }

  return (
    <button
      type="button"
      aria-label="Iniciar sesión o registrarse"
      onClick={handleClick}
      className="ml-auto h-8 px-3 py-1 text-sm font-medium text-brand-green rounded-lg transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
    >
      Iniciar sesión
    </button>
  );
}
