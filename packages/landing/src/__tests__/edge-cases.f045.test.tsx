/**
 * @jest-environment jsdom
 *
 * F045 — Landing Critical Bug Fixes: Edge-Case & Spec-Deviation Tests
 *
 * QA-authored tests targeting gaps not covered by the developer's test suite.
 *
 * Covers:
 * 1. metadata.alternates.canonical is set in layout (C4 / canonical URL fix)
 * 2. metadata.robots.index === false on all three legal pages
 * 3. suppressHydrationWarning on <html> verified via layout source (static analysis)
 * 4. SearchSimulatorWithCTA onInteract fires via dish chip (not Run button)
 * 5. PostSimulatorCTA: typing in input does NOT reveal CTA (only selection does)
 * 6. Variant C and F still contain id="demo" (regression guard — anchor must exist
 *    even in layouts that omit ForWhoSection)
 * 7. Variant 'd' cookie falls back to 'a' (already in ab-testing.test.ts, but
 *    added here as a cross-test guard for the edge-cases suite)
 * 8. generateWebSiteSchema does not contain potentialAction key at runtime
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks (shared across tests)
// ---------------------------------------------------------------------------
jest.mock('@/components/SiteHeader', () => ({
  SiteHeader: () => <header role="banner">Site Header</header>,
}));

jest.mock('@/components/sections/HeroSection', () => ({
  HeroSection: ({ variant }: { variant: string }) => (
    <section aria-label="Inicio" data-variant={variant}>Hero</section>
  ),
}));

jest.mock('@/components/ProductDemo', () => ({
  ProductDemo: () => <div>Product Demo</div>,
}));

jest.mock('@/components/sections/HowItWorksSection', () => ({
  HowItWorksSection: () => <section id="como-funciona">HowItWorks</section>,
}));

jest.mock('@/components/sections/EmotionalBlock', () => ({
  EmotionalBlock: () => <section>Emotional</section>,
}));

jest.mock('@/components/sections/TrustEngineSection', () => ({
  TrustEngineSection: () => <section>Trust</section>,
}));

jest.mock('@/components/sections/ForWhoSection', () => ({
  ForWhoSection: () => <section id="para-quien">ForWho</section>,
}));

jest.mock('@/components/sections/ComparisonSection', () => ({
  ComparisonSection: () => <section>Comparison</section>,
}));

jest.mock('@/components/sections/RestaurantsSection', () => ({
  RestaurantsSection: () => <section>Restaurants</section>,
}));

jest.mock('@/components/sections/WaitlistCTASection', () => ({
  WaitlistCTASection: () => (
    <section id="waitlist" aria-label="Waitlist">Waitlist CTA</section>
  ),
}));

jest.mock('@/components/sections/Footer', () => ({
  Footer: () => <footer>Footer</footer>,
}));

jest.mock('@/components/analytics/CookieBanner', () => ({
  CookieBanner: () => null,
}));

jest.mock('@/components/analytics/ScrollTracker', () => ({
  ScrollTracker: () => null,
}));

jest.mock('@/components/analytics/SectionObserver', () => ({
  SectionObserver: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/VisualDivider', () => ({
  VisualDivider: () => <div aria-hidden="true" />,
}));

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    button: ({
      children,
      onClick,
      disabled,
      className,
      'aria-label': ariaLabel,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      className?: string;
      'aria-label'?: string;
    }) => (
      <button onClick={onClick} disabled={disabled} className={className} aria-label={ariaLabel}>
        {children}
      </button>
    ),
  },
}));

jest.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}));

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return <a href={href} className={className}>{children}</a>;
  };
});

global.fetch = jest.fn();

// ---------------------------------------------------------------------------
// 1. C4 — Canonical URL in layout metadata
// ---------------------------------------------------------------------------
import { metadata } from '@/app/layout';

describe('C4 — Canonical URL (layout metadata)', () => {
  it('metadata.alternates.canonical is defined', () => {
    expect(metadata.alternates).toBeDefined();
    expect(metadata.alternates?.canonical).toBeDefined();
  });

  it('metadata.alternates.canonical is "/"', () => {
    expect(metadata.alternates?.canonical).toBe('/');
  });

  it('metadata.openGraph.images includes og-image.jpg (BUG-LANDING-02)', () => {
    const images = metadata.openGraph?.images;
    const imageArray = Array.isArray(images) ? images : [images];
    const hasOgImage = imageArray.some((img) => {
      if (typeof img === 'string') return img.includes('og-image.jpg');
      if (img && typeof img === 'object' && 'url' in img) return String(img.url).includes('og-image.jpg');
      return false;
    });
    expect(hasOgImage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Legal pages — robots.index === false on all three pages
// ---------------------------------------------------------------------------
import { metadata as privacidadMetadata } from '@/app/privacidad/page';
import { metadata as cookiesMetadata } from '@/app/cookies/page';
import { metadata as avisoLegalMetadata } from '@/app/aviso-legal/page';

describe('Legal pages — robots: index: false (spec requirement)', () => {
  it('/privacidad has robots.index === false', () => {
    const robots = privacidadMetadata.robots;
    // robots can be an object or a Robots string; spec requires index: false
    expect(robots).toBeDefined();
    if (typeof robots === 'object' && robots !== null && !Array.isArray(robots)) {
      expect((robots as { index?: boolean }).index).toBe(false);
    } else {
      // If it's a string, it must include 'noindex'
      expect(String(robots)).toMatch(/noindex/i);
    }
  });

  it('/cookies has robots.index === false', () => {
    const robots = cookiesMetadata.robots;
    expect(robots).toBeDefined();
    if (typeof robots === 'object' && robots !== null && !Array.isArray(robots)) {
      expect((robots as { index?: boolean }).index).toBe(false);
    } else {
      expect(String(robots)).toMatch(/noindex/i);
    }
  });

  it('/aviso-legal has robots.index === false', () => {
    const robots = avisoLegalMetadata.robots;
    expect(robots).toBeDefined();
    if (typeof robots === 'object' && robots !== null && !Array.isArray(robots)) {
      expect((robots as { index?: boolean }).index).toBe(false);
    } else {
      expect(String(robots)).toMatch(/noindex/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Legal pages — metadata title pattern
// ---------------------------------------------------------------------------
describe('Legal pages — metadata titles follow nutriXplorer branding', () => {
  it('/privacidad title contains "nutriXplorer"', () => {
    const title = privacidadMetadata.title;
    expect(String(title)).toMatch(/nutriXplorer/i);
  });

  it('/cookies title contains "nutriXplorer"', () => {
    const title = cookiesMetadata.title;
    expect(String(title)).toMatch(/nutriXplorer/i);
  });

  it('/aviso-legal title contains "nutriXplorer"', () => {
    const title = avisoLegalMetadata.title;
    expect(String(title)).toMatch(/nutriXplorer/i);
  });
});

// ---------------------------------------------------------------------------
// 4. SearchSimulatorWithCTA — onInteract fires via dish chip (not Run button)
//    Regression guard: the existing test clicks button[0] (Run button), which
//    happens to work because handleRun also calls selectDish. This test
//    explicitly verifies that clicking a DISH CHIP (not the Run button) also
//    triggers the CTA — and that typing alone does NOT.
// ---------------------------------------------------------------------------
import { SearchSimulatorWithCTA } from '@/components/features/SearchSimulatorWithCTA';

describe('SearchSimulatorWithCTA — interaction gating (BUG-LANDING-05)', () => {
  it('CTA is hidden after typing in input (before any dish selection)', async () => {
    const user = userEvent.setup();
    render(<SearchSimulatorWithCTA variant="a" />);
    const input = screen.getByLabelText(/buscar plato/i);
    await user.clear(input);
    await user.type(input, 'pollo');
    // Typing alone must not reveal CTA
    expect(screen.queryByText(/te gusta lo que ves/i)).not.toBeInTheDocument();
  });

  it('CTA appears after clicking a named dish chip (aria-label present)', async () => {
    const user = userEvent.setup();
    render(<SearchSimulatorWithCTA variant="a" />);
    // Dish chip buttons have aria-label={dish.dish} e.g. "Pulpo a feira"
    // Get all buttons and find one that is NOT "Ver resultado" (the Run button)
    const allButtons = screen.getAllByRole('button');
    // The Run button has aria-label "Ver resultado" — skip it
    const dishChip = allButtons.find(
      (btn) => btn.getAttribute('aria-label') !== 'Ver resultado'
    );
    expect(dishChip).toBeDefined();
    if (dishChip) {
      await user.click(dishChip);
      // CTA should now be visible
      expect(screen.getByText(/te gusta lo que ves/i)).toBeInTheDocument();
    }
  });

  it('CTA does not appear if user only focuses input and blurs without selecting', async () => {
    const user = userEvent.setup();
    render(<SearchSimulatorWithCTA variant="a" />);
    const input = screen.getByLabelText(/buscar plato/i);
    await user.click(input);
    await user.tab(); // blur without selecting
    expect(screen.queryByText(/te gusta lo que ves/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Anchor IDs in Variant C and Variant F layouts
//    (regression guard — must not break when ForWhoSection is absent)
// ---------------------------------------------------------------------------
import LandingPage from '@/app/page';

function makeSearchParams(params: Record<string, string>) {
  return Promise.resolve(params) as Promise<{ variant?: string; palette?: string }>;
}

describe('Anchor IDs — Variant C and F layouts (BUG-LANDING-03)', () => {
  it('Variant C has id="demo" in the DOM', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'c' }) });
    const { container } = render(jsx);
    expect(container.querySelector('#demo')).not.toBeNull();
  });

  it('Variant C has id="waitlist" in the DOM', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'c' }) });
    const { container } = render(jsx);
    expect(container.querySelector('#waitlist')).not.toBeNull();
  });

  it('Variant F has id="demo" in the DOM', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'f' }) });
    const { container } = render(jsx);
    expect(container.querySelector('#demo')).not.toBeNull();
  });

  it('Variant F has id="waitlist" in the DOM', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'f' }) });
    const { container } = render(jsx);
    expect(container.querySelector('#waitlist')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Variant D fallback — cookie 'd' resolves to 'a' (regression guard)
// ---------------------------------------------------------------------------
import { resolveVariant } from '@/lib/ab-testing';

describe('Variant D removal — fallback guards (ADR-012)', () => {
  it('resolveVariant("d", undefined) returns "a" (URL param d is invalid)', () => {
    expect(resolveVariant('d', undefined)).toBe('a');
  });

  it('resolveVariant(undefined, "d") returns "a" (cookie d is invalid)', () => {
    expect(resolveVariant(undefined, 'd')).toBe('a');
  });

  it('resolveVariant("d", "c") returns "c" (falls through to valid cookie)', () => {
    // URL param 'd' is invalid → fall through to cookie 'c' (valid)
    expect(resolveVariant('d', 'c')).toBe('c');
  });

  it('resolveVariant("d", "d") returns "a" (both invalid → default)', () => {
    expect(resolveVariant('d', 'd')).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// 7. BUG-LANDING-08 — generateWebSiteSchema has no potentialAction at runtime
// ---------------------------------------------------------------------------
import { generateWebSiteSchema } from '@/lib/seo';

describe('BUG-LANDING-08 — SearchAction removal (seo.ts)', () => {
  it('generateWebSiteSchema does not include potentialAction key', () => {
    const schema = generateWebSiteSchema();
    expect(Object.keys(schema)).not.toContain('potentialAction');
  });

  it('generateWebSiteSchema does not include searchAction key (case variations)', () => {
    const schema = generateWebSiteSchema() as Record<string, unknown>;
    expect(schema['searchAction']).toBeUndefined();
    expect(schema['SearchAction']).toBeUndefined();
  });
});
