'use client';

// UserMenu — F107a (ADR-025 R3 §6)
// Avatar dropdown with email display and sign-out.
// Plain Tailwind + aria-* attributes (no Radix UI — not installed, ADR-025 F6).
// Keyboard a11y: Enter/Space opens, Escape closes, ArrowDown moves to first item.
// Returns null when user prop is null (parent controls visibility).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/useAuth';

interface UserMenuProps {
  user: User | null;
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const { signOut } = useAuth();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape and outside click
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstItem = menuRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null;
        firstItem?.focus();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/');
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }, [signOut, router]);

  if (!user) return null;

  const initials = (user.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="relative ml-auto">
      {/* Avatar button */}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Cuenta"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-offset-2"
      >
        {initials}
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Opciones de cuenta"
          className="absolute right-0 top-10 z-50 min-w-[200px] rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
        >
          {/* Email display — not interactive */}
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>

          {/* Sign out */}
          <button
            role="menuitem"
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  );
}
