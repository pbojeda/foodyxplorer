// F107a: AuthCallback Route Handler tests — AC22 server side.
// F107a-FU3: Extended for dual-dispatch (token_hash/verifyOtp + code/exchangeCodeForSession).
// Tests: code exchange success, all S3 error codes, missing code, exchange throws,
//        verifyOtp happy path, verifyOtp error/throw, invalid type, precedence.

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockExchangeCodeForSession = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('../../lib/supabase/server', () => ({
  getSupabaseServerClient: jest.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  }),
}));

const mockRedirect = jest.fn((url: string) => {
  // Next.js redirect() throws a special error object — simulate that behavior
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});

jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

// Mock next/headers cookies — F4 self-review: must return { getAll, set } shape
// compatible with @supabase/ssr cookie adapter
const mockCookieStore = {
  getAll: jest.fn().mockReturnValue([]),
  set: jest.fn(),
};
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue(mockCookieStore),
}));

import { GET } from '../../app/auth/callback/route';

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost:3002/auth/callback');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

describe('AuthCallback Route Handler (AC22)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  it('calls exchangeCodeForSession and redirects to /hablar on success', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ data: { session: {} }, error: null });

    await expect(GET(makeRequest({ code: 'valid-pkce-code' }))).rejects.toThrow(
      'NEXT_REDIRECT:/hablar'
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-pkce-code');
    expect(mockRedirect).toHaveBeenCalledWith('/hablar');
  });

  it('redirects to /login (no error param) when ?error=access_denied (AC22 silent)', async () => {
    await expect(
      GET(makeRequest({ error: 'access_denied', error_description: 'User cancelled' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login');

    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('redirects to /login?error=callback_failed for ?error=server_error', async () => {
    await expect(
      GET(makeRequest({ error: 'server_error' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('redirects to /login?error=callback_failed for ?error=invalid_request', async () => {
    await expect(
      GET(makeRequest({ error: 'invalid_request' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('redirects to /login?error=callback_failed for ?error=unauthorized_client', async () => {
    await expect(
      GET(makeRequest({ error: 'unauthorized_client' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('redirects to /login?error=callback_failed for unsupported/unknown error codes', async () => {
    await expect(
      GET(makeRequest({ error: 'unsupported_grant_type' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('redirects to /login?error=callback_failed when no code AND no error param', async () => {
    await expect(GET(makeRequest({}))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('redirects to /login?error=callback_failed when exchangeCodeForSession throws', async () => {
    mockExchangeCodeForSession.mockRejectedValueOnce(new Error('Network error'));

    await expect(GET(makeRequest({ code: 'bad-code' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('redirects to /login?error=callback_failed when exchangeCodeForSession returns error', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { message: 'PKCE failed' },
    });

    await expect(GET(makeRequest({ code: 'bad-code' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // ---------------------------------------------------------------------------
  // F107a-FU3: verifyOtp (token_hash) dispatch tests
  // ---------------------------------------------------------------------------

  // AC1 — token_hash + type=email → verifyOtp called, exchangeCodeForSession NOT called, /hablar
  it('AC1: calls verifyOtp with token_hash+type=email and redirects to /hablar', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'valid-hash', type: 'email' }))
    ).rejects.toThrow('NEXT_REDIRECT:/hablar');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'valid-hash', type: 'email' });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/hablar');
  });

  // AC2 — token_hash, no type → defaults to 'email'
  it('AC2: token_hash without type defaults type to email and redirects to /hablar', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'valid-hash' }))
    ).rejects.toThrow('NEXT_REDIRECT:/hablar');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'valid-hash', type: 'email' });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  // AC3 — verifyOtp returns error → callback_failed
  it('AC3: redirects to /login?error=callback_failed when verifyOtp returns error', async () => {
    mockVerifyOtp.mockResolvedValueOnce({ data: null, error: { message: 'Token expired' } });

    await expect(
      GET(makeRequest({ token_hash: 'expired-hash', type: 'email' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // AC4 — verifyOtp throws → callback_failed
  it('AC4: redirects to /login?error=callback_failed when verifyOtp throws', async () => {
    mockVerifyOtp.mockRejectedValueOnce(new Error('Network failure'));

    await expect(
      GET(makeRequest({ token_hash: 'valid-hash', type: 'email' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // AC5 — invalid type (not in allowed set) → callback_failed, neither fn called
  it('AC5: redirects to /login?error=callback_failed for invalid type param, no fn called', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'valid-hash', type: 'phone' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // AC10 — both token_hash AND code present → token_hash wins (verifyOtp called, not exchangeCodeForSession)
  it('AC10: token_hash takes precedence over code when both present', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'hash-x', code: 'code-y', type: 'email' }))
    ).rejects.toThrow('NEXT_REDIRECT:/hablar');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-x', type: 'email' });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  // AC11 — error param takes precedence over token_hash
  it('AC11: error param takes precedence over token_hash — silent /login for access_denied', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'hash-x', error: 'access_denied' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login');

    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  // AC18 — type=magiclink accepted
  it('AC18: type=magiclink is accepted and calls verifyOtp with type=magiclink', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'valid-hash', type: 'magiclink' }))
    ).rejects.toThrow('NEXT_REDIRECT:/hablar');

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'valid-hash', type: 'magiclink' });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
