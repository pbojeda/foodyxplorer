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
