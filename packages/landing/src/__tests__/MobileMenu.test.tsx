/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileMenu } from '@/components/MobileMenu';

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
  }) {
    return <a href={href} onClick={onClick}>{children}</a>;
  };
});

const NAV_LINKS = [
  { label: 'Demo', href: '#demo' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'FAQ', href: '#faq' },
];

function setup() {
  return render(
    <MobileMenu navLinks={NAV_LINKS} ctaText="Probar gratis" mobileCta="Probar" />
  );
}

describe('MobileMenu', () => {
  it('renders the hamburger button', () => {
    setup();
    expect(screen.getByRole('button', { name: /menú/i })).toBeInTheDocument();
  });

  it('hamburger button has aria-expanded="false" by default', () => {
    setup();
    const btn = screen.getByRole('button', { name: /menú/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('hamburger button has aria-controls pointing to the panel id', () => {
    setup();
    const btn = screen.getByRole('button', { name: /menú/i });
    const panelId = btn.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });

  it('nav links are not visible before opening (panel closed)', () => {
    setup();
    // Panel is hidden — nav links should not be visible (hidden class or display:none)
    const panel = document.getElementById(
      screen.getByRole('button', { name: /menú/i }).getAttribute('aria-controls')!
    );
    expect(panel).toHaveClass('hidden');
  });

  it('clicking hamburger opens the menu and sets aria-expanded="true"', async () => {
    const user = userEvent.setup();
    setup();
    const btn = screen.getByRole('button', { name: /menú/i });
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicking hamburger opens the menu: nav links become visible', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    expect(screen.getByText('Demo')).toBeVisible();
    expect(screen.getByText('Cómo funciona')).toBeVisible();
  });

  it('clicking hamburger again closes the menu (aria-expanded back to "false")', async () => {
    const user = userEvent.setup();
    setup();
    const btn = screen.getByRole('button', { name: /menú/i });
    await user.click(btn);
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking a nav link closes the menu', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    // Click a nav link
    await user.click(screen.getByText('Demo'));
    expect(screen.getByRole('button', { name: /menú/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('pressing Escape closes the menu', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /menú/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking outside the menu panel closes it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    // Click outside
    await user.click(document.body);
    expect(screen.getByRole('button', { name: /menú/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders mobile CTA link inside panel', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    expect(screen.getByText('Probar')).toBeInTheDocument();
  });

  it('all nav links are rendered inside the panel', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /menú/i }));
    NAV_LINKS.forEach(({ label }) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F064 — A3 dynamic aria-label and focus management
// ---------------------------------------------------------------------------

describe('F064 — MobileMenu dynamic aria-label and focus management', () => {
  it('hamburger button label is "Abrir menú" when menu is closed', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeInTheDocument();
  });

  it('hamburger button label changes to "Cerrar menú" after opening', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toBeInTheDocument();
  });

  it('hamburger button label reverts to "Abrir menú" after closing via Escape', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toBeInTheDocument();
  });

  it('pressing Escape returns focus to the hamburger button', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await user.keyboard('{Escape}');
    const btn = screen.getByRole('button', { name: 'Abrir menú' });
    expect(document.activeElement).toBe(btn);
  });

  it('pressing Escape when menu is already closed does NOT move focus to the hamburger button', async () => {
    const user = userEvent.setup();
    setup();
    // Menu starts closed — press Escape without opening
    await user.keyboard('{Escape}');
    const btn = screen.getByRole('button', { name: 'Abrir menú' });
    expect(document.activeElement).not.toBe(btn);
  });

  it('clicking outside the menu does NOT return focus to the hamburger button', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    // Click outside
    await user.click(document.body);
    // Menu is closed, but focus should NOT be on the hamburger button
    const btn = screen.queryByRole('button', { name: 'Abrir menú' });
    expect(document.activeElement).not.toBe(btn);
  });

  it('clicking a nav link does NOT return focus to the hamburger button', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await user.click(screen.getByText('Demo'));
    const btn = screen.queryByRole('button', { name: 'Abrir menú' });
    expect(document.activeElement).not.toBe(btn);
  });
});
