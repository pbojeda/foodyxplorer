'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import type { Variant } from '@/types';
import { VARIANT_COOKIE_NAME, VARIANT_COOKIE_MAX_AGE } from '@/lib/ab-testing';

const CONSENT_KEY = 'nx-cookie-consent';
const GA_ID = process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'] ?? '';

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* silent fail — Safari private mode or storage full */
  }
}

type ConsentStatus = 'accepted' | 'rejected' | null;

interface CookieBannerProps {
  variant: Variant;
}

export function CookieBanner({ variant }: CookieBannerProps) {
  const [consent, setConsent] = useState<ConsentStatus>(null);
  const [loadGA, setLoadGA] = useState(false);

  useEffect(() => {
    const stored = safeGetItem(CONSENT_KEY) as ConsentStatus | null;
    if (stored === 'accepted' || stored === 'rejected') {
      setConsent(stored);
      if (stored === 'accepted') setLoadGA(true);
    }
  }, []);

  function handleAccept() {
    safeSetItem(CONSENT_KEY, 'accepted');
    document.cookie = `${VARIANT_COOKIE_NAME}=${variant}; max-age=${VARIANT_COOKIE_MAX_AGE}; path=/; samesite=lax`;
    setConsent('accepted');
    setLoadGA(true);
  }

  function handleReject() {
    safeSetItem(CONSENT_KEY, 'rejected');
    setConsent('rejected');
  }

  // Show banner only when consent has not yet been given
  if (consent !== null) {
    return loadGA && GA_ID.length > 0 ? (
      <Script
        id="ga4-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
        onLoad={() => {
          window.dataLayer = window.dataLayer || [];
          window.gtag = function (...args: unknown[]) {
            window.dataLayer.push(args);
          };
          window.gtag('js', new Date());
          window.gtag('config', GA_ID);
        }}
      />
    ) : null;
  }

  return (
    <>
      <section
        role="region"
        aria-label="Política de cookies"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-layered px-4 py-4 md:px-8 md:py-5"
      >
        <div className="max-w-container mx-auto flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-slate-700 leading-relaxed">
            Usamos cookies para analytics y para recordar tu preferencia de
            versión (A/B). Puedes aceptar o rechazar.{' '}
            <a
              href="/cookies"
              className="underline underline-offset-4 text-brand-green hover:text-brand-green/80"
            >
              Más información
            </a>
            .
          </p>
          <div className="flex gap-3 shrink-0">
            <button
              onClick={handleReject}
              className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Rechazar
            </button>
            <button
              onClick={handleAccept}
              className="px-4 py-2 text-sm font-semibold bg-brand-green text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Aceptar
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
