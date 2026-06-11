'use client';

// AdminLayout — F-ADMIN-ANALYTICS-UI.
// Sidebar (desktop, ≥1024px) + TopBar (tablet/phone, <1024px).
// Design spec: W27 (sidebar), W36 (responsive strategy).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/useT';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT('admin');
  const isAnalyticsActive = pathname?.startsWith('/admin/analytics') ?? false;

  return (
    <div className="flex h-[100dvh]">
      {/* Sidebar — desktop only (hidden on <lg) */}
      <aside className="hidden lg:flex lg:flex-col w-56 flex-shrink-0 bg-white border-r border-slate-100">
        {/* Logo / wordmark */}
        <div className="px-3 pb-5 pt-6 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-500 tracking-wide uppercase">
            {t('layout.brandName')}{' '}
            <span className="text-slate-400">{t('layout.adminSuffix')}</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="pt-3 px-3" aria-label="Admin navigation">
          <Link
            href="/admin/analytics"
            className={
              isAnalyticsActive
                ? 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold bg-mist text-brand-green'
                : 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors duration-150'
            }
            aria-current={isAnalyticsActive ? 'page' : undefined}
          >
            {/* 18px chart-bar SVG icon (stroke 1.5px) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="18" y="3" width="4" height="18" rx="1" />
              <rect x="10" y="8" width="4" height="13" rx="1" />
              <rect x="2" y="13" width="4" height="8" rx="1" />
            </svg>
            {t('layout.navAnalytics')}
          </Link>
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* TopBar — tablet and phone only (<lg) */}
        <header className="lg:hidden h-10 bg-white border-b border-slate-100 flex items-center justify-between px-4 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-500">
            {t('layout.brandName')}{' '}
            <span className="text-slate-400">{t('layout.adminSuffix')}</span>
          </span>
          <span className="text-sm text-slate-600">{t('layout.navAnalytics')}</span>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <div className="max-w-7xl mx-auto px-6 py-8 md:px-4 md:py-6 sm:px-3 sm:py-4">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
