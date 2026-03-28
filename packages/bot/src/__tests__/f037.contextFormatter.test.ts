// F037 — contextFormatter unit tests
// TDD: tests written BEFORE implementation

import { describe, it, expect } from 'vitest';
import {
  formatContextConfirmation,
  formatContextView,
  formatContextCleared,
} from '../formatters/contextFormatter.js';
import type { BotStateChainContext } from '../lib/conversationState.js';

describe('formatContextConfirmation', () => {
  it('contains escaped chainName in bold', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    expect(result).toContain('*McDonalds*');
  });

  it('contains chainSlug in code span', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    expect(result).toContain('`mcdonalds-es`');
  });

  it('contains "Contexto establecido"', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    expect(result).toContain('Contexto establecido');
  });

  it('contains /estimar and /comparar mention', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    expect(result).toContain('/estimar');
    expect(result).toContain('/comparar');
  });

  it('escapes special chars in chainName (e.g. "Burger.King")', () => {
    const result = formatContextConfirmation('Burger.King', 'burger-king-es');
    // period must be escaped
    expect(result).toContain('Burger\\.King');
  });

  it('escapes hyphen in chainSlug (e.g. "mcdonalds-es")', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    // In code span context, hyphens don't need escaping, but test format
    expect(result).toContain('mcdonalds-es');
  });

  it('trailing period in sentence is escaped', () => {
    const result = formatContextConfirmation('McDonalds', 'mcdonalds-es');
    // The sentence ends with \. (escaped period)
    expect(result).toContain('\\.');
  });
});

describe('formatContextView', () => {
  const ctx: BotStateChainContext = {
    chainSlug: 'mcdonalds-es',
    chainName: 'McDonalds',
  };

  it('contains "Contexto activo"', () => {
    const result = formatContextView(ctx, 3600);
    expect(result).toContain('Contexto activo');
  });

  it('contains chainName in bold', () => {
    const result = formatContextView(ctx, 3600);
    expect(result).toContain('*McDonalds*');
  });

  it('contains chainSlug in code span', () => {
    const result = formatContextView(ctx, 3600);
    expect(result).toContain('`mcdonalds-es`');
  });

  it('remainingSeconds > 0 → shows hours and minutes', () => {
    const result = formatContextView(ctx, 3661); // 1h 1m 1s
    expect(result).toContain('1h');
    expect(result).toContain('1m');
  });

  it('remainingSeconds = 3600 → shows "1h 0m"', () => {
    const result = formatContextView(ctx, 3600);
    expect(result).toContain('1h');
    expect(result).toContain('0m');
  });

  it('remainingSeconds = 90 → shows "0h 1m"', () => {
    const result = formatContextView(ctx, 90);
    expect(result).toContain('0h');
    expect(result).toContain('1m');
  });

  it('remainingSeconds <= 0 → shows "Expira pronto" (not hours/minutes)', () => {
    const result = formatContextView(ctx, 0);
    expect(result).toContain('Expira pronto');
    expect(result).not.toContain('h ');
  });

  it('remainingSeconds negative → shows "Expira pronto"', () => {
    const result = formatContextView(ctx, -1);
    expect(result).toContain('Expira pronto');
  });

  it('remainingSeconds > 0 → contains "Expira en aproximadamente"', () => {
    const result = formatContextView(ctx, 3600);
    expect(result).toContain('Expira en aproximadamente');
  });
});

describe('formatContextCleared', () => {
  it('contains "Contexto borrado"', () => {
    const result = formatContextCleared();
    expect(result).toContain('Contexto borrado');
  });

  it('mentions that queries will not be filtered', () => {
    const result = formatContextCleared();
    expect(result).toContain('filtradas');
  });

  it('trailing period is escaped', () => {
    const result = formatContextCleared();
    expect(result).toContain('\\.');
  });
});
