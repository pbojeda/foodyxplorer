// AuthCallback Route Handler — F107a (ADR-025 R3 §6), F107a-FU3 (token_hash dual-dispatch)
// GET /auth/callback — 4-priority dispatch:
//
//   Priority 1 — ?error present
//     access_denied   → /login               (silent, user cancelled)
//     any other value → /login?error=callback_failed
//
//   Priority 2 — ?token_hash present (magic-link OTP, Supabase SSR canonical pattern)
//     type validated against ALLOWED_OTP_TYPES (['email', 'magiclink']); defaults to 'email'.
//     invalid type    → /login?error=callback_failed  (no verifyOtp call)
//     verifyOtp ok    → /hablar
//     verifyOtp error → /login?error=callback_failed
//
//   Priority 3 — ?code present (OAuth PKCE, forward-compat for F107a-FU1)
//     exchangeCodeForSession ok    → /hablar
//     exchangeCodeForSession error → /login?error=callback_failed
//
//   Priority 4 — neither token_hash nor code present
//     → /login?error=callback_failed

import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const ALLOWED_OTP_TYPES = ['email', 'magiclink'] as const;
type AllowedOtpType = (typeof ALLOWED_OTP_TYPES)[number];

function narrowOtpType(raw: string | null): AllowedOtpType | null {
  const value = raw ?? 'email';
  if ((ALLOWED_OTP_TYPES as readonly string[]).includes(value)) {
    return value as AllowedOtpType;
  }
  return null;
}

// next/navigation redirect() throws a NEXT_REDIRECT control-flow error; it must
// be re-thrown when it surfaces inside a catch so the redirect actually happens
// (a swallowed redirect would silently break auth). Defined once and shared by
// both verification branches to keep this security-sensitive idiom in one place.
function rethrowIfRedirect(err: unknown): void {
  if (err instanceof Error && (err as Error & { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) {
    throw err;
  }
}

export async function GET(request: Request): Promise<never> {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get('error');
  const tokenHash = searchParams.get('token_hash');
  const code = searchParams.get('code');

  // Priority 1 — error param present
  if (error) {
    if (error === 'access_denied') {
      redirect('/login');
    }
    redirect('/login?error=callback_failed');
  }

  // Priority 2 — token_hash present (magic-link OTP path)
  if (tokenHash) {
    const otpType = narrowOtpType(searchParams.get('type'));
    if (!otpType) {
      redirect('/login?error=callback_failed');
    }

    try {
      const supabase = await getSupabaseServerClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType,
      });

      if (verifyError) {
        redirect('/login?error=callback_failed');
      }
    } catch (err) {
      rethrowIfRedirect(err);
      redirect('/login?error=callback_failed');
    }

    redirect('/hablar');
  }

  // Priority 3 — code present (OAuth PKCE path, forward-compat F107a-FU1)
  if (code) {
    try {
      const supabase = await getSupabaseServerClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        redirect('/login?error=callback_failed');
      }
    } catch (err) {
      rethrowIfRedirect(err);
      redirect('/login?error=callback_failed');
    }

    redirect('/hablar');
  }

  // Priority 4 — neither token_hash nor code
  redirect('/login?error=callback_failed');
}
