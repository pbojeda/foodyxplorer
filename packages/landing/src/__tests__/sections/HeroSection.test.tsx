import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { HeroSection } from '@/components/sections/HeroSection';
import { getDictionary } from '@/lib/i18n';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

// Mock framer-motion to avoid animation issues in tests
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 {...props}>{children}</h1>
    ),
  },
  useReducedMotion: () => false,
}));

// Mock next/image
jest.mock('next/image', () => {
  return function MockImage({
    src,
    alt,
    priority,
    ...props
  }: {
    src: string;
    alt: string;
    priority?: boolean;
    [key: string]: unknown;
  }) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        data-priority={priority ? 'true' : undefined}
        {...props}
      />
    );
  };
});

// Mock fetch for WaitlistForm inside HeroSection
global.fetch = jest.fn();

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<
  typeof analytics.trackEvent
>;

const dict = getDictionary('es');

describe('HeroSection', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it('renders variant A content when variant="a"', () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    expect(screen.getByText(dict.hero.headlineA)).toBeInTheDocument();
  });

  it('renders variant B content when variant="b"', () => {
    render(<HeroSection variant="b" dict={dict.hero} />);
    expect(screen.getByText(dict.hero.headlineB)).toBeInTheDocument();
  });

  it('fires landing_view on mount', async () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'landing_view' })
      );
    });
  });

  it('fires variant_assigned on mount', async () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'variant_assigned', variant: 'a' })
      );
    });
  });

  it('contains WaitlistForm', () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    expect(
      screen.getByRole('button', { name: /únete/i })
    ).toBeInTheDocument();
  });

  it('contains 3 trust pills', () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    expect(screen.getByText('Datos verificados')).toBeInTheDocument();
    expect(screen.getByText('Confianza visible')).toBeInTheDocument();
    expect(screen.getByText('Hecho en España')).toBeInTheDocument();
  });

  it('uses priority on hero image', () => {
    render(<HeroSection variant="a" dict={dict.hero} />);
    const img = screen.getAllByRole('img')[0];
    expect(img).toHaveAttribute('data-priority', 'true');
  });
});
