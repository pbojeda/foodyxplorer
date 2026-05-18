// F107a: UserMenu component tests — AC21
// Tests: null when user prop null; avatar renders; dropdown; signOut; keyboard a11y.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockSignOut = jest.fn();

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    error: null,
    signIn: jest.fn(),
    signOut: mockSignOut,
  }),
}));

import { UserMenu } from '../../components/UserMenu';

function createUser(email = 'user@example.com'): User {
  return {
    id: 'user-uuid',
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-05-14T12:00:00.000Z',
  } as User;
}

describe('UserMenu (AC21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing (null) when user prop is null', () => {
    const { container } = render(<UserMenu user={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders avatar button when user is non-null', () => {
    render(<UserMenu user={createUser()} />);
    expect(screen.getByRole('button', { name: /cuenta/i })).toBeInTheDocument();
  });

  it('opens dropdown with email when avatar is clicked', async () => {
    render(<UserMenu user={createUser('test@example.com')} />);

    await userEvent.click(screen.getByRole('button', { name: /cuenta/i }));

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it('closes dropdown when Escape is pressed', async () => {
    render(<UserMenu user={createUser()} />);

    await userEvent.click(screen.getByRole('button', { name: /cuenta/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('calls signOut and pushes to / when "Cerrar sesión" is clicked (AC21)', async () => {
    mockSignOut.mockResolvedValueOnce(undefined);
    render(<UserMenu user={createUser()} />);

    await userEvent.click(screen.getByRole('button', { name: /cuenta/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cerrar sesión/i }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('disables signOut button while signing out', async () => {
    mockSignOut.mockReturnValue(new Promise(() => {}));
    render(<UserMenu user={createUser()} />);

    await userEvent.click(screen.getByRole('button', { name: /cuenta/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cerrar sesión/i }));

    await waitFor(() => {
      const btn = screen.getByRole('menuitem', { name: /cerrando/i });
      expect(btn).toBeDisabled();
    });
  });

  it('opens dropdown with Enter key on avatar button', async () => {
    render(<UserMenu user={createUser()} />);

    screen.getByRole('button', { name: /cuenta/i }).focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
