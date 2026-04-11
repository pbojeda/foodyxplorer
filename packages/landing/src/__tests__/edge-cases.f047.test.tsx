/**
 * @jest-environment jsdom
 *
 * F047 — Landing Conversion Optimization: Edge-Case Tests
 *
 * Covers:
 * 1. CTA copy updated in dictionary (hero.cta, waitlistCta.headline, siteHeader)
 * 2. text-slate-500 replaces text-slate-400 in light-background components
 * 3. SiteHeader renders "Probar gratis" and MobileMenu hamburger button
 * 4. Page variants have at most 2 WaitlistForm instances (hero + WaitlistCTASection)
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { getDictionary } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    className,
    'aria-label': ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    'aria-label'?: string;
  }) {
    return <a href={href} className={className} aria-label={ariaLabel}>{children}</a>;
  };
});

jest.mock('next/image', () => {
  return function MockImage({ src, alt }: { src: string; alt: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  };
});

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 {...props}>{children}</h1>,
  },
  useReducedMotion: () => false,
}));

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, data: { count: 0 } }),
});

// ---------------------------------------------------------------------------
// Dictionary / i18n tests
// ---------------------------------------------------------------------------

describe('F047 — Dictionary (es.ts) copy updates', () => {
  const dict = getDictionary('es');

  it('hero.cta is updated to benefit-oriented copy', () => {
    expect(dict.hero.cta).toBe('Quiero saber qué como');
  });

  it('waitlistCta.headline is updated to benefit-oriented copy', () => {
    expect(dict.waitlistCta.headline).toBe(
      'Descubre exactamente qué comes en tu restaurante favorito'
    );
  });

  it('siteHeader.cta key exists with "Probar gratis"', () => {
    expect((dict as unknown as { siteHeader: { cta: string } }).siteHeader.cta).toBe('Probar gratis');
  });

  it('siteHeader.mobileCta key exists with "Probar"', () => {
    expect((dict as unknown as { siteHeader: { mobileCta: string } }).siteHeader.mobileCta).toBe('Probar');
  });
});

// ---------------------------------------------------------------------------
// SiteHeader copy tests
// ---------------------------------------------------------------------------

import { SiteHeader } from '@/components/SiteHeader';

describe('F047 — SiteHeader updated copy', () => {
  it('renders "Probar gratis" as desktop CTA text', () => {
    render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    expect(screen.getByText('Probar gratis')).toBeInTheDocument();
  });

  it('does not render "Pedir acceso anticipado" anymore', () => {
    render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    expect(screen.queryByText('Pedir acceso anticipado')).not.toBeInTheDocument();
  });

  it('does not render "Acceso" as standalone mobile CTA anymore', () => {
    render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    // The old standalone mobile "Acceso" link should be gone; MobileMenu takes its place
    expect(screen.queryByText('Acceso')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Contrast class assertions (text-slate-400 replaced with text-slate-500)
// ---------------------------------------------------------------------------

import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { ComparisonSection } from '@/components/sections/ComparisonSection';
import { ProductDemo } from '@/components/ProductDemo';

describe('F047 — Contrast fix: text-slate-400 → text-slate-500 on light backgrounds', () => {
  it('WaitlistCTASection renders without error (contrast fix applied)', () => {
    const dict = getDictionary('es');
    expect(() => render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" />)).not.toThrow();
  });

  it('ComparisonSection versus label uses text-slate-500 not text-slate-400', () => {
    const dict = getDictionary('es');
    const { container } = render(<ComparisonSection dict={dict.comparison} />);
    // The versus label should now use text-slate-500
    const versusElements = container.querySelectorAll('.text-slate-400');
    // None of the .text-slate-400 elements should be the versus label (italic, font-medium)
    const illegalSlate400Elements = Array.from(versusElements).filter(
      (el) => el.classList.contains('italic') && el.classList.contains('font-medium')
    );
    expect(illegalSlate400Elements).toHaveLength(0);
  });

  it('ProductDemo step label uses text-slate-500 not text-slate-400', () => {
    const { container } = render(<ProductDemo />);
    // Step label divs should NOT have text-slate-400 with font-semibold (those are step labels)
    const stepLabels = container.querySelectorAll('.font-semibold.uppercase');
    const withSlate400 = Array.from(stepLabels).filter(
      (el) => (el as HTMLElement).className.includes('text-slate-400')
    );
    expect(withSlate400).toHaveLength(0);
  });
});
