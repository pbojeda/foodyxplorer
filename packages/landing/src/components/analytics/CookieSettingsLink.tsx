'use client';

import { CONSENT_KEY } from './CookieBanner';
import { deleteGaCookies } from '@/lib/deleteGaCookies';

interface CookieSettingsLinkProps {
  label: string;
  className?: string;
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* silent fail — Safari private mode */
  }
}

export function CookieSettingsLink({ label, className }: CookieSettingsLinkProps) {
  function handleClick() {
    safeRemoveItem(CONSENT_KEY);
    deleteGaCookies();
    window.location.reload();
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {label}
    </button>
  );
}
