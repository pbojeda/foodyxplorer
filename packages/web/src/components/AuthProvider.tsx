'use client';

// AuthProvider — F107a (ADR-025 R3 §6)
// Mounts the browser Supabase client, subscribes to onAuthStateChange,
// and provides AuthContext to the component tree.

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface SignInOptions {
  email?: string;
  redirectTo: string;
}

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: (provider: 'email' | 'google', options: SignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Memoize the client so the subscription effect only runs once
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const signIn = useCallback(
    async (provider: 'email' | 'google', options: SignInOptions) => {
      setError(null);
      const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
      if (!baseUrl) throw new Error('NEXT_PUBLIC_API_URL is not defined.');

      const body =
        provider === 'email'
          ? { provider, email: options.email, redirectTo: options.redirectTo }
          : { provider, redirectTo: options.redirectTo };

      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = (json['error'] ?? {}) as Record<string, unknown>;
        const msg =
          typeof errObj['message'] === 'string'
            ? errObj['message']
            : `Login failed (HTTP ${response.status})`;
        setError(msg);
        throw new Error(msg);
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
    if (baseUrl && session?.access_token) {
      await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).catch(() => {
        // Silent — proceed to local signOut regardless
      });
    }
    await supabase.auth.signOut();
  }, [supabase, session]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading, error, signIn, signOut }),
    [user, session, loading, error, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
