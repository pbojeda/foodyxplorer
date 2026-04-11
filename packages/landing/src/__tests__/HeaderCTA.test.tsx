/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

// Import after mocks
import { HeaderCTA } from '@/components/HeaderCTA';

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<typeof analytics.trackEvent>;

describe('HeaderCTA', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  describe('when hablarBaseUrl is null (fallback)', () => {
    it('renders a link with href="#waitlist"', () => {
      render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
      const link = screen.getByRole('link', { name: /probar gratis/i });
      expect(link).toHaveAttribute('href', '#waitlist');
    });

    it('does NOT set target="_blank" on fallback link', () => {
      render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
      const link = screen.getByRole('link', { name: /probar gratis/i });
      expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('does NOT fire trackEvent when fallback link is clicked', async () => {
      const user = userEvent.setup();
      render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
      await user.click(screen.getByRole('link', { name: /probar gratis/i }));
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  describe('when hablarBaseUrl is set', () => {
    const baseUrl = 'https://hablar.nutrixplorer.com/hablar';

    it('renders a link with UTM-appended href', () => {
      render(<HeaderCTA hablarBaseUrl={baseUrl} variant="a" />);
      const link = screen.getByRole('link', { name: /probar gratis/i });
      expect(link).toHaveAttribute(
        'href',
        `${baseUrl}?utm_source=landing&utm_medium=header_cta`
      );
    });

    it('sets target="_blank" and rel="noopener noreferrer"', () => {
      render(<HeaderCTA hablarBaseUrl={baseUrl} variant="a" />);
      const link = screen.getByRole('link', { name: /probar gratis/i });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('fires cta_hablar_click with source="header" on click', async () => {
      const user = userEvent.setup();
      render(<HeaderCTA hablarBaseUrl={baseUrl} variant="a" />);
      await user.click(screen.getByRole('link', { name: /probar gratis/i }));
      expect(mockTrackEvent).toHaveBeenCalledWith({
        event: 'cta_hablar_click',
        source: 'header',
        variant: 'a',
        lang: 'es',
        utm_medium: 'header_cta',
      });
    });

    it('fires analytics with correct variant when variant="f"', async () => {
      const user = userEvent.setup();
      render(<HeaderCTA hablarBaseUrl={baseUrl} variant="f" />);
      await user.click(screen.getByRole('link', { name: /probar gratis/i }));
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'f' })
      );
    });
  });

  it('applies the correct button styling class', () => {
    render(<HeaderCTA hablarBaseUrl={null} variant="a" />);
    const link = screen.getByRole('link', { name: /probar gratis/i });
    expect(link).toHaveClass('rounded-full', 'bg-botanical');
  });
});
