import React from 'react';
import { render, screen } from '@testing-library/react';
import { LoadingState } from '../../components/LoadingState';

describe('LoadingState', () => {
  it('has role="status"', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessible label "Buscando información nutricional..."', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Buscando información nutricional...');
  });

  it('renders shimmer skeleton elements', () => {
    const { container } = render(<LoadingState />);
    const shimmerElements = container.querySelectorAll('.shimmer-element');
    expect(shimmerElements.length).toBeGreaterThan(0);
  });

  it('renders at least one skeleton card', () => {
    const { container } = render(<LoadingState />);
    // Look for skeleton card structure (div with shimmer elements inside)
    const cards = container.querySelectorAll('[data-testid="skeleton-card"]');
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });
});
