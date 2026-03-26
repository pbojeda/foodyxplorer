import React from 'react';
import { render, screen } from '@testing-library/react';
import { EmotionalBlock } from '@/components/sections/EmotionalBlock';
import { getDictionary } from '@/lib/i18n';

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

  it('renders scenario items with CheckCircle2 icons', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    // Each scenario has a CheckCircle2 icon (mocked as span[data-testid])
    const icons = screen.getAllByTestId('icon-CheckCircle2');
    expect(icons.length).toBe(dict.emotionalBlock.scenarios.length);
  });

  it('renders section as a landmark', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('renders the food photo image', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    const img = screen.getByAltText(/amigos/i);
    expect(img).toBeInTheDocument();
  });

  it('renders the quote block', () => {
    render(<EmotionalBlock dict={dict.emotionalBlock} />);
    expect(screen.getByText(dict.emotionalBlock.quote)).toBeInTheDocument();
  });
});
