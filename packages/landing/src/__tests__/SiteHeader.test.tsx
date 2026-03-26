import React from 'react';
import { render, screen } from '@testing-library/react';
import { SiteHeader } from '@/components/SiteHeader';

describe('SiteHeader', () => {
  it('renders the nutriXplorer logo', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: /nutrixplorer/i })).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: /demo/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cómo funciona/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /para quién/i })).toBeInTheDocument();
  });

  it('renders the waitlist CTA button', () => {
    render(<SiteHeader />);
    const ctaLinks = screen.getAllByRole('link', { name: /acceso/i });
    expect(ctaLinks.length).toBeGreaterThan(0);
  });

  it('renders as a header landmark', () => {
    render(<SiteHeader />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
