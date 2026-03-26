import React from 'react';
import { render, screen } from '@testing-library/react';
import { ForWhoSection } from '@/components/sections/ForWhoSection';
import { getDictionary } from '@/lib/i18n';

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

  it('renders AudienceGrid with 4 audience cards', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    // AudienceGrid renders 4 "Empieza si tú eres…" labels
    const labels = screen.getAllByText(/empieza si tú eres/i);
    expect(labels).toHaveLength(4);
  });

  it('renders audience card for macro trackers', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    expect(screen.getByText(/quien cuenta macros/i)).toBeInTheDocument();
  });

  it('renders audience card for allergen management', () => {
    render(<ForWhoSection dict={dict.forWho} />);
    expect(screen.getByText(/quien evita alérgenos/i)).toBeInTheDocument();
  });
});
