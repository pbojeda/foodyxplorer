'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

interface NavLink {
  label: string;
  href: string;
}

interface MobileMenuProps {
  navLinks: NavLink[];
  ctaText: string;
  mobileCta: string;
}

/**
 * MobileMenu — Client Component.
 * Hamburger toggle with dropdown panel for mobile navigation.
 * Extracted from SiteHeader so SiteHeader can remain a Server Component.
 *
 * Accessibility:
 * - aria-expanded on hamburger button
 * - aria-controls linking button to panel
 * - Closes on: link click, outside click, Escape key
 */
export function MobileMenu({ navLinks, ctaText: _ctaText, mobileCta }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const PANEL_ID = 'mobile-menu-panel';

  const close = useCallback(() => setIsOpen(false), []);

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [close]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  return (
    <div ref={containerRef} className="md:hidden">
      {/* Hamburger button */}
      <button
        type="button"
        aria-label="Abrir menú"
        aria-expanded={isOpen}
        aria-controls={PANEL_ID}
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isOpen ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Dropdown panel */}
      <div
        id={PANEL_ID}
        role="navigation"
        aria-label="Menú móvil"
        className={`${isOpen ? 'block' : 'hidden'} absolute left-0 right-0 top-16 z-50 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-lg backdrop-blur-xl`}
      >
        <nav className="flex flex-col gap-1">
          {navLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={close}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <a
            href="#waitlist"
            onClick={close}
            className="block rounded-full bg-botanical px-4 py-2 text-center text-sm font-semibold text-white transition hover:scale-[1.02]"
          >
            {mobileCta}
          </a>
        </div>
      </div>
    </div>
  );
}
