// AuthCallback Route Handler — F107a (ADR-025 R3 §6)
// GET /auth/callback — PKCE code exchange via Supabase server client.
// S3 error code mapping:
//   access_denied     → /login (silent, no error param — user cancelled)
//   server_error      → /login?error=callback_failed
//   invalid_request   → /login?error=callback_failed
//   unauthorized_client → /login?error=callback_failed
//   <any other error> → /login?error=callback_failed
//   missing code      → /login?error=callback_failed

import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request): Promise<never> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Handle OAuth/PKCE error params from Supabase
  if (error) {
    if (error === 'access_denied') {
      // Silent redirect — user cancelled or denied (ADR-025 R3 §6)
      redirect('/login');
    }
    // All other error codes map to callback_failed
    redirect('/login?error=callback_failed');
  }

  // No code and no error — unexpected state
  if (!code) {
    redirect('/login?error=callback_failed');
  }

  // PKCE code exchange
  try {
    const supabase = await getSupabaseServerClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      redirect('/login?error=callback_failed');
    }
  } catch (err) {
    // If the error is a Next.js redirect (thrown internally by redirect()), re-throw it
    const isRedirectError =
      err instanceof Error && (err as Error & { digest?: string }).digest?.startsWith('NEXT_REDIRECT');
    if (isRedirectError) throw err;

    redirect('/login?error=callback_failed');
  }

  redirect('/hablar');
}
