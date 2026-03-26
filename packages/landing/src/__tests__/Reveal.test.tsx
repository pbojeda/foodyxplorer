import React from 'react';
import { render, screen } from '@testing-library/react';
import { Reveal } from '@/components/Reveal';

// Mock framer-motion to avoid animation issues in tests
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className} {...rest}>
        {children}
      </div>
    ),
  },
}));

describe('Reveal', () => {
  it('renders children', () => {
    render(
      <Reveal>
        <p>Hello world</p>
      </Reveal>
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(
      <Reveal className="custom-class">
        <span>content</span>
      </Reveal>
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders without delay prop', () => {
    render(
      <Reveal>
        <span>no delay</span>
      </Reveal>
    );
    expect(screen.getByText('no delay')).toBeInTheDocument();
  });
});
