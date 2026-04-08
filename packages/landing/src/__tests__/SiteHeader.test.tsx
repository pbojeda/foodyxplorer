import React from 'react';
import { render, screen } from '@testing-library/react';
import { SiteHeader } from '@/components/SiteHeader';

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

function setup(props: Partial<React.ComponentProps<typeof SiteHeader>> = {}) {
  return render(<SiteHeader hablarBaseUrl={null} variant="a" {...props} />);
}

describe('SiteHeader', () => {
  it('renders the nutriXplorer logo', () => {
    setup();
    expect(screen.getByRole('link', { name: /nutrixplorer/i })).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    setup();
    // Use getAllByRole since desktop + mobile menu both render the nav links
    expect(screen.getAllByRole('link', { name: /demo/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /cómo funciona/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /faq/i }).length).toBeGreaterThan(0);
  });

  it('renders a link with text "FAQ" and href="#faq"', () => {
    setup();
    const links = screen.getAllByRole('link', { name: /^faq$/i });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link).toHaveAttribute('href', '#faq'));
  });

  it('does NOT render text "Para quién"', () => {
    setup();
    expect(screen.queryByText('Para quién')).not.toBeInTheDocument();
  });

  it('renders the waitlist CTA with updated copy "Probar gratis"', () => {
    setup();
    expect(screen.getByText('Probar gratis')).toBeInTheDocument();
  });

  it('does not render old CTA copy "Pedir acceso anticipado"', () => {
    setup();
    expect(screen.queryByText('Pedir acceso anticipado')).not.toBeInTheDocument();
  });

  it('does not render old mobile CTA "Acceso" as standalone link', () => {
    setup();
    expect(screen.queryByText('Acceso')).not.toBeInTheDocument();
  });

  it('renders as a header landmark', () => {
    setup();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders hamburger button (MobileMenu present)', () => {
    setup();
    expect(screen.getByRole('button', { name: /menú/i })).toBeInTheDocument();
  });

  // F093 — new prop scenarios
  describe('F093 — hablarBaseUrl prop', () => {
    it('renders HeaderCTA with #waitlist href when hablarBaseUrl is null', () => {
      setup({ hablarBaseUrl: null, variant: 'a' });
      const links = screen.getAllByRole('link', { name: /probar gratis/i });
      // Desktop CTA should fall back to #waitlist
      expect(links.some((l) => l.getAttribute('href') === '#waitlist')).toBe(true);
    });

    it('renders HeaderCTA with UTM href when hablarBaseUrl is set', () => {
      setup({ hablarBaseUrl: 'https://hablar.nutrixplorer.com/hablar', variant: 'a' });
      const links = screen.getAllByRole('link', { name: /probar gratis/i });
      expect(
        links.some((l) =>
          l.getAttribute('href')?.includes('utm_medium=header_cta')
        )
      ).toBe(true);
    });

    it('passes ctaHref with header_cta UTM to MobileMenu when hablarBaseUrl is set', () => {
      setup({ hablarBaseUrl: 'https://hablar.nutrixplorer.com/hablar', variant: 'c' });
      // MobileMenu renders the same mobile CTA — it should use the resolved href
      // We can verify by checking all links for the UTM param
      const links = screen.getAllByRole('link');
      const ctaLinks = links.filter((l) =>
        l.getAttribute('href')?.includes('header_cta')
      );
      expect(ctaLinks.length).toBeGreaterThan(0);
    });

    it('passes ctaHref=#waitlist to MobileMenu when hablarBaseUrl is null', () => {
      setup({ hablarBaseUrl: null, variant: 'a' });
      // All "Probar gratis" links should use #waitlist
      const links = screen.getAllByRole('link', { name: /probar gratis/i });
      links.forEach((l) => expect(l.getAttribute('href')).toBe('#waitlist'));
    });
  });
});
