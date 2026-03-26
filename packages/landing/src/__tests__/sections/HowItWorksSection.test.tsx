import React from 'react';
import { render, screen } from '@testing-library/react';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { getDictionary } from '@/lib/i18n';

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
});
