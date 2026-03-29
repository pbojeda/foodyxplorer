/**
 * @jest-environment jsdom
 *
 * F048 — Landing Performance & Accessibility: Edge-Case Tests
 *
 * Covers:
 * 1. SearchSimulator ARIA combobox attributes (role, aria-expanded, aria-controls, aria-activedescendant)
 * 2. SearchSimulator keyboard navigation (ArrowDown/Up/Enter/Escape/Home/End)
 * 3. SearchSimulator improved no-match UX (query-interpolated message + suggestion pills)
 * 4. CookieBanner localStorage try/catch resilience
 * 5. i18n ChatGPT card (4th card in both locales)
 * 6. Security headers shape in next.config.mjs
 * 7. Reduced motion CSS (transition: none !important in globals.css)
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Framer-motion mock (same pattern as SearchSimulator.test.tsx)
// ---------------------------------------------------------------------------

jest.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
    }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
    button: ({
      children,
      className,
      onClick,
      disabled,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button className={className} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  MotionConfig: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Use fake timers to control the 850ms loading animation
jest.useFakeTimers();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { SearchSimulator } from '@/components/SearchSimulator';
import { CookieBanner } from '@/components/analytics/CookieBanner';
import { getDictionary } from '@/lib/i18n';
import { DISHES } from '@/lib/content';

// ---------------------------------------------------------------------------
// 1. SearchSimulator — ARIA combobox attributes
// ---------------------------------------------------------------------------

describe('F048 — SearchSimulator ARIA combobox', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('input has role="combobox"', () => {
    render(<SearchSimulator />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('input has aria-controls pointing to the listbox id when expanded', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    // Initially not expanded — aria-controls absent
    expect(input).not.toHaveAttribute('aria-controls');
    // Type to open dropdown
    await user.clear(input);
    await user.type(input, 'pulpo');
    expect(input).toHaveAttribute('aria-controls', 'search-suggestions-listbox');
  });

  it('input has aria-expanded="false" when dropdown is closed on initial render', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    // Start with a fresh state: clear input and blur
    const input = screen.getByRole('combobox');
    await user.clear(input);
    // After clearing, no suggestions, dropdown should be false
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('input has aria-expanded="true" when dropdown is open with suggestions', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('input has aria-expanded="true" when no-match UI is showing', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('each suggestion li has a unique id attribute', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    const options = screen.getAllByRole('option');
    const ids = options.map((opt) => opt.closest('li')?.id ?? opt.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
    ids.forEach((id) => expect(id).toMatch(/^search-option-/));
  });

  it('aria-activedescendant is absent when no option is highlighted', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // No arrow key pressed yet — no active descendant
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('aria-activedescendant points to highlighted option after ArrowDown', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
  });
});

// ---------------------------------------------------------------------------
// 2. SearchSimulator — keyboard navigation
// ---------------------------------------------------------------------------

describe('F048 — SearchSimulator keyboard navigation', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('ArrowDown opens dropdown and highlights first option', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');

    // Close dropdown first by blurring, then re-focus
    act(() => {
      jest.advanceTimersByTime(200); // advance past 150ms blur timeout
    });

    await user.click(input);
    // Simulate ArrowDown key
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('ArrowDown does not wrap past the last option', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // Press ArrowDown many times
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    // Should be at the last option, not wrapping
    const options = screen.getAllByRole('option');
    const lastIndex = options.length - 1;
    expect(input).toHaveAttribute('aria-activedescendant', `search-option-${lastIndex}`);
  });

  it('ArrowUp at index 0 goes to -1 (no active descendant)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
    await user.keyboard('{ArrowUp}');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('ArrowDown then ArrowUp returns to first option', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    // 'a' matches multiple dishes (big mac, pulpo a feira, paella, ensalada, croquetas, gazpacho)
    await user.type(input, 'a');
    await user.keyboard('{ArrowDown}'); // index 0
    await user.keyboard('{ArrowDown}'); // index 1
    await user.keyboard('{ArrowUp}');  // back to index 0
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
  });

  it('Enter with highlighted option selects that dish and shows loading', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(screen.getByText(/preparando/i)).toBeInTheDocument();
  });

  it('Enter with no highlighted option but matching query runs the search', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // No ArrowDown — activeIndex is -1
    await user.keyboard('{Enter}');
    expect(screen.getByText(/preparando/i)).toBeInTheDocument();
  });

  it('Enter with no match and no highlight does nothing', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    await user.keyboard('{Enter}');
    // Should NOT be in loading state
    expect(screen.queryByText(/preparando/i)).not.toBeInTheDocument();
  });

  it('Escape closes the dropdown and aria-expanded becomes false', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape keeps the input value unchanged', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('big');
  });

  it('Home key jumps to first suggestion', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
  });

  it('End key jumps to last suggestion', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{End}');
    const options = screen.getAllByRole('option');
    const lastIndex = options.length - 1;
    expect(input).toHaveAttribute('aria-activedescendant', `search-option-${lastIndex}`);
  });
});

// ---------------------------------------------------------------------------
// 3. SearchSimulator — improved no-match UX
// ---------------------------------------------------------------------------

describe('F048 — SearchSimulator no-match UX', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('shows query-interpolated no-match message with "todavía"', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(screen.getByText(/todavía/i)).toBeInTheDocument();
    expect(screen.getByText(/platillo marciano xyz123/i)).toBeInTheDocument();
  });

  it('does NOT show old "No encontrado" message', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(screen.queryByText(/no encontrado/i)).not.toBeInTheDocument();
  });

  it('shows first 4 DISHES as suggestion pills in no-match state', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    const first4 = DISHES.slice(0, 4);
    for (const dish of first4) {
      expect(screen.getByRole('button', { name: dish.dish })).toBeInTheDocument();
    }
  });

  it('clicking a no-match suggestion pill triggers loading', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    const firstDish = DISHES[0]!;
    const pill = screen.getByRole('button', { name: firstDish.dish });
    await user.click(pill);
    expect(screen.getByText(/preparando/i)).toBeInTheDocument();
  });

  it('hides the full quick-select pill row during no-match state', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    // The pill row wrapping div with data-testid should be hidden
    // Check: the normal full pill row (all 10 dishes) is not visible
    // We can check that buttons with dish queries 5-10 are NOT present
    const latterDishes = DISHES.slice(4);
    for (const dish of latterDishes) {
      // These should not appear as there are only 4 no-match pills (first 4)
      expect(screen.queryByRole('button', { name: dish.dish })).not.toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. CookieBanner — localStorage try/catch
// ---------------------------------------------------------------------------

describe('F048 — CookieBanner localStorage resilience', () => {
  const originalLocalStorage = window.localStorage;

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    });
    jest.clearAllTimers();
  });

  it('renders without crashing when localStorage.getItem throws', () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => { throw new Error('Private mode'); },
        setItem: () => { throw new Error('Private mode'); },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      },
      writable: true,
    });
    expect(() => render(<CookieBanner variant="a" />)).not.toThrow();
    // Banner should still render (consent defaults to null)
    expect(screen.getByRole('region', { name: /cookies/i })).toBeInTheDocument();
  });

  it('does not throw when localStorage.setItem throws on accept', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    // getItem returns null normally (banner shows)
    // setItem throws
    const mockStorage = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(() => { throw new Error('Storage full'); }),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(() => null),
      length: 0,
    };
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
    });
    render(<CookieBanner variant="a" />);
    const acceptBtn = screen.getByRole('button', { name: /aceptar/i });
    await expect(user.click(acceptBtn)).resolves.not.toThrow();
  });

  it('does not throw when localStorage.setItem throws on reject', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const mockStorage = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(() => { throw new Error('Storage full'); }),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(() => null),
      length: 0,
    };
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
    });
    render(<CookieBanner variant="a" />);
    const rejectBtn = screen.getByRole('button', { name: /rechazar/i });
    await expect(user.click(rejectBtn)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. i18n — ChatGPT card
// ---------------------------------------------------------------------------

describe('F048 — i18n ChatGPT comparison card', () => {
  it('es.ts comparison.cards has 4 cards', () => {
    const dict = getDictionary('es');
    expect(dict.comparison.cards).toHaveLength(4);
  });

  it('en.ts comparison.cards has 4 cards', () => {
    const dict = getDictionary('en');
    expect(dict.comparison.cards).toHaveLength(4);
  });

  it('4th card in es has title "ChatGPT / IAs generativas"', () => {
    const dict = getDictionary('es');
    expect(dict.comparison.cards[3]?.title).toBe('ChatGPT / IAs generativas');
  });

  it('4th card in en has title "ChatGPT / Generative AIs"', () => {
    const dict = getDictionary('en');
    expect(dict.comparison.cards[3]?.title).toBe('ChatGPT / Generative AIs');
  });

  it('4th card in es has versus "vs. nutriXplorer"', () => {
    const dict = getDictionary('es');
    expect(dict.comparison.cards[3]?.versus).toBe('vs. nutriXplorer');
  });

  it('4th card in en has versus "vs. nutriXplorer"', () => {
    const dict = getDictionary('en');
    expect(dict.comparison.cards[3]?.versus).toBe('vs. nutriXplorer');
  });

  it('4th card in es has an advantage key', () => {
    const dict = getDictionary('es');
    expect(dict.comparison.cards[3]?.advantage).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Security headers shape
// ---------------------------------------------------------------------------

describe('F048 — Security headers in next.config.mjs', () => {
  let configHeaders: Array<{ key: string; value: string }>;

  beforeAll(async () => {
    // Dynamically import next.config.mjs to get the headers() function
    const configModule = await import(
      /* webpackIgnore: true */ '../../next.config.mjs'
    );
    const config = configModule.default;
    const headersResult = await config.headers();
    // headersResult is array of { source, headers }
    configHeaders = headersResult[0].headers as Array<{ key: string; value: string }>;
  });

  it('includes X-Frame-Options: DENY', () => {
    expect(configHeaders).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });

  it('includes X-Content-Type-Options: nosniff', () => {
    expect(configHeaders).toContainEqual({
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    });
  });

  it('includes Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(configHeaders).toContainEqual({
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    });
  });

  it('includes Permissions-Policy for camera, microphone, geolocation', () => {
    expect(configHeaders).toContainEqual({
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Reduced motion — globals.css contains transition: none !important
// ---------------------------------------------------------------------------

describe('F048 — Reduced motion CSS', () => {
  it('globals.css contains transition: none !important inside prefers-reduced-motion block', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    // The transition: none !important should be inside the reduced-motion media query
    const reducedMotionBlock = cssContent.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)[\s\S]*?(?=@|\Z|$)/
    );
    expect(cssContent).toContain('transition: none !important');
    expect(reducedMotionBlock?.[0]).toContain('transition: none !important');
  });
});
