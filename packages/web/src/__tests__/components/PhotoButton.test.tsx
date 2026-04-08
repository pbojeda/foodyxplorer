// PhotoButton basic rendering tests (F092 — active state).
// Full interactive behavior is tested in PhotoButton.photo.test.tsx.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { PhotoButton } from '../../components/PhotoButton';

describe('PhotoButton', () => {
  it('has aria-label "Subir foto del plato"', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Subir foto del plato');
  });

  it('is NOT disabled by default', () => {
    render(<PhotoButton onFileSelect={jest.fn()} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('is disabled when isLoading=true', () => {
    render(<PhotoButton onFileSelect={jest.fn()} isLoading={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
