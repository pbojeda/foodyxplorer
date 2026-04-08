/**
 * @jest-environment jsdom
 *
 * F093 — Landing Integration + Analytics: Edge-Case Tests
 *
 * Tests for: hablarBaseUrl env var resolution, null→undefined prop threading,
 * fallback behavior when NEXT_PUBLIC_WEB_URL is unset, trailing slash stripping.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Analytics mock
// ---------------------------------------------------------------------------
jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// URL building logic (unit tests — no component rendering needed)
// ---------------------------------------------------------------------------

describe('F093 — hablarBaseUrl resolution logic', () => {
  function resolveHablarBaseUrl(rawUrl: string): string | null {
    return rawUrl ? rawUrl.replace(/\/+$/, '') + '/hablar' : null;
  }

  it('returns null when rawUrl is empty string', () => {
    expect(resolveHablarBaseUrl('')).toBeNull();
  });

  it('builds correct URL when rawUrl has no trailing slash', () => {
    expect(resolveHablarBaseUrl('https://hablar.nutrixplorer.com')).toBe(
      'https://hablar.nutrixplorer.com/hablar'
    );
  });

  it('strips single trailing slash before appending /hablar', () => {
    expect(resolveHablarBaseUrl('https://hablar.nutrixplorer.com/')).toBe(
      'https://hablar.nutrixplorer.com/hablar'
    );
  });

  it('strips multiple trailing slashes before appending /hablar', () => {
    expect(resolveHablarBaseUrl('https://hablar.nutrixplorer.com///')).toBe(
      'https://hablar.nutrixplorer.com/hablar'
    );
  });
});

// ---------------------------------------------------------------------------
// HeaderCTA — fallback behavior
// ---------------------------------------------------------------------------

import { HeaderCTA } from '@/components/HeaderCTA';

describe('F093 — HeaderCTA fallback when hablarBaseUrl is null', () => {
  it('renders with href="#waitlist" when hablarBaseUrl is null', () => {
    render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
    const link = screen.getByRole('link', { name: /probar gratis/i });
    expect(link).toHaveAttribute('href', '#waitlist');
  });

  it('does not set target or rel when falling back', () => {
    render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
    const link = screen.getByRole('link', { name: /probar gratis/i });
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });
});

// ---------------------------------------------------------------------------
// HeroSection — null→undefined prop behavior (Variant A only)
// ---------------------------------------------------------------------------

// Minimal mocks for HeroSection to render in jsdom
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

import { HeroSection } from '@/components/sections/HeroSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('F093 — HeroSection hablarUrl undefined vs null', () => {
  it('does not render hero CTA when hablarUrl is undefined (null→undefined conversion)', () => {
    // Simulates page.tsx passing hablarBaseUrl ?? undefined when hablarBaseUrl is null
    render(
      <HeroSection variant="a" dict={dict.hero} variantsCopy={dict.variants} hablarUrl={undefined} />
    );
    expect(screen.queryByRole('link', { name: /pruébalo ahora/i })).not.toBeInTheDocument();
  });

  it('does not render hero CTA for variant c even when hablarUrl is provided', () => {
    render(
      <HeroSection
        variant="c"
        dict={dict.hero}
        variantsCopy={dict.variants}
        hablarUrl="https://hablar.nutrixplorer.com/hablar"
      />
    );
    expect(screen.queryByRole('link', { name: /pruébalo ahora/i })).not.toBeInTheDocument();
  });

  it('does not render hero CTA for variant f even when hablarUrl is provided', () => {
    render(
      <HeroSection
        variant="f"
        dict={dict.hero}
        variantsCopy={dict.variants}
        hablarUrl="https://hablar.nutrixplorer.com/hablar"
      />
    );
    expect(screen.queryByRole('link', { name: /pruébalo ahora/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WaitlistCTASection — all variants receive bottom CTA
// ---------------------------------------------------------------------------

import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';

const bottomUrl = 'https://hablar.nutrixplorer.com/hablar';

describe('F093 — WaitlistCTASection bottom CTA applies to all variants', () => {
  it('renders bottom CTA for variant a', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={bottomUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toBeInTheDocument();
  });

  it('renders bottom CTA for variant c', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="c" hablarUrl={bottomUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toBeInTheDocument();
  });

  it('renders bottom CTA for variant f', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="f" hablarUrl={bottomUrl} />);
    expect(screen.getByRole('link', { name: /o pruébalo ahora gratis/i })).toBeInTheDocument();
  });

  it('does NOT render bottom CTA when hablarUrl is null converted to undefined', () => {
    render(<WaitlistCTASection dict={dict.waitlistCta} variant="a" hablarUrl={undefined} />);
    expect(screen.queryByRole('link', { name: /o pruébalo ahora gratis/i })).not.toBeInTheDocument();
  });
});
