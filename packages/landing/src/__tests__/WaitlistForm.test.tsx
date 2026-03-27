import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaitlistForm } from '@/components/features/WaitlistForm';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<
  typeof analytics.trackEvent
>;

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function setup(source: 'hero' | 'cta' | 'footer' = 'hero') {
  return render(<WaitlistForm source={source} variant="a" />);
}

function successResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true }),
  });
}

function errorResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ success: false, error: 'Error del servidor' }),
  });
}

describe('WaitlistForm', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockFetch.mockClear();
  });

  it('shows validation error on submit with empty email', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows validation error on submit with invalid email', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'not-an-email');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows loading state while submitting', async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ success: true }) }), 200))
    );
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button'));
    // Button should be disabled while loading (spinner shown instead of text)
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  it('shows success message after successful submission', async () => {
    successResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
  });

  it('shows error state on network failure', async () => {
    errorResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('fires waitlist_submit_start on first focus (not on second focus)', async () => {
    setup();
    const input = screen.getByRole('textbox', { name: /email/i });
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.focus(input);

    const startEvents = mockTrackEvent.mock.calls.filter(
      ([p]) => p.event === 'waitlist_submit_start'
    );
    expect(startEvents).toHaveLength(1);
  });

  it('fires hero_cta_click on submit when source="hero"', async () => {
    successResponse();
    setup('hero');
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'hero_cta_click' })
      );
    });
  });

  it('fires waitlist_cta_click (not hero_cta_click) when source="cta"', async () => {
    successResponse();
    setup('cta');
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      const ctaClicks = mockTrackEvent.mock.calls.filter(
        ([p]) => p.event === 'waitlist_cta_click'
      );
      expect(ctaClicks).toHaveLength(1);
      const heroCTAClicks = mockTrackEvent.mock.calls.filter(
        ([p]) => p.event === 'hero_cta_click'
      );
      expect(heroCTAClicks).toHaveLength(0);
    });
  });

  it('fires waitlist_cta_click with source="footer" when source="footer"', async () => {
    successResponse();
    setup('footer');
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'waitlist_cta_click', source: 'footer' })
      );
    });
  });

  it('fires waitlist_submit_success on success', async () => {
    successResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'waitlist_submit_success' })
      );
    });
  });

  it('fires waitlist_submit_error on error', async () => {
    errorResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'waitlist_submit_error' })
      );
    });
  });

  it('form is re-enabled after error state (retry)', async () => {
    errorResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Button should be enabled again after error
    expect(screen.getByRole('button', { name: /únete/i })).not.toBeDisabled();
  });
});
