import React from 'react';
import { render, screen } from '@testing-library/react';
import { TrustEngineSection } from '@/components/sections/TrustEngineSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('TrustEngineSection', () => {
  it('renders the section headline', () => {
    render(<TrustEngineSection dict={dict.trustEngine} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the eyebrow', () => {
    render(<TrustEngineSection dict={dict.trustEngine} />);
    expect(screen.getByText(dict.trustEngine.eyebrow)).toBeInTheDocument();
  });

  it('renders all 3 confidence level cards', () => {
    render(<TrustEngineSection dict={dict.trustEngine} />);
    for (const level of dict.trustEngine.levels) {
      expect(screen.getByText(level.title)).toBeInTheDocument();
      expect(screen.getByText(level.description)).toBeInTheDocument();
      expect(screen.getByText(level.badgeLabel)).toBeInTheDocument();
    }
  });

  it('renders allergen guardrail callout', () => {
    render(<TrustEngineSection dict={dict.trustEngine} />);
    expect(screen.getByText(dict.trustEngine.allergenTitle)).toBeInTheDocument();
    expect(screen.getByText(dict.trustEngine.allergenDescription)).toBeInTheDocument();
  });

  it('has dark background section', () => {
    const { container } = render(<TrustEngineSection dict={dict.trustEngine} />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-slate-950');
  });

  it('renders subtitle', () => {
    render(<TrustEngineSection dict={dict.trustEngine} />);
    expect(screen.getByText(dict.trustEngine.subtitle)).toBeInTheDocument();
  });
});
