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
const mockGetUtmParams = analytics.getUtmParams as jest.MockedFunction<
  typeof analytics.getUtmParams
>;

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const NEXT_PUBLIC_API_URL = 'http://localhost:3001';

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = NEXT_PUBLIC_API_URL;
});

function setup(source: 'hero' | 'cta' | 'footer' = 'hero') {
  return render(<WaitlistForm source={source} variant="a" />);
}

function successResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
}

function errorResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ success: false, error: 'Error del servidor' }),
  });
}

function duplicateResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'DUPLICATE_EMAIL' } }),
  });
}

describe('WaitlistForm', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockFetch.mockClear();
    mockGetUtmParams.mockReturnValue({});
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

  it('treats 409 response as success (email already registered)', async () => {
    duplicateResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'waitlist_submit_success' })
    );
  });

  it('posts to NEXT_PUBLIC_API_URL/waitlist, not /api/waitlist', async () => {
    successResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/waitlist'),
      expect.any(Object)
    );
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/waitlist'),
      expect.any(Object)
    );
  });

  it('includes UTM params in POST body when present in analytics', async () => {
    successResponse();
    mockGetUtmParams.mockReturnValue({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
    });
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
    const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(fetchOptions.body as string) as Record<string, unknown>;
    expect(body.utm_source).toBe('google');
    expect(body.utm_medium).toBe('cpc');
    expect(body.utm_campaign).toBe('launch');
  });

  it('includes honeypot field with empty string in POST body', async () => {
    successResponse();
    setup();
    await userEvent.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    fireEvent.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
    const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(fetchOptions.body as string) as Record<string, unknown>;
    expect(body.honeypot).toBe('');
  });

  it('honeypot input is present in the DOM and visually hidden', () => {
    setup();
    const honeypot = document.querySelector('input[name="honeypot"]');
    expect(honeypot).toBeInTheDocument();
    expect(honeypot).toHaveAttribute('tabIndex', '-1');
    expect(honeypot).toHaveAttribute('aria-hidden', 'true');
  });
});

// ---------------------------------------------------------------------------
// Phone auto-prepend (F047 — I6)
// ---------------------------------------------------------------------------

describe('WaitlistForm — phone auto-prepend', () => {
  function setupWithPhone() {
    return render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
  }

  it('focusing on empty phone input sets value to +34', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    fireEvent.focus(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+34');
  });

  it('blurring with value exactly +34 clears to empty string', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    // Focus sets +34
    fireEvent.focus(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+34');
    // Blur without adding digits
    fireEvent.blur(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('');
  });

  it('blurring with 9-digit number prepends +34', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    fireEvent.change(phoneInput, { target: { value: '612345678' } });
    fireEvent.blur(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+34612345678');
  });

  it('blurring with non-+34 country code leaves value unchanged', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    fireEvent.change(phoneInput, { target: { value: '+1 2125550100' } });
    fireEvent.blur(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+1 2125550100');
  });

  it('blurring with +34 already present and digits leaves value unchanged', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    fireEvent.change(phoneInput, { target: { value: '+34 612 345 678' } });
    fireEvent.blur(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+34 612 345 678');
  });

  it('does not overwrite when user has typed a full number including +34', async () => {
    setupWithPhone();
    const phoneInput = screen.getByRole('textbox', { name: /teléfono/i });
    fireEvent.change(phoneInput, { target: { value: '+34612345678' } });
    fireEvent.blur(phoneInput);
    expect((phoneInput as HTMLInputElement).value).toBe('+34612345678');
  });
});
