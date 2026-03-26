import React from 'react';
import { render, screen } from '@testing-library/react';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { getDictionary } from '@/lib/i18n';

// Mock SearchSimulatorWithCTA (client component with complex dependencies)
jest.mock('@/components/features/SearchSimulatorWithCTA', () => ({
  SearchSimulatorWithCTA: () => <div data-testid="search-simulator-cta">Search Simulator CTA</div>,
}));

// Mock next/image
jest.mock('next/image', () => {
  return function MockImage({ src, alt }: { src: string; alt: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  };
});

const dict = getDictionary('es');

describe('HowItWorksSection', () => {
  it('renders all 3 steps', () => {
    render(<HowItWorksSection dict={dict.howItWorks} />);
    const steps = dict.howItWorks.steps;
    steps.forEach((step) => {
      expect(screen.getByText(step.title)).toBeInTheDocument();
    });
  });

  it('each step has a title and description', () => {
    render(<HowItWorksSection dict={dict.howItWorks} />);
    const steps = dict.howItWorks.steps;
    steps.forEach((step) => {
      expect(screen.getByText(step.title)).toBeInTheDocument();
      expect(screen.getByText(step.description)).toBeInTheDocument();
    });
  });

  it('renders the section headline', () => {
    render(<HowItWorksSection dict={dict.howItWorks} />);
    expect(
      screen.getByRole('heading', { level: 2, name: dict.howItWorks.headline })
    ).toBeInTheDocument();
  });

  it('renders the SearchSimulatorWithCTA', () => {
    render(<HowItWorksSection dict={dict.howItWorks} />);
    expect(screen.getByTestId('search-simulator-cta')).toBeInTheDocument();
  });

  it('renders no images — all steps have equal visual structure', () => {
    render(<HowItWorksSection dict={dict.howItWorks} />);
    // Images were removed from step 1 so all 3 cards have identical structure
    expect(screen.queryByAltText(/escaneo de menú/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
