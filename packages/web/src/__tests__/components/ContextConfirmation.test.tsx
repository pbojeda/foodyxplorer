import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContextConfirmation } from '../../components/ContextConfirmation';

describe('ContextConfirmation', () => {
  it('shows context chain name when contextSet is provided', () => {
    render(
      <ContextConfirmation
        contextSet={{ chainSlug: 'mcdonalds-es', chainName: "McDonald's España" }}
        ambiguous={false}
      />
    );
    expect(screen.getByText(/McDonald's España/i)).toBeInTheDocument();
  });

  it('shows "Contexto activo:" label with the chain name', () => {
    render(
      <ContextConfirmation
        contextSet={{ chainSlug: 'mcdonalds-es', chainName: "McDonald's España" }}
        ambiguous={false}
      />
    );
    expect(screen.getByText(/Contexto activo:/i)).toBeInTheDocument();
  });

  it('shows ambiguity message when ambiguous is true', () => {
    render(<ContextConfirmation contextSet={undefined} ambiguous={true} />);
    expect(screen.getByText(/No encontré ese restaurante/i)).toBeInTheDocument();
  });

  it('suggests trying exact name in ambiguity state', () => {
    render(<ContextConfirmation contextSet={undefined} ambiguous={true} />);
    expect(screen.getByText(/Prueba con el nombre exacto/i)).toBeInTheDocument();
  });
});
