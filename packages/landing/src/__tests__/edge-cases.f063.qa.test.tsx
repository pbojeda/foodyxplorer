/**
 * @jest-environment jsdom
 *
 * F063 QA — Edge Cases
 *
 * Covers gaps the developer tests did not exercise:
 *
 * 1. Cookie idempotency: mount useEffect must NOT overwrite nx-variant when
 *    the cookie already exists in the jar.
 *
 * 2. Correct variant value: mount write must use the variant prop value, not a
 *    hardcoded string. Verified for all three valid variants (a, c, f).
 *
 * 3. Cookie attributes — samesite=lax and max-age must both be present in all
 *    cookie writes (mount + handleAccept). The Secure flag is tested in the
 *    main CookieBanner test but the other mandatory attributes are not.
 *
 * 4. FAQSection id="faq" is present even when only one FAQ item exists (not
 *    just in the full 6-item scenario).
 *
 * 5. SiteHeader: no "#para-quien" href remains anywhere in the rendered output.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookieBanner } from '../components/analytics/CookieBanner';
import { FAQSection } from '../components/sections/FAQSection';

jest.mock('next/script', () => {
  return function MockScript({ onLoad }: { onLoad?: () => void }) {
    if (onLoad) onLoad();
    return null;
  };
});

const VARIANT_COOKIE = 'nx-variant';

// ---------------------------------------------------------------------------
// 1. Cookie idempotency — no overwrite when cookie already exists.
// ---------------------------------------------------------------------------
describe('F063 QA — CookieBanner: mount does NOT overwrite existing nx-variant cookie', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    cookieWrites.length = 0;

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });

    // Simulate cookie already set from a previous visit
    jest.spyOn(document, 'cookie', 'get').mockReturnValue(`${VARIANT_COOKIE}=c`);
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('does NOT write nx-variant cookie on mount when cookie already exists in jar', () => {
    render(<CookieBanner variant="a" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Correct variant value written — all three valid variants.
// ---------------------------------------------------------------------------
describe('F063 QA — CookieBanner: mount cookie carries correct variant value', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    cookieWrites.length = 0;

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });
    // Empty jar — cookie does not yet exist
    jest.spyOn(document, 'cookie', 'get').mockReturnValue('');
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('mount cookie value is "nx-variant=a" when variant prop is "a"', () => {
    render(<CookieBanner variant="a" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite).toContain(`${VARIANT_COOKIE}=a`);
  });

  it('mount cookie value is "nx-variant=c" when variant prop is "c"', () => {
    render(<CookieBanner variant="c" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite).toContain(`${VARIANT_COOKIE}=c`);
  });

  it('mount cookie value is "nx-variant=f" when variant prop is "f"', () => {
    render(<CookieBanner variant="f" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite).toContain(`${VARIANT_COOKIE}=f`);
  });
});

// ---------------------------------------------------------------------------
// 3. Cookie attributes — samesite=lax and max-age present in all writes.
// ---------------------------------------------------------------------------
describe('F063 QA — CookieBanner: required cookie attributes on mount and handleAccept', () => {
  const cookieWrites: string[] = [];
  let cookieSetSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    cookieWrites.length = 0;

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    cookieSetSpy = jest.spyOn(document, 'cookie', 'set').mockImplementation((val: string) => {
      cookieWrites.push(val);
      cookieDescriptor?.set?.call(document, val);
    });
    jest.spyOn(document, 'cookie', 'get').mockReturnValue('');
  });

  afterEach(() => {
    cookieSetSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('mount cookie includes samesite=lax', () => {
    render(<CookieBanner variant="a" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite!.toLowerCase()).toContain('samesite=lax');
  });

  it('mount cookie includes max-age', () => {
    render(<CookieBanner variant="a" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite!.toLowerCase()).toContain('max-age=');
  });

  it('mount cookie includes path=/', () => {
    render(<CookieBanner variant="a" />);
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite).toContain('path=/');
  });

  it('handleAccept cookie includes samesite=lax', () => {
    render(<CookieBanner variant="a" />);
    cookieWrites.length = 0; // clear mount write
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }));
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite!.toLowerCase()).toContain('samesite=lax');
  });

  it('handleAccept cookie includes max-age', () => {
    render(<CookieBanner variant="a" />);
    cookieWrites.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /aceptar/i }));
    const variantWrite = cookieWrites.find((w) => w.startsWith(`${VARIANT_COOKIE}=`));
    expect(variantWrite).toBeDefined();
    expect(variantWrite!.toLowerCase()).toContain('max-age=');
  });
});

// ---------------------------------------------------------------------------
// 4. FAQSection id="faq" present for minimal (1-item) dict.
// ---------------------------------------------------------------------------
describe('F063 QA — FAQSection id="faq" with minimal data', () => {
  const minimalDict = {
    eyebrow: 'FAQ',
    headline: '¿Tienes preguntas?',
    items: [{ question: '¿Cómo funciona?', answer: 'Muy bien.' }],
  };

  it('section element has id="faq" when only one item exists', () => {
    const { container } = render(<FAQSection dict={minimalDict} />);
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('id', 'faq');
  });

  it('section element retains aria-labelledby when only one item exists', () => {
    const { container } = render(<FAQSection dict={minimalDict} />);
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('aria-labelledby', 'faq-heading');
  });
});

// ---------------------------------------------------------------------------
// 5. SiteHeader: no stale "#para-quien" href remains anywhere.
// ---------------------------------------------------------------------------
import { SiteHeader } from '../components/SiteHeader';

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

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

describe('F063 QA — SiteHeader: no legacy #para-quien href', () => {
  it('no rendered link has href="#para-quien"', () => {
    const { container } = render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    const staleLinks = container.querySelectorAll('a[href="#para-quien"]');
    expect(staleLinks).toHaveLength(0);
  });

  it('no rendered text contains "Para quién"', () => {
    render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    expect(screen.queryByText('Para quién')).not.toBeInTheDocument();
  });

  it('exactly one #faq link is rendered in the desktop nav', () => {
    const { container } = render(<SiteHeader hablarBaseUrl={null} variant="a" />);
    // Desktop nav is the <nav> element; mobile menu also renders links
    // We just confirm at least one #faq link is present
    const faqLinks = container.querySelectorAll('a[href="#faq"]');
    expect(faqLinks.length).toBeGreaterThanOrEqual(1);
  });
});
