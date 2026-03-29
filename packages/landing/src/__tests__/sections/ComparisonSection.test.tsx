import React from 'react';
import { render, screen } from '@testing-library/react';
import { ComparisonSection } from '@/components/sections/ComparisonSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('ComparisonSection', () => {
  it('renders the section headline', () => {
    render(<ComparisonSection dict={dict.comparison} />);
    expect(screen.getByText(dict.comparison.headline)).toBeInTheDocument();
  });

  it('renders all 4 comparison cards', () => {
    render(<ComparisonSection dict={dict.comparison} />);
    for (const card of dict.comparison.cards) {
      expect(screen.getByText(card.title)).toBeInTheDocument();
      expect(screen.getByText(card.versus)).toBeInTheDocument();
      expect(screen.getByText(card.description)).toBeInTheDocument();
      expect(screen.getByText(card.advantage)).toBeInTheDocument();
    }
  });

  it('renders a heading level 2', () => {
    render(<ComparisonSection dict={dict.comparison} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});
