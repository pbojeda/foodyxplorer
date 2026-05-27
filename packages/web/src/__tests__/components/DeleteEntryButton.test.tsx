// DeleteEntryButton tests — AC41, AC42, AC50
// AC41: idle→confirming toggle; Cancel reverts; Confirm calls onConfirm(entryId)
// AC42: 5s auto-revert via jest.useFakeTimers
// AC50: trackEvent('history_entry_deleted', { entryId, inputMode }) on confirm

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { DeleteEntryButton } from '../../components/DeleteEntryButton';
import { trackEvent } from '../../lib/metrics';

const mockTrackEvent = trackEvent as jest.Mock;

const defaultProps = {
  entryId: 'entry-uuid-001',
  queryText: 'tortilla española',
  inputMode: 'text' as const,
  onConfirm: jest.fn(),
};

describe('DeleteEntryButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // AC41: initial state shows trash button
  it('AC41: renders trash button in idle state', () => {
    render(<DeleteEntryButton {...defaultProps} />);
    expect(screen.getByRole('button', { name: /eliminar consulta/i })).toBeInTheDocument();
    expect(screen.queryByText('¿Eliminar?')).not.toBeInTheDocument();
  });

  // AC41: clicking trash shows confirm row
  it('AC41: clicking trash button shows confirm row', async () => {
    render(<DeleteEntryButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    // Trash button should not be visible
    expect(screen.queryByRole('button', { name: /eliminar consulta/i })).not.toBeInTheDocument();
  });

  // AC41: Cancel reverts to idle
  it('AC41: Cancel button reverts to idle state', async () => {
    render(<DeleteEntryButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: /eliminar consulta/i })).toBeInTheDocument();
    expect(screen.queryByText('¿Eliminar?')).not.toBeInTheDocument();
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  // AC41: Confirm calls onConfirm(entryId)
  it('AC41: Confirm button calls onConfirm with entryId', async () => {
    render(<DeleteEntryButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('entry-uuid-001');
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  // AC42: 5s auto-revert
  it('AC42: confirms row auto-reverts to idle after 5 seconds', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<DeleteEntryButton {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByRole('button', { name: /eliminar consulta/i })).toBeInTheDocument();
    expect(screen.queryByText('¿Eliminar?')).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  // AC42: timer does not fire before 5s
  it('AC42: confirm row still visible before 5 seconds elapse', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<DeleteEntryButton {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /eliminar consulta/i }));

    act(() => {
      jest.advanceTimersByTime(4999);
    });

    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument();
    jest.useRealTimers();
  });

  // Escape key cancels confirm row
  it('Escape key cancels the confirm row', async () => {
    render(<DeleteEntryButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /eliminar consulta/i })).toBeInTheDocument();
    expect(screen.queryByText('¿Eliminar?')).not.toBeInTheDocument();
  });

  // AC50: trackEvent called on confirm
  it('AC50: trackEvent history_entry_deleted fired on confirm with correct payload', async () => {
    render(<DeleteEntryButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('history_entry_deleted', {
      entryId: 'entry-uuid-001',
      inputMode: 'text',
    });
  });

  // AC50: voice inputMode forwarded to trackEvent
  it('AC50: voice inputMode forwarded correctly', async () => {
    render(
      <DeleteEntryButton
        {...defaultProps}
        inputMode="voice"
        entryId="voice-entry-001"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /eliminar consulta/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('history_entry_deleted', {
      entryId: 'voice-entry-001',
      inputMode: 'voice',
    });
  });

  // aria-label includes truncated query text
  it('aria-label shows truncated query when over 40 chars', () => {
    const longQuery = 'a'.repeat(50);
    render(<DeleteEntryButton {...defaultProps} queryText={longQuery} />);
    const btn = screen.getByRole('button', { name: /eliminar consulta/i });
    expect(btn).toHaveAttribute('aria-label', `Eliminar consulta: ${'a'.repeat(40)}…`);
  });
});
