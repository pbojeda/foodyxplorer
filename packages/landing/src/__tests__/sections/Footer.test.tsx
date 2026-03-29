import React from 'react';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/sections/Footer';
import { getDictionary } from '@/lib/i18n';

// Mock fetch for WaitlistForm
global.fetch = jest.fn();

const dict = getDictionary('es');

describe('Footer', () => {
  it('renders the brand name', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    // Multiple elements may contain "nutriXplorer"; verify at least one exists
    const elements = screen.getAllByText(/nutriXplorer/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders the tagline', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    expect(screen.getByText(dict.footer.tagline)).toBeInTheDocument();
  });

  it('renders legal links', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    expect(screen.getByText(dict.footer.links.privacy)).toBeInTheDocument();
    expect(screen.getByText(dict.footer.links.cookies)).toBeInTheDocument();
    expect(screen.getByText(dict.footer.links.legal)).toBeInTheDocument();
  });

  it('renders "Hecho en España" text', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    expect(screen.getByText(dict.footer.madeIn)).toBeInTheDocument();
  });

  it('renders copyright notice', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    expect(screen.getByText(dict.footer.copyright)).toBeInTheDocument();
  });

  it('does NOT render a waitlist form (S7: max 2 forms per variant)', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    expect(screen.queryByRole('button', { name: /únete/i })).not.toBeInTheDocument();
  });

  it('renders a GitHub link', () => {
    render(<Footer dict={dict.footer} variant="a" />);
    const githubLink = screen.getByRole('link', { name: /github/i });
    expect(githubLink).toBeInTheDocument();
  });

  it('renders as footer landmark', () => {
    const { container } = render(<Footer dict={dict.footer} variant="a" />);
    expect(container.querySelector('footer')).toBeInTheDocument();
  });
});
