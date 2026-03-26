import React from 'react';
import { render, screen } from '@testing-library/react';
import { VisualDivider } from '@/components/VisualDivider';

jest.mock('next/image', () => {
  return function MockImage({ src, alt }: { src: string; alt: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  };
});

describe('VisualDivider', () => {
  it('renders without crashing', () => {
    const { container } = render(<VisualDivider />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('is aria-hidden (purely decorative)', () => {
    const { container } = render(<VisualDivider />);
    const divider = container.firstChild as HTMLElement;
    expect(divider.getAttribute('aria-hidden')).toBe('true');
  });
});
