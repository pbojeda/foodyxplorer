'use client';

// AdminGuard — F-ADMIN-ANALYTICS-UI.
// 5-branch auth gate per ticket spec.
// Design spec: W27 (loading spinner), W35 (403 page treatments).
//
// Branches (per AC6–AC9 + W35):
//   1. loading        → full-page spinner
//   2. !user          → router.replace('/login?redirectTo=...')
//   3a. !account + NOT_PROVISIONED → amber 403 (recoverable; hint to call /me)
//   3b. !account + other/null       → slate 403 (verifyFailed; transient error)
//   4. account.tier !== 'admin'     → red 403 (forbidden; permanent for this session)
//   5. admin                        → <AdminLayout>{children}</AdminLayout>

import { useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n/useT';
import { trackEvent } from '@/lib/metrics';
import { AdminLayout } from './AdminLayout';

// ---------------------------------------------------------------------------
// LoadingPage sub-component (Branch 1)
// ---------------------------------------------------------------------------

function LoadingPage({ t }: { t: (key: string) => string }) {
  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div
          className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-brand-green animate-spin"
          role="status"
          aria-label="Loading"
        />
        <p className="text-sm text-slate-400 mt-3">{t('layout.loading')}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ForbiddenPage sub-component (Branches 3a, 3b, 4)
// ---------------------------------------------------------------------------

type ForbiddenVariant = 'notProvisioned' | 'verifyFailed' | 'forbidden';

function ForbiddenPage({
  variant,
  t,
  onAction,
}: {
  variant: ForbiddenVariant;
  t: (key: string) => string;
  onAction: () => void;
}) {
  const cardBorderClass =
    variant === 'notProvisioned'
      ? 'border-amber-200'
      : variant === 'forbidden'
      ? 'border-red-200'
      : 'border-slate-200';

  const iconColorClass =
    variant === 'notProvisioned'
      ? 'text-amber-400'
      : variant === 'forbidden'
      ? 'text-red-400'
      : 'text-slate-400';

  const titleKey =
    variant === 'notProvisioned'
      ? 'layout.403.notProvisioned.title'
      : variant === 'forbidden'
      ? 'layout.403.forbidden.title'
      : 'layout.403.verifyFailed.title';

  const bodyKey =
    variant === 'notProvisioned'
      ? 'layout.403.notProvisioned.body'
      : variant === 'forbidden'
      ? 'layout.403.forbidden.body'
      : 'layout.403.verifyFailed.body';

  const ctaKey =
    variant === 'notProvisioned'
      ? 'layout.403.notProvisioned.cta'
      : variant === 'forbidden'
      ? 'layout.403.forbidden.cta'
      : 'layout.403.verifyFailed.cta';

  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center p-6">
      <div className={`max-w-sm w-full bg-white rounded-2xl border ${cardBorderClass} p-8 text-center shadow-sm`}>
        {/* Icon */}
        <div className={`flex justify-center mb-4 ${iconColorClass}`}>
          {variant === 'notProvisioned' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : variant === 'forbidden' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 19H3a2 2 0 01-2-2V9a2 2 0 012-2h1" />
              <path d="M10.05 6.575A11.1 11.1 0 0112 6.5c5 0 9 3 9 6.5a9.23 9.23 0 01-.87 1.85M9 18h5" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold mb-2">{t(titleKey)}</h1>

        {/* Body */}
        <p className="text-sm text-slate-500 leading-relaxed mb-1">{t(bodyKey)}</p>

        {/* Hint (NOT_PROVISIONED only) */}
        {variant === 'notProvisioned' && (
          <p className="text-xs font-mono bg-amber-50 text-amber-700 rounded px-2 py-1 inline-block mt-2 mb-4">
            {t('layout.403.notProvisioned.hint')}
          </p>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={onAction}
          className={
            variant === 'notProvisioned'
              ? 'mt-5 w-full rounded-xl px-4 py-2 text-sm font-medium bg-brand-orange text-white hover:opacity-90 transition-opacity'
              : 'mt-5 w-full rounded-xl px-4 py-2 text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors'
          }
        >
          {t(ctaKey)}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminGuard
// ---------------------------------------------------------------------------

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, account, loading, accountErrorCode } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT('admin');

  // Compute the forbidden variant once — avoids trackEvent in render phase (I1).
  const forbiddenVariant = useMemo<'notProvisioned' | 'verifyFailed' | 'forbidden' | null>(() => {
    if (loading) return null;
    if (!user) return null; // anon goes to redirect, not 403
    if (!account && accountErrorCode === 'NOT_PROVISIONED') return 'notProvisioned';
    if (!account) return 'verifyFailed';
    if (account.tier !== 'admin') return 'forbidden';
    return null;
  }, [loading, user, account, accountErrorCode]);

  // Branch 2: Not authenticated — redirect
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirectTo=' + encodeURIComponent(pathname ?? '/admin/analytics'));
    }
  }, [loading, user, router, pathname]);

  // Fire trackEvent exactly once per forbidden-variant transition (not on re-render).
  useEffect(() => {
    if (forbiddenVariant === 'notProvisioned') {
      trackEvent('admin_403_shown', { code403: 'NOT_PROVISIONED' });
    } else if (forbiddenVariant === 'verifyFailed') {
      trackEvent('admin_403_shown', { code403: 'VERIFY_FAILED' });
    } else if (forbiddenVariant === 'forbidden') {
      trackEvent('admin_403_shown', { code403: 'FORBIDDEN' });
    }
  }, [forbiddenVariant]);

  // Branch 1: Auth resolving
  if (loading) {
    return <LoadingPage t={t} />;
  }

  // Branch 2: Not authenticated (handled by useEffect above; render null here)
  if (!user) {
    return null;
  }

  // Branches 3a, 3b, 4: Forbidden variants (trackEvent handled by useEffect above)
  if (forbiddenVariant === 'notProvisioned') {
    return (
      <ForbiddenPage
        variant="notProvisioned"
        t={t}
        onAction={() => router.refresh()}
      />
    );
  }

  if (forbiddenVariant === 'verifyFailed') {
    return (
      <ForbiddenPage
        variant="verifyFailed"
        t={t}
        onAction={() => router.refresh()}
      />
    );
  }

  if (forbiddenVariant === 'forbidden') {
    return (
      <ForbiddenPage
        variant="forbidden"
        t={t}
        onAction={() => router.back()}
      />
    );
  }

  // Branch 5: Admin — render layout + children
  return <AdminLayout>{children}</AdminLayout>;
}
