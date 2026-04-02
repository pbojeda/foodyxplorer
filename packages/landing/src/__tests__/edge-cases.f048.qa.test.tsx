/**
 * @jest-environment jsdom
 *
 * F048 QA — Additional edge-case tests not covered by edge-cases.f048.test.tsx
 *
 * Covers:
 * A. e.preventDefault() called on all navigation keys (ArrowDown/Up/Enter/Escape/Home/End)
 * B. ARIA: aria-activedescendant points to the element with role="option", not just <li>
 * C. Escape key when no-match state is active — aria-expanded should become false
 * D. ArrowDown/Home/End when suggestions list is empty — should do nothing, no crash
 * E. No-match state clears after successful pill click (state transitions to loading)
 * F. ComparisonSection grid class updated for 4-column layout
 * G. Security headers source pattern covers all routes
 * H. CookieBanner — banner state remains shown after localStorage.getItem throws (consent=null)
 * I. noResult is NOT shown during loading state (state guard)
 * J. Quick-select pills reappear after no-match resolves (state transitions back)
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Framer-motion mock
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

jest.useFakeTimers();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { SearchSimulator } from '@/components/SearchSimulator';
import { CookieBanner } from '@/components/analytics/CookieBanner';
import { getDictionary } from '@/lib/i18n';
import { DISHES } from '@/lib/content';

// ---------------------------------------------------------------------------
// A. e.preventDefault() is called for all navigation keys
//
// Technique: fireEvent.keyDown with a spy on the event's preventDefault method.
// userEvent.keyboard fires React synthetic events via jsdom's dispatchEvent.
// The React onKeyDown handler receives a SyntheticEvent wrapping the native event.
// We use fireEvent (which dispatches a real DOM event) and check defaultPrevented
// on the event object after React has processed it.
// ---------------------------------------------------------------------------

describe('F048 QA — keyboard e.preventDefault() calls', () => {
  afterEach(() => jest.clearAllTimers());

  /**
   * Fires a keydown event via fireEvent (not userEvent) so React's onKeyDown
   * handler receives it synchronously. Then checks that e.preventDefault() was
   * called by inspecting the nativeEvent's defaultPrevented flag.
   *
   * Note: jsdom's dispatchEvent returns false if preventDefault was called,
   * but React calls preventDefault on the SyntheticEvent wrapper. We verify
   * this by checking the state effect that ONLY occurs when preventDefault is
   * called (i.e., the side effect that proves the case branch was hit).
   * For ArrowDown: activeIndex moves to 0 (isOpen=false branch sets activeIndex=0).
   * For ArrowUp: activeIndex moves to -1 (only if isOpen branch is hit, but we
   *   set up with ArrowDown first).
   * For Enter: loading starts.
   * For Escape: dropdown closes (aria-expanded=false).
   * For Home: activeIndex=0 (when isOpen).
   * For End: activeIndex=lastIndex (when isOpen).
   *
   * The implementation calls e.preventDefault() unconditionally for
   * ArrowDown/ArrowUp/Enter/Escape, and conditionally (only when isOpen) for
   * Home/End. We test the unconditional cases first.
   */

  it('ArrowDown prevents default — verified by checking source code calls e.preventDefault()', () => {
    // Static source assertion: the implementation must call e.preventDefault()
    // for ArrowDown. We read the implementation source and verify the call exists.
    const implPath = path.resolve(
      __dirname,
      '../components/SearchSimulator.tsx'
    );
    const src = fs.readFileSync(implPath, 'utf-8');
    // ArrowDown case must contain e.preventDefault() BEFORE any condition
    const arrowDownBlock = src.match(/case 'ArrowDown':\s*\{([\s\S]*?)break;/);
    expect(arrowDownBlock).not.toBeNull();
    // e.preventDefault() should appear at the start of the case, unconditionally
    const block = arrowDownBlock![1];
    expect(block.trim()).toMatch(/^e\.preventDefault\(\)/);
  });

  it('ArrowUp prevents default — e.preventDefault() called unconditionally', () => {
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    const block = src.match(/case 'ArrowUp':\s*\{([\s\S]*?)break;/)?.[1];
    expect(block).toBeDefined();
    expect(block!.trim()).toMatch(/^e\.preventDefault\(\)/);
  });

  it('Enter prevents default — e.preventDefault() called unconditionally', () => {
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    const block = src.match(/case 'Enter':\s*\{([\s\S]*?)break;/)?.[1];
    expect(block).toBeDefined();
    expect(block!.trim()).toMatch(/^e\.preventDefault\(\)/);
  });

  it('Escape prevents default — e.preventDefault() called unconditionally', () => {
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    const block = src.match(/case 'Escape':\s*\{([\s\S]*?)break;/)?.[1];
    expect(block).toBeDefined();
    expect(block!.trim()).toMatch(/^e\.preventDefault\(\)/);
  });

  it('Home prevents default when dropdown is open — e.preventDefault() inside isOpen guard', () => {
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    const block = src.match(/case 'Home':\s*\{([\s\S]*?)break;/)?.[1];
    expect(block).toBeDefined();
    // Home/End: e.preventDefault() must be inside the isOpen guard
    expect(block).toContain('e.preventDefault()');
    expect(block).toContain('isOpen');
  });

  it('End prevents default when dropdown is open — e.preventDefault() inside isOpen guard', () => {
    const implPath = path.resolve(__dirname, '../components/SearchSimulator.tsx');
    const src = fs.readFileSync(implPath, 'utf-8');
    const block = src.match(/case 'End':\s*\{([\s\S]*?)break;/)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain('e.preventDefault()');
    expect(block).toContain('isOpen');
  });
});

// ---------------------------------------------------------------------------
// B. ARIA: aria-activedescendant must point to the element with role="option"
// ---------------------------------------------------------------------------

describe('F048 QA — ARIA: aria-activedescendant targets the option element', () => {
  afterEach(() => jest.clearAllTimers());

  it('aria-activedescendant id resolves to an element with role="option"', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');

    const activeDescendantId = input.getAttribute('aria-activedescendant');
    expect(activeDescendantId).toBeTruthy();

    // The element pointed to by aria-activedescendant MUST carry role="option"
    const activeElement = document.getElementById(activeDescendantId!);
    expect(activeElement).not.toBeNull();
    expect(activeElement!.getAttribute('role')).toBe('option');
  });

  it('every option id matches what aria-activedescendant would reference', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');

    const options = screen.getAllByRole('option');
    options.forEach((option, idx) => {
      // The option element itself should carry the id, not a wrapper
      const id = option.getAttribute('id') ?? option.closest('[id]')?.id;
      expect(id).toBe(`search-option-${idx}`);
    });
  });
});

// ---------------------------------------------------------------------------
// C. Escape when no-match state is active — aria-expanded must become false
// ---------------------------------------------------------------------------

describe('F048 QA — Escape with no-match state active', () => {
  afterEach(() => jest.clearAllTimers());

  it('aria-expanded is false after Escape even when noResult was true', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    // Confirm no-match is active (aria-expanded=true due to noResult)
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    // After Escape the expanded state must be false — user intends to dismiss
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('no-match message is hidden after Escape', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(screen.getByText(/todavía/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText(/todavía/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D. ArrowDown/Home/End with empty suggestions — no crash, no state corruption
// ---------------------------------------------------------------------------

describe('F048 QA — keyboard keys with empty suggestions list', () => {
  afterEach(() => jest.clearAllTimers());

  it('ArrowDown with empty query (no suggestions) — aria-activedescendant must not point to a missing element', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    // Clear the input so suggestions = [] and the listbox is not rendered
    await user.clear(input);
    await user.keyboard('{ArrowDown}');
    // BUG: when suggestions is empty, ArrowDown still sets activeIndex=0 and
    // showDropdown=true. The listbox is not rendered (suggestions.length > 0 guard),
    // so aria-activedescendant="search-option-0" would be a dangling pointer.
    // aria-activedescendant MUST NOT reference an element that does not exist in the DOM.
    const activeDescendantId = input.getAttribute('aria-activedescendant');
    if (activeDescendantId) {
      const el = document.getElementById(activeDescendantId);
      // If the attribute is set, the referenced element must exist
      expect(el).not.toBeNull();
    }
    // Alternative assertion: when suggestions is empty, attribute should be absent
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('Home key with closed dropdown does nothing (no crash)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // Close dropdown via Escape
    await user.keyboard('{Escape}');
    // Now press Home — should not crash
    await user.keyboard('{Home}');
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('End key with closed dropdown does nothing (no crash)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{Escape}');
    await user.keyboard('{End}');
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });
});

// ---------------------------------------------------------------------------
// E. No-match state clears after successful pill click
// ---------------------------------------------------------------------------

describe('F048 QA — no-match state clears after selecting a suggestion pill', () => {
  afterEach(() => jest.clearAllTimers());

  it('no-match message disappears after clicking a suggestion pill', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(screen.getByText(/todavía/i)).toBeInTheDocument();

    const firstDish = DISHES[0]!;
    const pill = screen.getByRole('button', { name: firstDish.dish });
    await user.click(pill);

    // After selection, loading starts — no-match message gone
    expect(screen.queryByText(/todavía/i)).not.toBeInTheDocument();
  });

  it('full quick-select pills reappear after loading completes (noResult cleared)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');

    const firstDish = DISHES[0]!;
    const pill = screen.getByRole('button', { name: firstDish.dish });
    await user.click(pill);

    // Advance past the 850ms loading delay
    act(() => {
      jest.advanceTimersByTime(900);
    });

    // Full pill row should reappear (all 10 dishes visible)
    const allDishButtons = DISHES.map((d) =>
      screen.queryByRole('button', { name: d.dish })
    );
    // At least some buttons from the full row should be visible
    const visibleCount = allDishButtons.filter(Boolean).length;
    expect(visibleCount).toBe(DISHES.length);
  });
});

// ---------------------------------------------------------------------------
// F. ComparisonSection grid updated for 4-column layout
// ---------------------------------------------------------------------------

describe('F048 QA — ComparisonSection 4-column grid layout', () => {
  it('grid container has lg:grid-cols-4 class for 4 cards on desktop', () => {
    const { container } = render(
      (() => {
        // Import synchronously from getDictionary
        const dict = getDictionary('es');
        const { ComparisonSection } = require('@/components/sections/ComparisonSection');
        return <ComparisonSection dict={dict.comparison} />;
      })()
    );
    // Find the grid div
    const gridDiv = container.querySelector('.lg\\:grid-cols-4');
    expect(gridDiv).not.toBeNull();
  });

  it('grid container does NOT have the old md:grid-cols-3 class', () => {
    const { container } = render(
      (() => {
        const dict = getDictionary('es');
        const { ComparisonSection } = require('@/components/sections/ComparisonSection');
        return <ComparisonSection dict={dict.comparison} />;
      })()
    );
    const oldGrid = container.querySelector('.md\\:grid-cols-3');
    expect(oldGrid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G. Security headers source pattern covers all routes
// ---------------------------------------------------------------------------

describe('F048 QA — Security headers source pattern', () => {
  let headersConfig: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;

  beforeAll(async () => {
    const configModule = await import(
      /* webpackIgnore: true */ '../../next.config.mjs'
    );
    const config = configModule.default;
    headersConfig = await config.headers();
  });

  it('source pattern is /(.*) to catch all routes including root', () => {
    expect(headersConfig[0]?.source).toBe('/(.*)');
  });

  it('at least 4 security headers are configured', () => {
    const headers = headersConfig[0]?.headers ?? [];
    expect(headers.length).toBeGreaterThanOrEqual(4);
  });

  it('does not include a Content-Security-Policy (enforcement) header — only Report-Only is used', () => {
    const headers = headersConfig[0]?.headers ?? [];
    const csp = headers.find((h) => h.key === 'Content-Security-Policy');
    expect(csp).toBeUndefined();
  });

  it('includes a Strict-Transport-Security header (added in F064)', () => {
    const headers = headersConfig[0]?.headers ?? [];
    const hsts = headers.find((h) => h.key === 'Strict-Transport-Security');
    expect(hsts).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// H. CookieBanner — banner renders when localStorage.getItem throws (consent=null)
// ---------------------------------------------------------------------------

describe('F048 QA — CookieBanner consent defaults to null on getItem throw', () => {
  const originalLocalStorage = window.localStorage;

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    });
    jest.clearAllTimers();
  });

  it('consent state remains null so banner is displayed when getItem throws', () => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => { throw new Error('Private mode'); },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      },
      writable: true,
    });
    render(<CookieBanner variant="a" />);
    // Banner must still be visible — consent couldn't be read, defaults to null
    expect(screen.getByRole('region', { name: /cookies/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// I. noResult is NOT active during loading or result states
// ---------------------------------------------------------------------------

describe('F048 QA — noResult state guard', () => {
  afterEach(() => jest.clearAllTimers());

  it('no-match message does NOT appear when state is loading (even with no-match query)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    // Type a valid query, trigger loading
    await user.type(input, 'big');
    const button = screen.getByRole('button', { name: /ver resultado/i });
    await user.click(button);
    // State is now 'loading' — no-match should not show
    expect(screen.getByText(/preparando/i)).toBeInTheDocument();
    expect(screen.queryByText(/todavía/i)).not.toBeInTheDocument();
  });

  it('no-match message does NOT appear when state is result', () => {
    render(<SearchSimulator />);
    // Default state is 'result' with pulpo a feira
    expect(screen.queryByText(/todavía/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// J. Reduced motion — globals.css covers animate-fade-in used by no-match UI
// ---------------------------------------------------------------------------

describe('F048 QA — Reduced motion covers no-match animate-fade-in', () => {
  it('globals.css includes animate-fade-in in the prefers-reduced-motion block', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Extract the full reduced-motion block
    const reducedMotionMatch = cssContent.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)([\s\S]*?)(?=@layer|\Z|$)/
    );
    expect(reducedMotionMatch).not.toBeNull();
    const block = reducedMotionMatch![0];
    expect(block).toContain('animate-fade-in');
    expect(block).toContain('animation: none');
  });

  it('globals.css reduced-motion block contains both animation: none AND transition: none !important', () => {
    const cssPath = path.resolve(__dirname, '../app/globals.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    const reducedMotionMatch = cssContent.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)([\s\S]*?)(?=@layer|\Z|$)/
    );
    const block = reducedMotionMatch![0];
    expect(block).toContain('animation: none');
    expect(block).toContain('transition: none !important');
  });
});
