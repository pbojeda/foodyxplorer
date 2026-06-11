'use client';

// AuthProvider — F107a (ADR-025 R3 §6) + F-WEB-TIER
// Mounts the browser Supabase client, subscribes to onAuthStateChange,
// and provides AuthContext to the component tree.
//
// F-WEB-TIER (P-I1): AuthProvider is the authoritative bearer setter.
// setAuthToken() is called on EVERY session change (including TOKEN_REFRESHED).
// getMe() is called only on SIGNED_IN / INITIAL_SESSION events — NOT TOKEN_REFRESHED
// (loop guard: token refresh fires every ~3600s; calling getMe each time would spam
// the endpoint unnecessarily).

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Account } from '@foodxplorer/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { setAuthToken, getMe } from '@/lib/apiClient';

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
  account: Account | null;          // F-WEB-TIER: from GET /me; null before session or on getMe failure
  loading: boolean;
  error: string | null;
  /** F-ADMIN-ANALYTICS-UI: code from last getMe() failure. null = no failure or success. */
  accountErrorCode: 'NOT_PROVISIONED' | 'NETWORK_ERROR' | null;
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
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountErrorCode, setAccountErrorCode] = useState<'NOT_PROVISIONED' | 'NETWORK_ERROR' | null>(null);

  // Memoize the client so the subscription effect only runs once
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);

      // P-I1: AuthProvider is the authoritative setter of the apiClient bearer singleton.
      // Set it on EVERY session change (incl. TOKEN_REFRESHED) so outbound calls
      // use a fresh token — BEFORE getMe() below, so getMe runs with a valid token.
      // HablarShell's existing setAuthToken effect becomes redundant but harmless.
      setAuthToken(newSession?.access_token ?? null);

      // Call getMe only on genuine session establish events — NOT TOKEN_REFRESHED
      // (TOKEN_REFRESHED fires ~every hour for silent refresh; no linking needed then).
      if (
        newSession &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      ) {
        getMe()
          .then((meEnvelope) => {
            setAccount(meEnvelope.data.account);
            setAccountErrorCode(null);
          })
          .catch((err: unknown) => {
            // AC10: non-fatal — log, leave account as null, app continues working.
            // Tier falls back to 'free' (E3). Meter shows "—".
            console.warn('[AuthProvider] getMe failed (non-fatal):', err);
            // F-ADMIN-ANALYTICS-UI: capture error code for AdminGuard 3a/3b branching.
            const code = (err as Record<string, unknown>)?.['code'];
            if (code === 'NOT_PROVISIONED') {
              setAccountErrorCode('NOT_PROVISIONED');
            } else {
              setAccountErrorCode('NETWORK_ERROR');
            }
          });
      }

      if (event === 'SIGNED_OUT') {
        setAccount(null);
        setAccountErrorCode(null);
      }
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
    () => ({ user, session, account, loading, error, accountErrorCode, signIn, signOut }),
    [user, session, account, loading, error, accountErrorCode, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
