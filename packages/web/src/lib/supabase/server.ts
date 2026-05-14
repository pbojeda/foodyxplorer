// Supabase server client factory — F107a (ADR-025 R3).
// Used exclusively in Route Handlers (server context) that need PKCE code exchange.
// Next.js 15: cookies() is async — await it before passing to createServerClient.

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a fresh Supabase server client for Route Handler use.
 * Must be called inside an async Route Handler — uses Next.js 15 async cookies().
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.'
    );
  }

  const cookieStore = await cookies(); // Next.js 15: cookies() returns Promise

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}
