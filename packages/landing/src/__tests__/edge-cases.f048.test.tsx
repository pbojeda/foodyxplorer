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
// F064 — B1/B2 HSTS and CSP-Report-Only headers
// ---------------------------------------------------------------------------

describe('F064 — HSTS and CSP-Report-Only headers', () => {
  let configHeaders: Array<{ key: string; value: string }>;

  beforeAll(async () => {
    const configModule = await import(
      /* webpackIgnore: true */ '../../next.config.mjs'
    );
    const config = configModule.default;
    const headersResult = await config.headers();
    configHeaders = headersResult[0].headers as Array<{ key: string; value: string }>;
  });

  it('includes Strict-Transport-Security with max-age=63072000', () => {
    expect(configHeaders).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000',
    });
  });

  it('HSTS value does NOT contain includeSubDomains', () => {
    const hsts = configHeaders.find((h) => h.key === 'Strict-Transport-Security');
    expect(hsts?.value).not.toContain('includeSubDomains');
  });

  it('HSTS value does NOT contain preload', () => {
    const hsts = configHeaders.find((h) => h.key === 'Strict-Transport-Security');
    expect(hsts?.value).not.toContain('preload');
  });

  it('includes Content-Security-Policy-Report-Only header', () => {
    const csp = configHeaders.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(csp).toBeDefined();
  });

  it("CSP-Report-Only value contains default-src 'self'", () => {
    const csp = configHeaders.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(csp?.value).toContain("default-src 'self'");
  });

  it('CSP-Report-Only value contains https://www.googletagmanager.com', () => {
    const csp = configHeaders.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(csp?.value).toContain('https://www.googletagmanager.com');
  });

  it("CSP-Report-Only value contains frame-src 'none'", () => {
    const csp = configHeaders.find((h) => h.key === 'Content-Security-Policy-Report-Only');
    expect(csp?.value).toContain("frame-src 'none'");
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

// ---------------------------------------------------------------------------
// F064 QA — C3: duplicate keyframes removed from globals.css
// ---------------------------------------------------------------------------

describe('F064 QA — C3: raw @keyframes deleted from globals.css', () => {
  it('globals.css does NOT contain a raw @keyframes float block', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    // The raw @keyframes float block (outside any @layer) must be gone.
    // Tailwind config is now the canonical source.
    expect(cssContent).not.toMatch(/@keyframes\s+float\s*\{/);
  });

  it('globals.css does NOT contain a raw @keyframes badge-pulse block', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    expect(cssContent).not.toMatch(/@keyframes\s+badge-pulse\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// F064 QA — D1: viewport export in layout.tsx
// ---------------------------------------------------------------------------

describe('F064 QA — D1: viewport export with themeColor', () => {
  it('layout.tsx exports a viewport object', async () => {
    // Dynamic import respects the module cache already populated by edge-cases.f045.test.tsx
    const layoutModule = await import('@/app/layout');
    expect(layoutModule).toHaveProperty('viewport');
  });

  it('viewport.themeColor is the botanical green #2d5a27', async () => {
    const layoutModule = await import('@/app/layout');
    const viewport = (layoutModule as Record<string, unknown>).viewport as { themeColor?: string } | undefined;
    expect(viewport?.themeColor).toBe('#2d5a27');
  });
});

// ---------------------------------------------------------------------------
// F064 QA — D2: sitemap uses stable lastModified date constant
// ---------------------------------------------------------------------------

describe('F064 QA — D2: sitemap stable lastModified', () => {
  it('sitemap() returns an array with at least one entry', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const result = sitemap();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('sitemap lastModified is a Date object (not a live new Date())', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const result = sitemap();
    const entry = result[0];
    expect(entry?.lastModified).toBeInstanceOf(Date);
  });

  it('sitemap lastModified is the stable constant date 2026-03-30', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const result1 = sitemap();
    const result2 = sitemap();
    // Both calls must produce the exact same timestamp (stable constant, not new Date())
    expect(result1[0]?.lastModified?.toString()).toBe(result2[0]?.lastModified?.toString());
    // The year must be 2026 (confirming it uses the constant, not today's date at test time)
    const lastModified = result1[0]?.lastModified as Date;
    expect(lastModified.getUTCFullYear()).toBe(2026);
  });
});

// ---------------------------------------------------------------------------
// F064 QA — A2: remaining low-contrast classes NOT fixed by the spec
// (contrast issues in ProductDemo.tsx and text-white/55 in SearchSimulator)
// ---------------------------------------------------------------------------

describe('F064 QA — A2: low-contrast text-white/45 in ProductDemo.tsx (out-of-scope survivor)', () => {
  it('ProductDemo.tsx still contains text-white/45 — documents known contrast debt not in F064 scope', () => {
    // This test documents a known limitation: the F064 spec only targeted SearchSimulator.
    // ProductDemo.tsx has the same text-white/45 pattern on dark backgrounds (lines 89, 101, 110).
    // Contrast ratio at 45% opacity on slate-950 is ~2.8:1, below WCAG AA 4.5:1.
    // This test will FAIL when ProductDemo is fixed (which is the desired outcome — delete it then).
    const implPath = path.resolve(__dirname, '../components/ProductDemo.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    expect(src).toContain('text-white/45');
  });

  it('SearchSimulator.tsx text-white/55 on dark background — documents marginal contrast debt', () => {
    // Line 294: <p className="text-sm text-white/55">Resultado</p>
    // text-white/55 on bg-slate-950 = contrast ~3.4:1 — below WCAG AA 4.5:1 for normal text.
    // The F064 spec only fixed /45 instances; /55 was not in scope.
    // This test documents the survivor so a future ticket can address it.
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    expect(src).toContain('text-white/55');
  });
});
