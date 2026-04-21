import React from 'react';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../components/EmptyState';

describe('EmptyState', () => {
  it('renders the headline "¿Qué quieres saber?"', () => {
    render(<EmptyState />);
    expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
  });

  it('renders subtext mentioning the three input modalities (text, voice, photo)', () => {
    render(<EmptyState />);
    expect(
      screen.getByText(/Escribe, habla o sube una foto/i),
    ).toBeInTheDocument();
  });
});
