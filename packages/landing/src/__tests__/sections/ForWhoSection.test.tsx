import React from 'react';
import { render, screen } from '@testing-library/react';
import { ForWhoSection } from '@/components/sections/ForWhoSection';
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

describe('ForWhoSection', () => {
  it('renders the section heading', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders eyebrow', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    expect(screen.getByText(dict.forWho.eyebrow)).toBeInTheDocument();
  });

  it('renders all 4 profile cards', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    for (const profile of dict.forWho.profiles) {
      expect(screen.getByText(profile.title)).toBeInTheDocument();
      expect(screen.getByText(profile.description)).toBeInTheDocument();
    }
  });

  it('renders profile images with alt text', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThanOrEqual(4);
    images.forEach((img) => {
      expect(img).toHaveAttribute('alt');
      expect(img.getAttribute('alt')).not.toBe('');
    });
  });
});
