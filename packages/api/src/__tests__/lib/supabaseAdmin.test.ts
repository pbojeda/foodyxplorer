// supabaseAdmin.test.ts — unit tests for the lazy Supabase admin client singleton.
//
// Regression coverage for BUG-PROD-012: on Node < 22 (no global WebSocket),
// `@supabase/supabase-js` createClient eagerly constructs a RealtimeClient whose
// constructor throws ("Node.js 20 detected without native WebSocket support").
// The fix supplies the `ws` transport via `realtime: { transport: ws }`.
//
// The first test simulates the Node < 22 condition deterministically by deleting
// `globalThis.WebSocket`, so it guards the fix regardless of which Node version
// CI happens to run on (CI is Node 22; Render and local dev are Node 20). Without
// the transport option it throws; with it, it does not.
//
// NOTE: this file deliberately does NOT mock '@supabase/supabase-js' — it
// exercises the REAL createClient so the WebSocket code path actually runs. The
// existing f107a route tests all mock createClient, which is exactly why this
// production defect was never caught in CI.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSupabaseAdmin,
  _resetSupabaseAdminForTesting,
} from '../../lib/supabaseAdmin.js';

const VALID_CONFIG = {
  SUPABASE_URL: 'https://example-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(120),
};

const globalRef = globalThis as unknown as Record<string, unknown>;

describe('getSupabaseAdmin', () => {
  beforeEach(() => {
    _resetSupabaseAdminForTesting();
  });

  it('does not throw when global WebSocket is absent (simulates Node < 22) — BUG-PROD-012', () => {
    const savedWebSocket = globalRef['WebSocket'];
    delete globalRef['WebSocket'];
    try {
      expect(() => getSupabaseAdmin(VALID_CONFIG)).not.toThrow();
    } finally {
      if (savedWebSocket !== undefined) {
        globalRef['WebSocket'] = savedWebSocket;
      }
    }
  });

  it('returns the same singleton instance across calls', () => {
    const first = getSupabaseAdmin(VALID_CONFIG);
    const second = getSupabaseAdmin(VALID_CONFIG);
    expect(first).toBe(second);
  });

  it('throws AUTH_PROVIDER_UNAVAILABLE when SUPABASE_URL is absent', () => {
    let caught: { code?: string } | undefined;
    try {
      getSupabaseAdmin({
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(120),
      });
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught?.code).toBe('AUTH_PROVIDER_UNAVAILABLE');
  });

  it('throws AUTH_PROVIDER_UNAVAILABLE when SUPABASE_SERVICE_ROLE_KEY is absent', () => {
    let caught: { code?: string } | undefined;
    try {
      getSupabaseAdmin({
        SUPABASE_URL: 'https://example-ref.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      });
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught?.code).toBe('AUTH_PROVIDER_UNAVAILABLE');
  });
});
