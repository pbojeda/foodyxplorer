// ClearHistoryButton tests — AC43, AC44, AC51
// AC43: dialog opens with role="alertdialog", aria-modal, focus on Cancel.
// AC44: focus trap (Tab/Shift+Tab cycle), Escape closes.
// AC51: trackEvent('history_cleared') on confirm.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { ClearHistoryButton } from '../../components/ClearHistoryButton';
import { trackEvent } from '../../lib/metrics';

const mockTrackEvent = trackEvent as jest.Mock;

describe('ClearHistoryButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // AC43: trigger button shows initially
  it('AC43: renders trigger button', () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    expect(screen.getByRole('button', { name: /borrar todo el historial/i })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // AC43: clicking trigger opens dialog with role="alertdialog"
  it('AC43: clicking trigger opens alertdialog', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  // AC43: dialog has aria-modal="true"
  it('AC43: dialog has aria-modal=true', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
  });

  // AC43: dialog has aria-labelledby pointing to title
  it('AC43: dialog has aria-labelledby referencing title', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    const dialog = screen.getByRole('alertdialog');
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    const title = document.getElementById(labelledById!);
    expect(title).not.toBeNull();
    expect(title?.textContent).toMatch(/borrar todo el historial/i);
  });

  // AC43: Cancel button closes dialog without calling onConfirm
  it('AC43: Cancel button closes dialog without calling onConfirm', async () => {
    const onConfirm = jest.fn();
    render(<ClearHistoryButton onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // AC43: Confirm button calls onConfirm
  it('AC43: Confirm button calls onConfirm and closes dialog', async () => {
    const onConfirm = jest.fn();
    render(<ClearHistoryButton onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar todo' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // AC43: initial focus on Cancel button
  it('AC43: initial focus is on Cancel button when dialog opens', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    });
  });

  // AC44: Escape closes dialog
  it('AC44: Escape key closes dialog', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // AC44: Tab cycles from Cancel → Confirm
  it('AC44: Tab moves focus from Cancel to Confirm', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    });
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Borrar todo' }));
  });

  // AC44: Shift+Tab cycles from Confirm → Cancel
  it('AC44: Shift+Tab moves focus from Confirm to Cancel', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    // Move to Confirm first
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Borrar todo' }));
    // Shift+Tab back to Cancel
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
  });

  // AC51: trackEvent fired on confirm
  it('AC51: trackEvent history_cleared fired on confirm', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar todo' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('history_cleared');
  });

  // Dialog body text
  it('shows confirmation message in dialog', async () => {
    render(<ClearHistoryButton onConfirm={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /borrar todo el historial/i }));
    expect(screen.getByText(/esta acción no se puede deshacer/i)).toBeInTheDocument();
  });
});
