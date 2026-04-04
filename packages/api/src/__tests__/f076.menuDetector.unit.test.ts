// F076 — Unit tests for detectMenuQuery (menu detection + item splitting)

import { describe, it, expect } from 'vitest';
import { detectMenuQuery } from '../conversation/menuDetector.js';

// ---------------------------------------------------------------------------
// Trigger pattern detection
// ---------------------------------------------------------------------------

describe('detectMenuQuery — trigger patterns', () => {
  it('"menú: X, Y" → detects 2 items', () => {
    expect(detectMenuQuery('menú: gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"menu: X, Y" (no accent) → detects 2 items', () => {
    expect(detectMenuQuery('menu: gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"menú del día: X, Y, Z" → detects 3 items', () => {
    expect(detectMenuQuery('menú del día: gazpacho, pollo con patatas, flan')).toEqual([
      'gazpacho', 'pollo con patatas', 'flan',
    ]);
  });

  it('"menu del dia: X, Y" (no accents) → detects 2 items', () => {
    expect(detectMenuQuery('menu del dia: gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"de menú: X, Y" → detects 2 items', () => {
    expect(detectMenuQuery('de menú: gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"mi menú: X, Y" → detects 2 items', () => {
    expect(detectMenuQuery('mi menú: gazpacho, flan')).toEqual(['gazpacho', 'flan']);
  });

  it('"hoy de menú X, Y" → detects 2 items', () => {
    expect(detectMenuQuery('hoy de menú gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"hoy he comido de menú del día: X, Y, Z" → detects 3 items', () => {
    expect(detectMenuQuery('hoy he comido de menú del día: gazpacho, pollo, flan')).toEqual([
      'gazpacho', 'pollo', 'flan',
    ]);
  });

  it('"menú, X, Y" (comma after menú) → detects 2 items', () => {
    expect(detectMenuQuery('menú, gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });

  it('"menú del día, X, Y" (comma after trigger) → detects 2 items', () => {
    expect(detectMenuQuery('menú del día, gazpacho, pollo')).toEqual(['gazpacho', 'pollo']);
  });
});

// ---------------------------------------------------------------------------
// Item splitting — comma only
// ---------------------------------------------------------------------------

describe('detectMenuQuery — comma splitting', () => {
  it('4 comma-separated items', () => {
    expect(detectMenuQuery('menú: gazpacho, pollo con patatas, flan, café')).toEqual([
      'gazpacho', 'pollo con patatas', 'flan', 'café',
    ]);
  });

  it('trims whitespace from items', () => {
    expect(detectMenuQuery('menú:  gazpacho ,  pollo  ,  flan  ')).toEqual([
      'gazpacho', 'pollo', 'flan',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Item splitting — final conjunction ` y ` / ` más `
// ---------------------------------------------------------------------------

describe('detectMenuQuery — final conjunction splitting', () => {
  it('"X, Y y Z" → 3 items (` y ` as final conjunction)', () => {
    expect(detectMenuQuery('menú: gazpacho, pollo, flan y café')).toEqual([
      'gazpacho', 'pollo', 'flan', 'café',
    ]);
  });

  it('"X, Y más Z" → 3 items (` más ` as final conjunction)', () => {
    expect(detectMenuQuery('menú: gazpacho, pollo más café')).toEqual([
      'gazpacho', 'pollo', 'café',
    ]);
  });

  it('"jamón y queso, tortilla" → 2 items (` y ` inside non-last item preserved)', () => {
    expect(detectMenuQuery('menú: jamón y queso, tortilla')).toEqual([
      'jamón y queso', 'tortilla',
    ]);
  });

  it('"arroz y verduras, tortilla y flan" → 3 items (` y ` in middle preserved, last split)', () => {
    expect(detectMenuQuery('menú: arroz y verduras, tortilla y flan')).toEqual([
      'arroz y verduras', 'tortilla', 'flan',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Special case: 2 items via conjunction only (no commas)
// ---------------------------------------------------------------------------

describe('detectMenuQuery — 2-item conjunction-only split', () => {
  it('"menú: gazpacho y ensalada" → 2 items (no commas)', () => {
    expect(detectMenuQuery('menú: gazpacho y ensalada')).toEqual([
      'gazpacho', 'ensalada',
    ]);
  });

  it('"menú: sopa más café" → 2 items via ` más `', () => {
    expect(detectMenuQuery('menú: sopa más café')).toEqual([
      'sopa', 'café',
    ]);
  });

  it('"menú: jamón y queso" → null (splits to 2 but "jamón" and "queso" are both valid)', () => {
    // This is an edge case: "jamón y queso" could be 1 dish or 2 items.
    // Without commas and with ` y ` being the only separator, we split → 2 items.
    // The estimation engine will handle each independently.
    expect(detectMenuQuery('menú: jamón y queso')).toEqual(['jamón', 'queso']);
  });
});

// ---------------------------------------------------------------------------
// Noise filtering
// ---------------------------------------------------------------------------

describe('detectMenuQuery — noise filtering', () => {
  it('filters price "12.50€"', () => {
    expect(detectMenuQuery('menú: gazpacho, 12.50€, pollo')).toEqual([
      'gazpacho', 'pollo',
    ]);
  });

  it('filters price "€15"', () => {
    expect(detectMenuQuery('menú: gazpacho, €15, pollo')).toEqual([
      'gazpacho', 'pollo',
    ]);
  });

  it('filters "12 euros"', () => {
    expect(detectMenuQuery('menú: gazpacho, 12 euros, pollo')).toEqual([
      'gazpacho', 'pollo',
    ]);
  });

  it('filters pure digits "42"', () => {
    expect(detectMenuQuery('menú: gazpacho, 42, pollo')).toEqual([
      'gazpacho', 'pollo',
    ]);
  });

  it('does NOT filter items with numbers inside dish names', () => {
    expect(detectMenuQuery('menú: 2 huevos fritos, pollo')).toEqual([
      '2 huevos fritos', 'pollo',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('detectMenuQuery — edge cases', () => {
  it('returns null when no "menú"/"menu" keyword', () => {
    expect(detectMenuQuery('gazpacho, pollo, flan')).toBeNull();
  });

  it('returns null when < 2 items after parsing', () => {
    expect(detectMenuQuery('menú: solo un plato')).toBeNull();
  });

  it('filters empty items from split', () => {
    expect(detectMenuQuery('menú: gazpacho, , pollo')).toEqual([
      'gazpacho', 'pollo',
    ]);
  });

  it('truncates to 8 items when > 8 provided', () => {
    const items = Array.from({ length: 10 }, (_, i) => `plato${i + 1}`);
    const result = detectMenuQuery(`menú: ${items.join(', ')}`);
    expect(result).toHaveLength(8);
    expect(result![0]).toBe('plato1');
    expect(result![7]).toBe('plato8');
  });

  it('returns null for empty string', () => {
    expect(detectMenuQuery('')).toBeNull();
  });

  it('returns null for "menú:" with nothing after', () => {
    expect(detectMenuQuery('menú:')).toBeNull();
  });

  it('case-insensitive detection', () => {
    expect(detectMenuQuery('MENÚ: GAZPACHO, POLLO')).toEqual(['GAZPACHO', 'POLLO']);
  });

  it('returns null when all items are noise after filtering', () => {
    expect(detectMenuQuery('menú: 12€, 15 euros')).toBeNull();
  });
});
