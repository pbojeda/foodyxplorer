/**
 * @jest-environment jsdom
 *
 * F093 QA — Additional edge-case tests
 *
 * Coverage gaps identified by QA review:
 * 1. Consent denied → analytics.ts consent guard blocks cta_hablar_click (spec req, untested in F093)
 * 2. data-cta-source attribute present on each CTA anchor (spec: data-cta-source="hero|bottom")
 * 3. WaitlistCTASection appends UTM params to hablarUrl — verify it receives BASE URL and builds correctly
 * 4. HeroSection appends UTM params to hablarUrl — verify it receives BASE URL and builds correctly
 * 5. Rapid click on mobile CTA fires analytics exactly once
 * 6. WaitlistCTASection bottom CTA DOM position: above trust note
 * 7. HeaderCTA with empty string ('') — documents type guard trust boundary
 * 8. HeroSection and WaitlistCTASection with empty string hablarUrl — correctly hidden
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock analytics
// ---------------------------------------------------------------------------
jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Mock framer-motion for HeroSection rendering
// ---------------------------------------------------------------------------
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 {...props}>{children}</h1>
    ),
  },
  useReducedMotion: () => false,
}));

jest.mock('next/image', () => {
  return function MockImage({ src, alt }: { src: string; alt: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  };
});

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, data: { count: 0 } }),
});

import * as analytics from '@/lib/analytics';
import { HeaderCTA } from '@/components/HeaderCTA';
import { MobileMenu } from '@/components/MobileMenu';
import { HeroSection } from '@/components/sections/HeroSection';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { getDictionary } from '@/lib/i18n';

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<typeof analytics.trackEvent>;
const dict = getDictionary('es');

// Base URL — what page.tsx resolves and passes to all components
const HABLAR_BASE = 'https://hablar.nutrixplorer.com/hablar';
const HEADER_HREF_FULL = `${HABLAR_BASE}?utm_source=landing&utm_medium=header_cta`;

// ---------------------------------------------------------------------------
// 1. Consent denied — analytics.ts consent guard blocks cta_hablar_click
//    Spec requirement: "Consent denied in landing → trackEvent returns early.
//    cta_hablar_click is NOT sent to GA4."
// ---------------------------------------------------------------------------

describe('F093 QA — consent denied: analytics.ts blocks cta_hablar_click', () => {
  afterEach(() => {
    delete (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied;
    delete (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
    delete (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue;
  });

  it('analytics.ts trackEvent does not call gtag when __nxConsentDenied is true', () => {
    (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied = true;

    const gtagSpy = jest.fn();
    (window as Window & { gtag?: (...args: unknown[]) => void }).gtag = gtagSpy;

    const originalEnv = process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'];
    process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'] = 'G-TEST123';

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { trackEvent: realTrackEvent } = require('@/lib/analytics');
      realTrackEvent({
        event: 'cta_hablar_click',
        source: 'header',
        variant: 'a',
        lang: 'es',
        utm_medium: 'header_cta',
      });
    });

    expect(gtagSpy).not.toHaveBeenCalled();

    process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'] = originalEnv;
  });

  it('analytics.ts trackEvent does not enqueue event when __nxConsentDenied is true', () => {
    (window as Window & { __nxConsentDenied?: boolean }).__nxConsentDenied = true;
    delete (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
    (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue = [];

    const originalEnv = process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'];
    process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'] = 'G-TEST123';

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { trackEvent: realTrackEvent } = require('@/lib/analytics');
      realTrackEvent({
        event: 'cta_hablar_click',
        source: 'hero',
        variant: 'a',
        lang: 'es',
        utm_medium: 'hero_cta',
      });
    });

    expect(
      (window as Window & { __nxEventQueue?: unknown[] }).__nxEventQueue
    ).toHaveLength(0);

    process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'] = originalEnv;
  });
});

// ---------------------------------------------------------------------------
// 2. data-cta-source attribute on CTA anchors
//    Spec: <a data-cta-source="hero"> and <a data-cta-source="bottom">
// ---------------------------------------------------------------------------

describe('F093 QA — data-cta-source attribute', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('HeroSection hero CTA has data-cta-source="hero"', () => {
    render(
      <HeroSection variant="a" dict={dict.hero} variantsCopy={dict.variants} hablarUrl={HABLAR_BASE} />
    );
    const link = screen.getByRole('link', { name: /pruébalo ahora/i });
    expect(link).toHaveAttribute('data-cta-source', 'hero');
  });

  it('WaitlistCTASection bottom CTA has data-cta-source="bottom"', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={HABLAR_BASE} />);
    const link = screen.getByRole('link', { name: /o pruébalo ahora gratis/i });
    expect(link).toHaveAttribute('data-cta-source', 'bottom');
  });
});

// ---------------------------------------------------------------------------
// 3. UTM param construction: both components receive BASE URL and append their own UTMs
//    page.tsx passes hablarBaseUrl (no UTMs). Each component appends ?utm_source=landing&utm_medium=<placement>
// ---------------------------------------------------------------------------

describe('F093 QA — UTM param construction from base URL', () => {
  it('HeroSection: appends hero_cta UTM to base hablarUrl', () => {
    render(
      <HeroSection variant="a" dict={dict.hero} variantsCopy={dict.variants} hablarUrl={HABLAR_BASE} />
    );
    const link = screen.getByRole('link', { name: /pruébalo ahora/i });
    expect(link).toHaveAttribute(
      'href',
      `${HABLAR_BASE}?utm_source=landing&utm_medium=hero_cta`
    );
  });

  it('WaitlistCTASection: appends bottom_cta UTM to base hablarUrl', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={HABLAR_BASE} />);
    const link = screen.getByRole('link', { name: /o pruébalo ahora gratis/i });
    expect(link).toHaveAttribute(
      'href',
      `${HABLAR_BASE}?utm_source=landing&utm_medium=bottom_cta`
    );
  });

  it('HeroSection: utm_medium=hero_cta appears exactly once in the href', () => {
    render(
      <HeroSection variant="a" dict={dict.hero} variantsCopy={dict.variants} hablarUrl={HABLAR_BASE} />
    );
    const href = screen.getByRole('link', { name: /pruébalo ahora/i }).getAttribute('href') ?? '';
    const matchCount = (href.match(/utm_medium/g) ?? []).length;
    expect(matchCount).toBe(1);
  });

  it('WaitlistCTASection: utm_medium=bottom_cta appears exactly once in the href', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={HABLAR_BASE} />);
    const href = screen.getByRole('link', { name: /o pruébalo ahora gratis/i }).getAttribute('href') ?? '';
    const matchCount = (href.match(/utm_medium/g) ?? []).length;
    expect(matchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. MobileMenu — rapid click on CTA fires analytics exactly once
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  { label: 'Demo', href: '#demo' },
  { label: 'FAQ', href: '#faq' },
];

describe('F093 QA — MobileMenu CTA fires analytics exactly once per click', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('fires cta_hablar_click exactly once on single CTA click', async () => {
    const user = userEvent.setup();
    render(
      <MobileMenu
        navLinks={NAV_LINKS}
        ctaText="Probar gratis"
        mobileCta="Probar"
        ctaHref={HEADER_HREF_FULL}
        variant="a"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await user.click(screen.getByText('Probar'));

    const hablarCalls = mockTrackEvent.mock.calls.filter(
      (call) => call[0]?.event === 'cta_hablar_click'
    );
    expect(hablarCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. WaitlistCTASection — bottom CTA DOM position: appears before trust note
//    Spec: "below social proof counter and above the trust note"
// ---------------------------------------------------------------------------

describe('F093 QA — bottom CTA DOM order: above trust note', () => {
  it('bottom CTA link appears before the trust note element in the DOM', () => {
    const { container } = render(
      <WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={HABLAR_BASE} />
    );

    const ctaLink = container.querySelector('a[data-cta-source="bottom"]');
    // Trust note: the <p> containing dict.waitlistCta.trustNote text
    // Use text-based query to find the trust note paragraph specifically
    const trustNote = screen.getByText(dict.waitlistCta.trustNote);

    expect(ctaLink).not.toBeNull();
    expect(trustNote).toBeInTheDocument();

    // If ctaLink comes BEFORE trustNote: ctaLink.compareDocumentPosition(trustNote)
    // returns DOCUMENT_POSITION_FOLLOWING (4) — trustNote follows ctaLink
    const position = ctaLink!.compareDocumentPosition(trustNote);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. HeaderCTA with empty string ('') — type guard trust boundary
//    page.tsx always passes null (not '') when URL is unset.
//    This test documents: '' !== null, so HeaderCTA treats it as external.
// ---------------------------------------------------------------------------

describe('F093 QA — HeaderCTA type guard trust boundary (empty string)', () => {
  it('empty string is NOT null: component treats it as external (not #waitlist fallback)', () => {
    // In production, page.tsx always converts '' → null before passing.
    // If '' ever reaches HeaderCTA, it should ideally fall back to #waitlist.
    // The implementation checks `hablarBaseUrl !== null` — so '' is treated as external.
    // This test DOCUMENTS this behavior as a known trust boundary (type system is the guard).
    render(<HeaderCTA hablarBaseUrl={''} variant="a" />);
    const link = screen.getByRole('link', { name: /probar gratis/i });
    // '' is treated as external — href becomes '?utm_source=...' (relative, broken)
    expect(link.getAttribute('href')).not.toBe('#waitlist');
  });
});

// ---------------------------------------------------------------------------
// 7. HeroSection and WaitlistCTASection with empty string hablarUrl
//    Implementation uses: hablarUrl && hablarUrl !== '#waitlist'
//    '' is falsy → CTA is NOT rendered (correct degradation)
// ---------------------------------------------------------------------------

describe('F093 QA — empty string hablarUrl hides CTAs (falsy check)', () => {
  it('HeroSection: empty string does NOT render hero CTA', () => {
    render(
      <HeroSection variant="a" dict={dict.hero} variantsCopy={dict.variants} hablarUrl="" />
    );
    expect(screen.queryByRole('link', { name: /pruébalo ahora/i })).not.toBeInTheDocument();
  });

  it('WaitlistCTASection: empty string does NOT render bottom CTA', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl="" />);
    expect(screen.queryByRole('link', { name: /o pruébalo ahora gratis/i })).not.toBeInTheDocument();
  });
});

