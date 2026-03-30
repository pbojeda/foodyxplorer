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

describe('SiteHeader', () => {
  it('renders the nutriXplorer logo', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: /nutrixplorer/i })).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<SiteHeader />);
    // Use getAllByRole since desktop + mobile menu both render the nav links
    expect(screen.getAllByRole('link', { name: /demo/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /cómo funciona/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /faq/i }).length).toBeGreaterThan(0);
  });

  it('renders a link with text "FAQ" and href="#faq"', () => {
    render(<SiteHeader />);
    const links = screen.getAllByRole('link', { name: /^faq$/i });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link).toHaveAttribute('href', '#faq'));
  });

  it('does NOT render text "Para quién"', () => {
    render(<SiteHeader />);
    expect(screen.queryByText('Para quién')).not.toBeInTheDocument();
  });

  it('renders the waitlist CTA with updated copy "Probar gratis"', () => {
    render(<SiteHeader />);
    expect(screen.getByText('Probar gratis')).toBeInTheDocument();
  });

  it('does not render old CTA copy "Pedir acceso anticipado"', () => {
    render(<SiteHeader />);
    expect(screen.queryByText('Pedir acceso anticipado')).not.toBeInTheDocument();
  });

  it('does not render old mobile CTA "Acceso" as standalone link', () => {
    render(<SiteHeader />);
    expect(screen.queryByText('Acceso')).not.toBeInTheDocument();
  });

  it('renders as a header landmark', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders hamburger button (MobileMenu present)', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('button', { name: /menú/i })).toBeInTheDocument();
  });
});
