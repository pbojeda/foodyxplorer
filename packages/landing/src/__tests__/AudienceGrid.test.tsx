import React from 'react';
import { render, screen } from '@testing-library/react';
import { AudienceGrid } from '@/components/AudienceGrid';

jest.mock('next/image', () => {
  return function MockImage({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...props} />;
  };
});

describe('AudienceGrid', () => {
  it('renders 4 audience cards', () => {
    render(<AudienceGrid />);
    const cards = screen.getAllByText(/empieza si tú eres…/i);
    expect(cards).toHaveLength(4);
  });

  it('renders card for macro trackers', () => {
    render(<AudienceGrid />);
    expect(screen.getByText(/quien cuenta macros/i)).toBeInTheDocument();
  });

  it('renders card for allergen management', () => {
    render(<AudienceGrid />);
    expect(screen.getByText(/quien evita alérgenos/i)).toBeInTheDocument();
  });

  it('renders card for balance seekers', () => {
    render(<AudienceGrid />);
    expect(screen.getByText(/quien busca equilibrio/i)).toBeInTheDocument();
  });

  it('renders card for on-the-go deciders', () => {
    render(<AudienceGrid />);
    expect(screen.getByText(/quien decide sobre la marcha/i)).toBeInTheDocument();
  });

  it('renders CTA links on each card', () => {
    render(<AudienceGrid />);
    const ctaLinks = screen.getAllByRole('link');
    expect(ctaLinks).toHaveLength(4);
  });

  it('renders image backgrounds for each card', () => {
    render(<AudienceGrid />);
    // Each card should have an image
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(4);
  });
});
