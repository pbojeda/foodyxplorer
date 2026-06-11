// F-ADMIN-ANALYTICS-UI — AdminLayout tests.
// Tests: sidebar renders, active link detection, topbar renders.

import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockPathname = '/admin/analytics';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

jest.mock('../../lib/i18n/useT', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'layout.brandName': 'nutriXplorer',
      'layout.adminSuffix': 'admin',
      'layout.navAnalytics': 'Analytics',
    };
    return map[key] ?? key;
  },
}));

import { AdminLayout } from '../../components/admin/AdminLayout';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminLayout', () => {
  beforeEach(() => {
    mockPathname = '/admin/analytics';
    jest.clearAllMocks();
  });

  it('renders the sidebar wordmark "nutriXplorer admin"', () => {
    render(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    // Multiple instances (sidebar + topbar)
    const wordmarks = screen.getAllByText(/nutriXplorer/);
    expect(wordmarks.length).toBeGreaterThan(0);
  });

  it('Analytics nav link has aria-current="page" when on /admin/analytics', () => {
    render(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    const navLink = screen.getByRole('link', { name: /analytics/i });
    expect(navLink).toHaveAttribute('aria-current', 'page');
  });

  it('Analytics nav link does NOT have aria-current when on different path', () => {
    mockPathname = '/admin/other';
    render(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    const navLink = screen.getByRole('link', { name: /analytics/i });
    expect(navLink).not.toHaveAttribute('aria-current');
  });

  it('renders topbar with admin suffix (tablet/phone visibility)', () => {
    render(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    // TopBar has "nutriXplorer" + "admin" text (separate spans)
    const allAdminText = screen.getAllByText(/admin/i);
    expect(allAdminText.length).toBeGreaterThan(0);
  });

  it('renders children in the main content area', () => {
    render(
      <AdminLayout>
        <div data-testid="child-content">Child content</div>
      </AdminLayout>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });
});
