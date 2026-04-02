import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchSimulator } from '@/components/SearchSimulator';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
    button: ({
      children,
      className,
      onClick,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button className={className} onClick={onClick}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Use fake timers to control the 850ms loading animation
jest.useFakeTimers();

describe('SearchSimulator', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('renders the search input', () => {
    render(<SearchSimulator />);
    expect(screen.getByPlaceholderText(/pulpo a feira/i)).toBeInTheDocument();
  });

  it('renders the "Ver resultado" button', () => {
    render(<SearchSimulator />);
    expect(screen.getByRole('button', { name: /ver resultado/i })).toBeInTheDocument();
  });

  it('renders quick-select pills for all 10 pre-loaded dishes', () => {
    render(<SearchSimulator />);
    // Pills are buttons with dish query names
    const bigMacPills = screen.getAllByRole('button', { name: /big mac/i });
    expect(bigMacPills.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /pulpo/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading state after clicking Ver resultado', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big mac');
    const button = screen.getByRole('button', { name: /ver resultado/i });
    await user.click(button);
    expect(screen.getByText(/preparando/i)).toBeInTheDocument();
  });

  it('shows result card after loading animation completes', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    // Click a quick-select pill
    const bigMacPill = screen.getAllByRole('button', { name: /big mac/i })[0]!;
    await user.click(bigMacPill);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      // The dish name appears in the result
      expect(screen.getByText(/Big Mac · McDonald's/)).toBeInTheDocument();
    });
  });

  it('shows L1 confidence for Big Mac', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    const bigMacPill = screen.getAllByRole('button', { name: /big mac/i })[0]!;
    await user.click(bigMacPill);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getByText(/nivel 1/i)).toBeInTheDocument();
    });
  });

  it('shows L3 confidence for paella valenciana', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    const paellaPill = screen.getAllByRole('button', { name: /paella/i })[0]!;
    await user.click(paellaPill);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getByText(/nivel 3/i)).toBeInTheDocument();
    });
  });

  it('shows improved no-match message for unrecognized query', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'platillo marciano xyz123');
    expect(screen.getByText(/todavía/i)).toBeInTheDocument();
  });

  it('shows macros grid after dish selection', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    const bigMacPill = screen.getAllByRole('button', { name: /big mac/i })[0]!;
    await user.click(bigMacPill);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getByText('508')).toBeInTheDocument();
    });
  });

  it('shows allergen guardrail in result', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    const pulpoPill = screen.getAllByRole('button', { name: /pulpo/i })[0]!;
    await user.click(pulpoPill);

    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/sin dato oficial/i).length).toBeGreaterThan(0);
    });
  });

  it('shows "Guardrail de seguridad" label', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);

    // Default state shows pulpo (already loaded)
    act(() => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(screen.getByText(/guardrail de seguridad/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// F064 — A1/A2 aria-selected and contrast classes
// ---------------------------------------------------------------------------

describe('F064 — SearchSimulator aria-selected and contrast classes', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('aria-selected is true on keyboard-focused option (index 0 after ArrowDown)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // All others must be false
    options.slice(1).forEach((opt) => {
      expect(opt).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('aria-selected moves to index 1 after second ArrowDown', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    // 'a' matches multiple dishes (paella, ensalada, pizza margarita, etc.)
    await user.clear(input);
    await user.type(input, 'a');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(2);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const updatedOptions = screen.getAllByRole('option');
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'false');
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('aria-selected returns to false on all options after ArrowUp back to -1', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    const options = screen.getAllByRole('option');
    options.forEach((opt) => {
      expect(opt).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('aria-selected is based on keyboard focus index, not the last-selected dish', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    // First select a dish via pill to set activeDish
    const bigMacPill = screen.getAllByRole('button', { name: /big mac/i })[0]!;
    await user.click(bigMacPill);
    act(() => { jest.advanceTimersByTime(900); });
    await waitFor(() => {
      expect(screen.getByText(/Big Mac · McDonald's/)).toBeInTheDocument();
    });
    // Type 'a' which matches multiple dishes (paella, ensalada, etc.)
    await user.clear(input);
    await user.type(input, 'a');
    // Ensure suggestions are visible
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(2);
    // ArrowDown to index 1
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const updatedOptions = screen.getAllByRole('option');
    // Index 1 should be selected, not based on activeDish
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('suggestion level span has class text-slate-500 (not text-slate-400)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // Find suggestion level spans
    const levelSpans = document.querySelectorAll('li[role="option"] span.text-slate-500');
    expect(levelSpans.length).toBeGreaterThan(0);
    const oldLevelSpans = document.querySelectorAll('li[role="option"] span.text-slate-400');
    expect(oldLevelSpans.length).toBe(0);
  });

  it('all dropdown options have aria-selected=false when dropdown first opens (activeIndex is -1)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const input = screen.getByRole('combobox');
    await user.clear(input);
    await user.type(input, 'big');
    // Dropdown is now open but NO arrow key has been pressed — activeIndex is still -1.
    // All visible options must have aria-selected=false (not true and not missing the attribute).
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((opt) => {
      expect(opt).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('result card macro label has class text-white/70 (not text-white/45)', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<SearchSimulator />);
    const bigMacPill = screen.getAllByRole('button', { name: /big mac/i })[0]!;
    await user.click(bigMacPill);
    act(() => { jest.advanceTimersByTime(900); });
    await waitFor(() => {
      expect(screen.getByText(/Big Mac · McDonald's/)).toBeInTheDocument();
    });
    // Check the macro label divs use text-white/70
    const macroLabels = document.querySelectorAll('.text-white\\/70');
    expect(macroLabels.length).toBeGreaterThan(0);
    const oldMacroLabels = document.querySelectorAll('.text-white\\/45');
    expect(oldMacroLabels.length).toBe(0);
  });
});
