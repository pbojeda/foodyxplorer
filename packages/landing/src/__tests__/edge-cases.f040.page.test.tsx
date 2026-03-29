/**
 * @jest-environment jsdom
 *
 * F040 — FAQ Section + Schema: Page Integration Edge-Case Tests
 *
 * Tests for: empty-items guard in page.tsx (FAQ section + JSON-LD),
 * SectionObserver analytics guard, JSON-LD count, FAQPage presence in all variants.
 *
 * The empty-items guard tests were NOT written by the developer — they were
 * explicitly required by the spec (Step 5, Testing Strategy) but are absent
 * from page.test.tsx.
 *
 * Run with: cd packages/landing && npx jest edge-cases.f040.page --no-coverage
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// All component mocks (required for page.tsx to render in jsdom)
// ---------------------------------------------------------------------------
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));
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
  HowItWorksSection: () => <section aria-label="Cómo funciona">HowItWorks</section>,
}));
jest.mock('@/components/sections/EmotionalBlock', () => ({
  EmotionalBlock: () => <section aria-label="Qué cambia">Emotional</section>,
}));
jest.mock('@/components/sections/TrustEngineSection', () => ({
  TrustEngineSection: () => <section aria-label="Confianza">Trust Engine</section>,
}));
jest.mock('@/components/sections/ForWhoSection', () => ({
  ForWhoSection: () => <section aria-label="Para quién">For Who</section>,
}));
jest.mock('@/components/sections/ComparisonSection', () => ({
  ComparisonSection: () => <section aria-label="Comparación">Comparison</section>,
}));
jest.mock('@/components/sections/RestaurantsSection', () => ({
  RestaurantsSection: () => <section aria-label="Restaurantes">Restaurants</section>,
}));
jest.mock('@/components/sections/WaitlistCTASection', () => ({
  WaitlistCTASection: () => (
    <section id="waitlist" aria-label="Waitlist">Waitlist CTA</section>
  ),
}));
jest.mock('@/components/sections/FAQSection', () => ({
  FAQSection: () => <section aria-label="FAQ">FAQ Section</section>,
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
  // Expose the sectionId as a data attribute so tests can detect it
  SectionObserver: ({
    children,
    sectionId,
  }: {
    children: React.ReactNode;
    sectionId: string;
  }) => <div data-observer-section={sectionId}>{children}</div>,
}));
jest.mock('@/components/VisualDivider', () => ({
  VisualDivider: () => <div data-testid="visual-divider" aria-hidden="true" />,
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}));

// Spy-able wrapper so tests can override getDictionary return value
jest.mock('@/lib/i18n', () => {
  const real = jest.requireActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return {
    ...real,
    getDictionary: jest.fn(real.getDictionary),
  };
});

// Import page AFTER all mocks
import LandingPage from '@/app/page';
import * as i18nModule from '@/lib/i18n';

function makeSearchParams(params: Record<string, string>) {
  return Promise.resolve(params) as Promise<{ variant?: string; palette?: string }>;
}

// Helper to inject an empty-faq dictionary for a single test
function mockEmptyFaq() {
  const real = jest.requireActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  const realDict = real.getDictionary('es');
  (i18nModule.getDictionary as jest.Mock).mockReturnValueOnce({
    ...realDict,
    faq: { eyebrow: '', headline: '', items: [] },
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Empty-items guard — the tests the developer did NOT write
// ---------------------------------------------------------------------------

describe('F040 — page.tsx: empty FAQ items guard', () => {
  it('does not render FAQ section when faq.items is empty (variant a)', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    render(jsx);

    expect(screen.queryByRole('region', { name: /FAQ/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain('FAQ Section');
  });

  it('does not render FAQPage JSON-LD when faq.items is empty', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    render(jsx);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const schemas = Array.from(scripts).map((s) => {
      try {
        return JSON.parse(s.innerHTML) as { '@type': string };
      } catch {
        return null;
      }
    });
    expect(schemas.some((s) => s?.['@type'] === 'FAQPage')).toBe(false);
  });

  it('still renders exactly 2 JSON-LD scripts (WebSite + SoftwareApplication) when faq.items is empty', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    render(jsx);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(2);
  });

  it('does not render SectionObserver with sectionId="faq" when items are empty (analytics guard)', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    const { container } = render(jsx);

    // The SectionObserver mock renders <div data-observer-section="faq">
    // when it wraps the FAQ — that div must NOT appear for empty items
    expect(container.querySelector('[data-observer-section="faq"]')).toBeNull();
  });

  it('does not render FAQ section when faq.items is empty — variant c', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'c' }) });
    render(jsx);
    expect(document.body.innerHTML).not.toContain('FAQ Section');
  });

  it('does not render FAQ section when faq.items is empty — variant f', async () => {
    mockEmptyFaq();
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'f' }) });
    render(jsx);
    expect(document.body.innerHTML).not.toContain('FAQ Section');
  });
});

// ---------------------------------------------------------------------------
// JSON-LD count and FAQPage type when FAQ items are present
// ---------------------------------------------------------------------------

describe('F040 — page.tsx: JSON-LD with non-empty FAQ', () => {
  it('renders at least 3 JSON-LD scripts (WebSite + SoftwareApplication + FAQPage)', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    render(jsx);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThanOrEqual(3);
  });

  it('FAQPage JSON-LD is present in variant a', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'a' }) });
    render(jsx);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const schemas = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.innerHTML) as { '@type': string }; } catch { return null; }
    });
    expect(schemas.some((s) => s?.['@type'] === 'FAQPage')).toBe(true);
  });

  it('FAQPage JSON-LD is present in variant c', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'c' }) });
    render(jsx);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const schemas = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.innerHTML) as { '@type': string }; } catch { return null; }
    });
    expect(schemas.some((s) => s?.['@type'] === 'FAQPage')).toBe(true);
  });

  it('FAQPage JSON-LD is present in variant f', async () => {
    const jsx = await LandingPage({ searchParams: makeSearchParams({ variant: 'f' }) });
    render(jsx);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const schemas = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.innerHTML) as { '@type': string }; } catch { return null; }
    });
    expect(schemas.some((s) => s?.['@type'] === 'FAQPage')).toBe(true);
  });
});
