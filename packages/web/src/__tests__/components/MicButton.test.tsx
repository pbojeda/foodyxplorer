import React from 'react';
import { render, screen } from '@testing-library/react';
import { MicButton } from '../../components/MicButton';

describe('MicButton', () => {
  it('is disabled', () => {
    render(<MicButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('has aria-label "Micrófono (próximamente)"', () => {
    render(<MicButton />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Micrófono (próximamente)');
  });

  it('has title "Próximamente"', () => {
    render(<MicButton />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Próximamente');
  });

  it('applies cursor-not-allowed class', () => {
    render(<MicButton />);
    expect(screen.getByRole('button').className).toContain('cursor-not-allowed');
  });
});
