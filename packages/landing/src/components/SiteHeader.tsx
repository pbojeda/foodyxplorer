import Link from 'next/link';
import { MobileMenu } from '@/components/MobileMenu';

const NAV_LINKS = [
  { label: 'Demo', href: '#demo' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'FAQ', href: '#faq' },
];

const WAITLIST_CTA = 'Probar gratis';
const MOBILE_CTA_TEXT = 'Probar';

/**
 * Sticky top navigation header.
 * Server Component — no interactivity needed.
 * MobileMenu is a separate Client Component for the hamburger toggle.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-paper/78 backdrop-blur-xl">
      <div className="section-shell flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-slate-950"
          aria-label="nutriXplorer"
        >
          nutri<span className="text-botanical">Xplorer</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Navegación principal">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="#waitlist"
            className="rounded-full bg-botanical px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.02]"
          >
            {WAITLIST_CTA}
          </a>
        </div>

        {/* Mobile hamburger menu — Client Component */}
        <MobileMenu navLinks={NAV_LINKS} ctaText={WAITLIST_CTA} mobileCta={MOBILE_CTA_TEXT} />
      </div>
    </header>
  );
}
