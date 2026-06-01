// TDD tests for PhotoModeToggle (F-WEB-MENU-VISION-001).
// Segmented pill control for photo analysis mode selection.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoModeToggle } from '../../components/PhotoModeToggle';

describe('PhotoModeToggle', () => {
  it('renders "Menú/carta" as active (aria-pressed=true) when value="auto"', () => {
    render(
      <PhotoModeToggle
        value="auto"
        onChange={jest.fn()}
      />
    );

    const menuBtn = screen.getByRole('button', { name: 'Menú/carta' });
    const soloBtn = screen.getByRole('button', { name: 'Solo este plato' });

    expect(menuBtn).toHaveAttribute('aria-pressed', 'true');
    expect(soloBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with "identify" when "Solo este plato" is clicked', async () => {
    const onChange = jest.fn();
    render(
      <PhotoModeToggle
        value="auto"
        onChange={onChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Solo este plato' }));

    expect(onChange).toHaveBeenCalledWith('identify');
  });

  it('calls onChange with "auto" when "Menú/carta" is clicked while identify is active', async () => {
    const onChange = jest.fn();
    render(
      <PhotoModeToggle
        value="identify"
        onChange={onChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Menú/carta' }));

    expect(onChange).toHaveBeenCalledWith('auto');
  });

  it('both buttons are disabled when disabled=true', () => {
    render(
      <PhotoModeToggle
        value="auto"
        onChange={jest.fn()}
        disabled={true}
      />
    );

    expect(screen.getByRole('button', { name: 'Menú/carta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Solo este plato' })).toBeDisabled();
  });

  it('does NOT call onChange when disabled', async () => {
    const onChange = jest.fn();
    render(
      <PhotoModeToggle
        value="auto"
        onChange={onChange}
        disabled={true}
      />
    );

    // Click should be blocked by disabled attribute
    const soloBtn = screen.getByRole('button', { name: 'Solo este plato' });
    // Directly dispatch to bypass disabled check in userEvent
    soloBtn.click();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('container has role=group and aria-label', () => {
    render(
      <PhotoModeToggle
        value="auto"
        onChange={jest.fn()}
      />
    );

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', 'Tipo de análisis de foto');
  });

  // F-WEB-HISTORY-FU1 item D — toggle order swap: "Solo este plato" on the LEFT
  // (single-dish path is the common case per owner). The two existing aria-pressed
  // tests above still pass because they query by name, not position.
  it('AC14: renders buttons in order [Solo este plato | Menú/carta] (DOM order)', () => {
    render(<PhotoModeToggle value="identify" onChange={jest.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Solo este plato');
    expect(buttons[1]).toHaveTextContent('Menú/carta');
  });

  it('AC15: when value="identify" (the new default), Solo este plato is active', () => {
    render(<PhotoModeToggle value="identify" onChange={jest.fn()} />);
    const soloBtn = screen.getByRole('button', { name: 'Solo este plato' });
    const menuBtn = screen.getByRole('button', { name: 'Menú/carta' });
    expect(soloBtn).toHaveAttribute('aria-pressed', 'true');
    expect(menuBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
