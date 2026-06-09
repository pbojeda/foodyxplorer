// TranscriptEntry tests — AC33, AC35, AC60
// AC33: role="article", aria-label, modality icon, timestamp, "Guardado" badge
// AC35: result body renders correct card for each intent
// AC60: persisted entries with resultData re-render correctly

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntryData } from '../../types/history';
import { createConversationMessageData, createEstimateData } from '../fixtures';

// ---------------------------------------------------------------------------
// Module mocks — keep tests focused on TranscriptEntry, not child components
// ---------------------------------------------------------------------------

jest.mock('../../components/NutritionCard', () => ({
  NutritionCard: ({ estimateData }: { estimateData?: unknown; reverseResult?: unknown }) => (
    <div data-testid="nutrition-card">{JSON.stringify(estimateData ?? 'reverse')}</div>
  ),
}));

jest.mock('../../components/ContextConfirmation', () => ({
  ContextConfirmation: () => <div data-testid="context-confirmation" />,
}));

jest.mock('../../components/MenuDishList', () => ({
  MenuDishList: () => <div data-testid="menu-dish-list" />,
}));

jest.mock('../../lib/metrics', () => ({
  trackEvent: jest.fn(),
  flushMetrics: jest.fn(),
}));

import { TranscriptEntry } from '../../components/TranscriptEntry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TranscriptEntryData> = {}): TranscriptEntryData {
  return {
    entryId: 'entry-001',
    queryText: 'tortilla española',
    inputMode: 'text',
    timestamp: new Date('2026-05-27T13:42:00'),
    isLoading: false,
    result: null,
    photoData: null,
    error: null,
    isPersisted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TranscriptEntry', () => {
  // AC33: role="article" and aria-label
  it('AC33: has role="article" and aria-label with query text', () => {
    render(<TranscriptEntry entry={makeEntry()} />);
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', 'tortilla española — resultado');
  });

  // AC33: aria-label truncates long queries
  it('AC33: aria-label truncates query over 40 chars', () => {
    const longQuery = 'a'.repeat(50);
    render(<TranscriptEntry entry={makeEntry({ queryText: longQuery })} />);
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', `${'a'.repeat(40)}… — resultado`);
  });

  // AC33: aria-busy when loading
  it('AC33: aria-busy=true when isLoading', () => {
    render(<TranscriptEntry entry={makeEntry({ isLoading: true })} />);
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
  });

  // AC33: no aria-busy when not loading
  it('AC33: aria-busy absent when not loading', () => {
    render(<TranscriptEntry entry={makeEntry({ isLoading: false })} />);
    const article = screen.getByRole('article');
    expect(article).not.toHaveAttribute('aria-busy');
  });

  // AC33: query text shown in header
  it('AC33: shows query text in header', () => {
    render(<TranscriptEntry entry={makeEntry()} />);
    expect(screen.getByText('tortilla española')).toBeInTheDocument();
  });

  // BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL Bug 2: query echo wraps to 2 lines
  // (no longer single-line ellipsis via `truncate`)
  it('Bug 2 fix: query text span uses line-clamp-2 (2-line wrap), not truncate', () => {
    render(<TranscriptEntry entry={makeEntry({ queryText: 'tortilla española' })} />);
    const span = screen.getByText('tortilla española');
    // Bug 2 fix: classes that allow 2-line wrap + bounded height
    expect(span.className).toContain('line-clamp-2');
    expect(span.className).toContain('break-words');
    expect(span.className).toContain('min-w-0');
    // Regression guard: must NOT be the single-line `truncate` class
    expect(span.className).not.toMatch(/\btruncate\b/);
  });

  // BUG-WEB-FU7-HEADER-AND-MOBILE-SCROLL Bug 2: title attribute preserves
  // full text on hover (existing behavior unchanged by the className swap)
  it('Bug 2 fix: title attribute still exposes full query text on hover', () => {
    const longQuery = 'una consulta extremadamente larga que excedería dos líneas en pantalla típica de móvil y desktop';
    render(<TranscriptEntry entry={makeEntry({ queryText: longQuery })} />);
    const span = screen.getByText(longQuery);
    expect(span).toHaveAttribute('title', longQuery);
  });

  // AC33: "Guardado" badge only for isPersisted entries
  it('AC33: "Guardado" badge shown for isPersisted=true', () => {
    render(<TranscriptEntry entry={makeEntry({ isPersisted: true })} />);
    expect(screen.getByText('Guardado')).toBeInTheDocument();
  });

  it('AC33: "Guardado" badge NOT shown for isPersisted=false', () => {
    render(<TranscriptEntry entry={makeEntry({ isPersisted: false })} />);
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument();
  });

  // AC33: microphone icon for voice entries
  it('AC33: microphone icon for voice inputMode', () => {
    render(<TranscriptEntry entry={makeEntry({ inputMode: 'voice' })} />);
    // SVG microphone path
    const svgs = document.querySelectorAll('svg[aria-hidden="true"]');
    // At least one SVG should be present (mic icon)
    expect(svgs.length).toBeGreaterThan(0);
  });

  // Shimmer shown when loading
  it('shows shimmer when isLoading=true', () => {
    render(<TranscriptEntry entry={makeEntry({ isLoading: true })} />);
    // Check shimmer element is rendered (aria-hidden div)
    const shimmer = document.querySelector('.shimmer-element');
    expect(shimmer).toBeInTheDocument();
  });

  // AC35: error state renders alert with message and retry button
  it('AC35: error state shows error message and Reintentar button', () => {
    const onRetry = jest.fn();
    render(
      <TranscriptEntry
        entry={makeEntry({ error: 'Sin conexión. Comprueba tu red.' })}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Sin conexión. Comprueba tu red.')).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });

  it('AC35: retry button calls onRetry with queryText', async () => {
    const onRetry = jest.fn();
    render(
      <TranscriptEntry
        entry={makeEntry({ error: 'Error', queryText: 'tortilla' })}
        onRetry={onRetry}
      />
    );
    await userEvent.click(screen.getByText('Reintentar'));
    expect(onRetry).toHaveBeenCalledWith('tortilla');
  });

  // AC35/AC60: estimation result renders NutritionCard
  it('AC35: estimation intent renders NutritionCard', () => {
    const resultData = createConversationMessageData('estimation');
    render(
      <TranscriptEntry
        entry={makeEntry({ result: resultData, isPersisted: true })}
      />
    );
    expect(screen.getByTestId('nutrition-card')).toBeInTheDocument();
  });

  // AC35/AC60: comparison renders two NutritionCards
  it('AC35: comparison intent renders two NutritionCards', () => {
    const resultData = createConversationMessageData('comparison');
    render(
      <TranscriptEntry
        entry={makeEntry({ result: resultData })}
      />
    );
    expect(screen.getAllByTestId('nutrition-card')).toHaveLength(2);
  });

  // AC35/AC60: context_set renders ContextConfirmation
  it('AC60: context_set intent renders ContextConfirmation', () => {
    const resultData = createConversationMessageData('context_set');
    render(
      <TranscriptEntry
        entry={makeEntry({ result: resultData, isPersisted: true })}
      />
    );
    expect(screen.getByTestId('context-confirmation')).toBeInTheDocument();
  });

  // DeleteEntryButton shown only for isPersisted entries with onDelete
  it('shows DeleteEntryButton for isPersisted entry when onDelete provided', () => {
    const onDelete = jest.fn();
    render(
      <TranscriptEntry
        entry={makeEntry({ isPersisted: true })}
        onDelete={onDelete}
      />
    );
    expect(screen.getByRole('button', { name: /eliminar consulta/i })).toBeInTheDocument();
  });

  it('does NOT show DeleteEntryButton for session-only entry', () => {
    const onDelete = jest.fn();
    render(
      <TranscriptEntry
        entry={makeEntry({ isPersisted: false })}
        onDelete={onDelete}
      />
    );
    expect(screen.queryByRole('button', { name: /eliminar consulta/i })).not.toBeInTheDocument();
  });
});
