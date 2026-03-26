/**
 * Tests for WaitlistForm v2 — optional phone field via showPhone prop.
 * These tests complement (not replace) the existing WaitlistForm.test.tsx.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaitlistForm } from '@/components/features/WaitlistForm';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

function successResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true }),
  });
}

describe('WaitlistForm — phone field', () => {
  beforeEach(() => {
    (analytics.trackEvent as jest.Mock).mockClear();
    mockFetch.mockClear();
  });

  it('renders the phone input field when showPhone=true', () => {
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    expect(screen.getByPlaceholderText(/teléfono/i)).toBeInTheDocument();
  });

  it('phone label shows "(opcional)" when showPhone=true', () => {
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    expect(screen.getAllByText(/opcional/i).length).toBeGreaterThan(0);
  });

  it('submits successfully with email only (phone is optional)', async () => {
    successResponse();
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
  });

  it('submits successfully with email + valid phone (no spaces)', async () => {
    successResponse();
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.type(screen.getByPlaceholderText(/teléfono/i), '+34612345678');
    await user.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
  });

  it('shows phone validation error for invalid phone format after blur', async () => {
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    const phoneInput = screen.getByPlaceholderText(/teléfono/i);
    await user.type(phoneInput, 'notaphone');
    await user.tab(); // blur
    // Check phone error appears
    expect(screen.getByText(/teléfono válido/i)).toBeInTheDocument();
  });

  it('does NOT show phone error when phone is empty', async () => {
    successResponse();
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    // Leave phone empty
    await user.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/teléfono válido/i)).not.toBeInTheDocument();
  });

  it('includes phone in the fetch payload when provided', async () => {
    successResponse();
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.type(screen.getByPlaceholderText(/teléfono/i), '+34612345678');
    await user.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.phone).toBe('+34612345678');
    });
  });

  it('accepts international phone formats (+1...)', async () => {
    successResponse();
    const user = userEvent.setup();
    render(<WaitlistForm source="cta" variant="a" showPhone={true} />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.type(screen.getByPlaceholderText(/teléfono/i), '+12125550100');
    await user.click(screen.getByRole('button', { name: /únete/i }));
    await waitFor(() => {
      expect(screen.getByText(/apuntado/i)).toBeInTheDocument();
    });
  });
});
