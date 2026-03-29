/**
 * @jest-environment jsdom
 *
 * Legal pages: /privacidad, /cookies, /aviso-legal
 * Tests rendering, headings, key content, and back link.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock SiteHeader to isolate content assertions
jest.mock('@/components/SiteHeader', () => ({
  SiteHeader: () => <header role="banner">Site Header</header>,
}));

// Mock CookieSettingsLink to keep pages as Server Component rendering tests
jest.mock('../components/analytics/CookieSettingsLink', () => ({
  CookieSettingsLink: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}));

// Mock next/link
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
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

import PrivacidadPage from '@/app/privacidad/page';
import CookiesPage from '@/app/cookies/page';
import AvisoLegalPage from '@/app/aviso-legal/page';

// ---------------------------------------------------------------------------
// Privacidad (Privacy Policy)
// ---------------------------------------------------------------------------
describe('PrivacidadPage (/privacidad)', () => {
  it('renders h1 with expected title', () => {
    render(React.createElement(PrivacidadPage));
    expect(
      screen.getByRole('heading', { level: 1, name: /política de privacidad/i })
    ).toBeInTheDocument();
  });

  it('renders an article element', () => {
    const { container } = render(React.createElement(PrivacidadPage));
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('renders "Responsable del tratamiento" section heading', () => {
    render(React.createElement(PrivacidadPage));
    expect(
      screen.getByRole('heading', { name: /responsable del tratamiento/i })
    ).toBeInTheDocument();
  });

  it('renders "Finalidad" section heading', () => {
    render(React.createElement(PrivacidadPage));
    expect(
      screen.getByRole('heading', { name: /finalidad/i })
    ).toBeInTheDocument();
  });

  it('renders "Derechos del interesado" section heading', () => {
    render(React.createElement(PrivacidadPage));
    expect(
      screen.getByRole('heading', { name: /derechos del interesado/i })
    ).toBeInTheDocument();
  });

  it('has a back link to /', () => {
    render(React.createElement(PrivacidadPage));
    const backLink = screen.getByRole('link', { name: /volver/i });
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('renders SiteHeader', () => {
    render(React.createElement(PrivacidadPage));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cookies (Cookie Policy)
// ---------------------------------------------------------------------------
describe('CookiesPage (/cookies)', () => {
  it('renders h1 with expected title', () => {
    render(React.createElement(CookiesPage));
    expect(
      screen.getByRole('heading', { level: 1, name: /política de cookies/i })
    ).toBeInTheDocument();
  });

  it('renders an article element', () => {
    const { container } = render(React.createElement(CookiesPage));
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('lists nx-cookie-consent cookie', () => {
    render(React.createElement(CookiesPage));
    expect(screen.getByText(/nx-cookie-consent/i)).toBeInTheDocument();
  });

  it('lists nx-variant cookie', () => {
    render(React.createElement(CookiesPage));
    expect(screen.getByText(/nx-variant/i)).toBeInTheDocument();
  });

  it('has a back link to /', () => {
    render(React.createElement(CookiesPage));
    const backLink = screen.getByRole('link', { name: /volver/i });
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('renders SiteHeader', () => {
    render(React.createElement(CookiesPage));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Aviso Legal (Legal Notice)
// ---------------------------------------------------------------------------
describe('AvisoLegalPage (/aviso-legal)', () => {
  it('renders h1 with expected title', () => {
    render(React.createElement(AvisoLegalPage));
    expect(
      screen.getByRole('heading', { level: 1, name: /aviso legal/i })
    ).toBeInTheDocument();
  });

  it('renders an article element', () => {
    const { container } = render(React.createElement(AvisoLegalPage));
    expect(container.querySelector('article')).not.toBeNull();
  });

  it('renders "Titular del sitio web" section', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByText(/titular del sitio web/i)).toBeInTheDocument();
  });

  it('renders "Propiedad intelectual" section heading', () => {
    render(React.createElement(AvisoLegalPage));
    expect(
      screen.getByRole('heading', { name: /propiedad intelectual/i })
    ).toBeInTheDocument();
  });

  it('has a back link to /', () => {
    render(React.createElement(AvisoLegalPage));
    const backLink = screen.getByRole('link', { name: /volver/i });
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('renders SiteHeader', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F059 C1: Real personal data in legal pages
// ---------------------------------------------------------------------------
describe('F059 C1 — PrivacidadPage contains real personal data', () => {
  it('contains "Pablo Eduardo Ojeda Vasco"', () => {
    render(React.createElement(PrivacidadPage));
    expect(screen.getByText(/Pablo Eduardo Ojeda Vasco/)).toBeInTheDocument();
  });

  it('contains NIF "12387725V"', () => {
    render(React.createElement(PrivacidadPage));
    expect(screen.getByText(/12387725V/)).toBeInTheDocument();
  });

  it('contains address "Calle Luis Morote 41"', () => {
    render(React.createElement(PrivacidadPage));
    expect(screen.getByText(/Calle Luis Morote 41/)).toBeInTheDocument();
  });

  it('contains contact email "privacidad@nutrixplorer.com"', () => {
    render(React.createElement(PrivacidadPage));
    const emails = screen.getAllByText(/privacidad@nutrixplorer\.com/i);
    expect(emails.length).toBeGreaterThan(0);
  });

  it('does NOT contain any "[" placeholder marker', () => {
    const { container } = render(React.createElement(PrivacidadPage));
    expect(container.textContent).not.toMatch(/\[/);
  });
});

describe('F059 C1 — AvisoLegalPage contains real personal data', () => {
  it('contains "Pablo Eduardo Ojeda Vasco"', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByText(/Pablo Eduardo Ojeda Vasco/)).toBeInTheDocument();
  });

  it('contains NIF "12387725V"', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByText(/12387725V/)).toBeInTheDocument();
  });

  it('contains address "Calle Luis Morote 41"', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByText(/Calle Luis Morote 41/)).toBeInTheDocument();
  });

  it('contains contact email "hola@nutrixplorer.com"', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByText(/hola@nutrixplorer\.com/i)).toBeInTheDocument();
  });

  it('does NOT contain any "[" placeholder marker', () => {
    const { container } = render(React.createElement(AvisoLegalPage));
    expect(container.textContent).not.toMatch(/\[/);
  });
});

// ---------------------------------------------------------------------------
// F059 C2: "Gestionar cookies" button in all legal page standalone footers
// ---------------------------------------------------------------------------
describe('F059 C2 — Legal page standalone footers render "Gestionar cookies"', () => {
  it('PrivacidadPage standalone footer renders "Gestionar cookies"', () => {
    render(React.createElement(PrivacidadPage));
    expect(screen.getByRole('button', { name: 'Gestionar cookies' })).toBeInTheDocument();
  });

  it('AvisoLegalPage standalone footer renders "Gestionar cookies"', () => {
    render(React.createElement(AvisoLegalPage));
    expect(screen.getByRole('button', { name: 'Gestionar cookies' })).toBeInTheDocument();
  });

  it('CookiesPage standalone footer renders "Gestionar cookies"', () => {
    render(React.createElement(CookiesPage));
    expect(screen.getByRole('button', { name: 'Gestionar cookies' })).toBeInTheDocument();
  });
});
