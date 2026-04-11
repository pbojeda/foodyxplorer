/**
 * @jest-environment jsdom
 *
 * F093 — HablarAnalytics component tests
 *
 * Tests that hablar_page_view is pushed to window.dataLayer on mount,
 * with UTM params when present in URL, without when absent.
 */
import React from 'react';
import { render, act } from '@testing-library/react';

// Mock next/navigation before importing the component
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

import { HablarAnalytics } from '../../components/HablarAnalytics';
import { useSearchParams } from 'next/navigation';

const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;

describe('HablarAnalytics', () => {
  beforeEach(() => {
    // Reset dataLayer before each test
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
    jest.clearAllMocks();
  });

  it('pushes hablar_page_view to window.dataLayer on mount (no UTM params)', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());

    await act(async () => {
      render(<HablarAnalytics />);
    });

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'hablar_page_view' }),
      ])
    );
  });

  it('includes utm_source and utm_medium when present in search params', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('utm_source=landing&utm_medium=hero_cta')
    );

    await act(async () => {
      render(<HablarAnalytics />);
    });

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'hablar_page_view',
          utm_source: 'landing',
          utm_medium: 'hero_cta',
        }),
      ])
    );
  });

  it('includes utm_campaign when present in search params', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('utm_source=landing&utm_medium=header_cta&utm_campaign=spring')
    );

    await act(async () => {
      render(<HablarAnalytics />);
    });

    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'hablar_page_view',
          utm_source: 'landing',
          utm_medium: 'header_cta',
          utm_campaign: 'spring',
        }),
      ])
    );
  });

  it('fires hablar_page_view without utm fields when params are absent', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());

    await act(async () => {
      render(<HablarAnalytics />);
    });

    const event = ((window as Window & { dataLayer?: unknown[] }).dataLayer ?? []).find(
      (e) => (e as { event: string }).event === 'hablar_page_view'
    ) as Record<string, unknown> | undefined;

    expect(event).toBeDefined();
    expect(event!['utm_source']).toBeUndefined();
    expect(event!['utm_medium']).toBeUndefined();
    expect(event!['utm_campaign']).toBeUndefined();
  });

  it('initializes dataLayer if undefined (guarantees queue exists before gtag loads)', async () => {
    // Simulate window.dataLayer being absent
    delete (window as Window & { dataLayer?: unknown[] }).dataLayer;

    mockUseSearchParams.mockReturnValue(new URLSearchParams());

    await act(async () => {
      render(<HablarAnalytics />);
    });

    // After render, dataLayer should be initialized and contain the event
    expect((window as Window & { dataLayer?: unknown[] }).dataLayer).toBeDefined();
    expect(
      ((window as Window & { dataLayer?: unknown[] }).dataLayer ?? []).some(
        (e) => (e as { event: string }).event === 'hablar_page_view'
      )
    ).toBe(true);
  });

  it('renders null (no DOM output)', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    const { container } = render(<HablarAnalytics />);
    expect(container.firstChild).toBeNull();
  });
});
