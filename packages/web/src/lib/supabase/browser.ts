// Supabase browser client factory — F107a (ADR-025 R3).
// Singleton: one client instance per browser page lifecycle.
// Used in AuthProvider (client component) and useAuth hook.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

// Placeholder values used ONLY when env vars are missing (e.g. CI build that
// prerenders /_not-found etc.). They produce a syntactically-valid client that
// will fail loud on actual auth API calls — the error surfaces at runtime as
// a fetch error to a non-existent host, not at module load.
//
// Real production env vars MUST be set in Vercel (operator runbook AC24).
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

/**
 * Returns the module-level singleton Supabase browser client.
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY at runtime.
 *
 * Behaviour when env vars are missing:
 * - Returns a client constructed with placeholder values (so static prerender
 *   during `next build` does not crash; addresses F107a CI build blocker
 *   2026-05-15).
 * - The placeholder client fails on actual auth API calls — operator must
 *   set real values in Vercel before users can authenticate.
 * - A console warning is emitted on first use to surface misconfiguration.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !key) {
    // Emit warning only in browser (avoid noise in build logs)
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[F107a] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY missing — Supabase client running with placeholder values. Authentication will not work until env vars are set in Vercel.',
      );
    }
    client = createBrowserClient(PLACEHOLDER_URL, PLACEHOLDER_KEY);
    return client;
  }

  client = createBrowserClient(url, key);
  return client;
}
