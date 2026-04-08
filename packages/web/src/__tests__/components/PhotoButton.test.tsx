import React from 'react';
import { render, screen } from '@testing-library/react';
import { PhotoButton } from '../../components/PhotoButton';

describe('PhotoButton', () => {
  it('is disabled', () => {
    render(<PhotoButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('has aria-label "Foto (próximamente)"', () => {
    render(<PhotoButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Foto (próximamente)');
  });

  it('has title "Próximamente"', () => {
    render(<PhotoButton />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Próximamente');
  });

  it('applies cursor-not-allowed class', () => {
    render(<PhotoButton />);
    expect(screen.getByRole('button').className).toContain('cursor-not-allowed');
  });
});
