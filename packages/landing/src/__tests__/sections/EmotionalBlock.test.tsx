import React from 'react';
import { render, screen } from '@testing-library/react';
import { EmotionalBlock } from '@/components/sections/EmotionalBlock';
import { getDictionary } from '@/lib/i18n';

// Mock next/image
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

const dict = getDictionary('es');

describe('EmotionalBlock', () => {
  it('renders the section headline', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    expect(screen.getByText(dict.emotionalBlock.headline)).toBeInTheDocument();
  });

  it('renders all scenarios', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    for (const scenario of dict.emotionalBlock.scenarios) {
      expect(screen.getByText(scenario.scene)).toBeInTheDocument();
      expect(screen.getByText(scenario.description)).toBeInTheDocument();
    }
  });

  it('renders at least one image', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThan(0);
  });

  it('image has descriptive alt text', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => {
      expect(img).toHaveAttribute('alt');
      expect(img.getAttribute('alt')).not.toBe('');
    });
  });
});
