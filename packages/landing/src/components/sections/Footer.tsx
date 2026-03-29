import type { Dictionary } from '@/lib/i18n';
import type { Variant } from '@/types';

interface FooterProps {
  dict: Dictionary['footer'];
  variant: Variant;
}

export function Footer({ dict, variant }: FooterProps) {
  return (
    <footer
      data-section="footer"
      className="bg-slate-950 pt-12 md:pt-16 pb-8 md:pb-12"
    >
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        {/* Top grid: brand + waitlist + links */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-12 pb-12 border-b border-white/10">
          {/* Brand column */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              {/* Simple leaf icon as logo mark */}
              <svg
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-brand-orange"
              >
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
              <span className="text-white font-bold text-lg tracking-tight">
                nutriXplorer
              </span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-[260px]">
              {dict.tagline}
            </p>

            {/* GitHub link */}
            <a
              href="https://github.com/FiveGuays/nutriXplorer"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub — nutriXplorer open source"
              className="inline-flex items-center gap-2 mt-5 text-sm text-slate-500 hover:text-slate-300 transition-colors duration-200"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.929.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              <span>GitHub</span>
            </a>
          </div>

          {/* Links column */}
          <div>
            <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-500 mb-4">
              Legal
            </p>
            <nav aria-label="Enlaces legales">
              <ul className="flex flex-col gap-3">
                <li>
                  <a
                    href="/privacidad"
                    className="text-sm text-slate-400 hover:text-white transition-colors duration-200 underline-offset-4 hover:underline"
                  >
                    {dict.links.privacy}
                  </a>
                </li>
                <li>
                  <a
                    href="/cookies"
                    className="text-sm text-slate-400 hover:text-white transition-colors duration-200 underline-offset-4 hover:underline"
                  >
                    {dict.links.cookies}
                  </a>
                </li>
                <li>
                  <a
                    href="/aviso-legal"
                    className="text-sm text-slate-400 hover:text-white transition-colors duration-200 underline-offset-4 hover:underline"
                  >
                    {dict.links.legal}
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          {/* Secondary column — removed WaitlistForm per S7 (max 2 forms: hero + WaitlistCTASection) */}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">
            {dict.copyright}
          </p>
          <p className="text-xs text-slate-600 flex items-center gap-1.5">
            <span>{dict.madeIn}</span>
            <span aria-label="Bandera de España" role="img">🇪🇸</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
