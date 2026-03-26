import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProblemSection } from '@/components/sections/ProblemSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('ProblemSection', () => {
  it('renders the eyebrow text', () => {
    render(<ProblemSection dict={dict.problem} />);
    expect(screen.getByText(dict.problem.eyebrow)).toBeInTheDocument();
  });

  it('renders the H2 headline', () => {
    render(<ProblemSection dict={dict.problem} />);
    expect(
      screen.getByRole('heading', { level: 2, name: dict.problem.headline })
    ).toBeInTheDocument();
  });

  it('renders all 3 paragraphs', () => {
    render(<ProblemSection dict={dict.problem} />);
    expect(screen.getByText(dict.problem.p1)).toBeInTheDocument();
    expect(screen.getByText(dict.problem.p2)).toBeInTheDocument();
    expect(screen.getByText(dict.problem.p3)).toBeInTheDocument();
  });
});
