import React from 'react';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../components/EmptyState';

describe('EmptyState', () => {
  it('renders the headline "¿Qué quieres saber?"', () => {
    render(<EmptyState />);
    expect(screen.getByText('¿Qué quieres saber?')).toBeInTheDocument();
  });

  it('renders the subtext about writing a dish name', () => {
    render(<EmptyState />);
    expect(screen.getByText(/Escribe el nombre de un plato/i)).toBeInTheDocument();
  });
});
