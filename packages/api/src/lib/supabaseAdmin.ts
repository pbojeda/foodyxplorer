// supabaseAdmin.ts — Lazy Supabase admin client singleton (F107a)
//
// Used ONLY by /auth/login (signInWithOtp) and /auth/logout (admin.signOut).
// NOT used by /me — that uses Prisma directly.
//
// Pattern: lazy singleton — created on first call, reused thereafter.
// Throws AUTH_PROVIDER_UNAVAILABLE if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY
// are absent at call time (validated at invocation, not at startup).

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _instance: SupabaseClient | null = null;
let _configKey: string | null = null;

// ---------------------------------------------------------------------------
// getSupabaseAdmin
// ---------------------------------------------------------------------------

/**
 * Returns the Supabase admin client singleton.
 * Creates a new client if one does not yet exist or if config changed.
 *
 * @param config  Application config (must have SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 * @throws Error { code: 'AUTH_PROVIDER_UNAVAILABLE' } when env vars are absent
 */
export function getSupabaseAdmin(config: Pick<Config, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): SupabaseClient {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = config;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(
      new Error(
        'Supabase admin client is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)',
      ),
      { code: 'AUTH_PROVIDER_UNAVAILABLE' },
    );
  }

  const cacheKey = `${SUPABASE_URL}:${SUPABASE_SERVICE_ROLE_KEY.slice(0, 8)}`;
  if (!_instance || _configKey !== cacheKey) {
    _instance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    _configKey = cacheKey;
  }

  return _instance;
}

/**
 * Reset singleton — exposed for testing only.
 * @internal
 */
export function _resetSupabaseAdminForTesting(): void {
  _instance = null;
  _configKey = null;
}
