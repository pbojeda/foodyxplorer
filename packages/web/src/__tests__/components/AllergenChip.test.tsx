import React from 'react';
import { render, screen } from '@testing-library/react';
import { AllergenChip } from '../../components/AllergenChip';

describe('AllergenChip', () => {
  it('renders the allergen label', () => {
    render(<AllergenChip allergen="Gluten" />);
    expect(screen.getByText(/Gluten/i)).toBeInTheDocument();
  });

  it('renders a warning indicator', () => {
    const { container } = render(<AllergenChip allergen="Leche" />);
    // The warning icon (⚠ or SVG) should be in the chip
    expect(container.textContent).toContain('⚠');
  });

  it('applies red styling classes', () => {
    const { container } = render(<AllergenChip allergen="Gluten" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain('red');
  });
});
