// HistoryPersistenceNudge tests — AC37 (conditions), AC52 (telemetry)
// AC52: fires history_persistence_nudge_shown on mount,
//       history_persistence_nudge_cta on CTA click,
//       history_persistence_nudge_dismissed on dismiss.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { HistoryPersistenceNudge } from '../../components/HistoryPersistenceNudge';
import { trackEvent } from '../../lib/metrics';

const mockTrackEvent = trackEvent as jest.Mock;

// Mock window.location.href assignment
const mockLocationHref = jest.fn();
Object.defineProperty(window, 'location', {
  value: { href: '', assign: mockLocationHref },
  writable: true,
  configurable: true,
});

describe('HistoryPersistenceNudge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders heading and body copy', () => {
    render(<HistoryPersistenceNudge onDismiss={jest.fn()} />);
    expect(screen.getByText('Guarda tu historial entre sesiones')).toBeInTheDocument();
    expect(screen.getByText(/regístrate para no perder tus consultas/i)).toBeInTheDocument();
  });

  it('renders CTA button "Crear cuenta gratis"', () => {
    render(<HistoryPersistenceNudge onDismiss={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Crear cuenta gratis' })).toBeInTheDocument();
  });

  it('renders dismiss button with aria-label "Cerrar sugerencia"', () => {
    render(<HistoryPersistenceNudge onDismiss={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Cerrar sugerencia' })).toBeInTheDocument();
  });

  // AC52: history_persistence_nudge_shown on mount
  it('AC52: fires history_persistence_nudge_shown on mount', () => {
    render(<HistoryPersistenceNudge onDismiss={jest.fn()} />);
    expect(mockTrackEvent).toHaveBeenCalledWith('history_persistence_nudge_shown');
  });

  // AC52: history_persistence_nudge_dismissed on dismiss click
  it('AC52: fires history_persistence_nudge_dismissed on dismiss and calls onDismiss', async () => {
    const onDismiss = jest.fn();
    render(<HistoryPersistenceNudge onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sugerencia' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('history_persistence_nudge_dismissed');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // AC52: history_persistence_nudge_cta on CTA click
  it('AC52: fires history_persistence_nudge_cta on CTA click', async () => {
    render(<HistoryPersistenceNudge onDismiss={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta gratis' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('history_persistence_nudge_cta');
  });
});
