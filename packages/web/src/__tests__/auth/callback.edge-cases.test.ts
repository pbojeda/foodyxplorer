// F107a-FU3 QA: AuthCallback Route Handler — edge-case tests
//
// Covers scenarios NOT exercised by the primary callback.test.ts:
//   - empty-string ?token_hash= (falsy → falls through to Priority 4)
//   - empty-string ?error= (falsy → Priority 1 skipped; falls through to token_hash/code/neither)
//   - empty-string ?code= (falsy → falls through to Priority 4)
//   - empty-string ?error= combined with valid token_hash (verifyOtp IS called — documented behaviour)
//   - mixed-case type values ('Email', 'EMAIL', 'Magiclink') → rejected as invalid
//   - type with trailing space ('email ') → rejected as invalid
//   - URL-encoded type value ('email%20') → rejected (decoded to 'email ' by searchParams.get)
//   - whitespace-only token_hash (' ') → passes dispatch (truthy string), verifyOtp called with it
//   - AC11 gap: ?error=server_error + token_hash present → error path taken (callback_failed, no verifyOtp)
//   - duplicate token_hash params → searchParams.get() takes first value (standard URL behaviour)

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
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});

jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

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

/** Build a Request with a raw query string, bypassing the set()-based helper above. */
function makeRawRequest(rawQuery: string): Request {
  return new Request(`http://localhost:3002/auth/callback${rawQuery ? '?' + rawQuery : ''}`);
}

describe('AuthCallback Route Handler — edge cases (F107a-FU3 QA)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  // ---------------------------------------------------------------------------
  // Empty-string param variants
  // ---------------------------------------------------------------------------

  it('empty token_hash (?token_hash=) is falsy — falls to Priority 4 callback_failed', async () => {
    // The handler should redirect to callback_failed (empty string is falsy, Priority 4)
    await expect(GET(makeRawRequest('token_hash='))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('empty code (?code=) is falsy — falls to Priority 4 callback_failed', async () => {
    await expect(GET(makeRawRequest('code='))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('empty error (?error=) is falsy — Priority 1 skipped, falls to Priority 4 callback_failed', async () => {
    // empty error string is falsy in JS; handler skips the error branch entirely
    await expect(GET(makeRawRequest('error='))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('empty error (?error=) with valid token_hash — verifyOtp IS called (empty error skips P1)', async () => {
    // Documented behaviour: ?error= is falsy, so Priority 1 is not triggered.
    // token_hash is present and truthy → Priority 2 executes → verifyOtp called.
    // This is safe: verifyOtp requires a valid server-side token; manipulation provides no gain.
    await expect(GET(makeRawRequest('error=&token_hash=valid-hash&type=email'))).rejects.toThrow(
      'NEXT_REDIRECT:/hablar'
    );
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'valid-hash', type: 'email' });
    expect(mockRedirect).toHaveBeenCalledWith('/hablar');
  });

  // ---------------------------------------------------------------------------
  // type param case-sensitivity and whitespace
  // ---------------------------------------------------------------------------

  it('type=Email (capital E) is rejected — callback_failed, no verifyOtp', async () => {
    await expect(GET(makeRequest({ token_hash: 'valid-hash', type: 'Email' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('type=EMAIL (all caps) is rejected — callback_failed, no verifyOtp', async () => {
    await expect(GET(makeRequest({ token_hash: 'valid-hash', type: 'EMAIL' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('type=Magiclink (mixed case) is rejected — callback_failed, no verifyOtp', async () => {
    await expect(
      GET(makeRequest({ token_hash: 'valid-hash', type: 'Magiclink' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('type with trailing space ("email ") is rejected — callback_failed, no verifyOtp', async () => {
    // searchParams.set() does NOT percent-encode space here; value stored as-is.
    // The allowlist check ['email','magiclink'].includes('email ') is false → rejected.
    await expect(GET(makeRequest({ token_hash: 'valid-hash', type: 'email ' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('URL-encoded type (?type=email%20) is rejected after percent-decode to "email "', async () => {
    // URL.searchParams.get() percent-decodes values. 'email%20' → 'email ' → rejected.
    await expect(GET(makeRawRequest('token_hash=valid-hash&type=email%20'))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // ---------------------------------------------------------------------------
  // Whitespace-only token_hash
  // ---------------------------------------------------------------------------

  it('whitespace-only token_hash (?token_hash= ) is truthy — verifyOtp called, returns error → callback_failed', async () => {
    // A single space is truthy in JS. It reaches verifyOtp, which Supabase rejects.
    // The error path (verifyError truthy) then redirects to callback_failed.
    mockVerifyOtp.mockResolvedValueOnce({ data: null, error: { message: 'Invalid token' } });
    await expect(GET(makeRawRequest('token_hash=%20&type=email'))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: ' ', type: 'email' });
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // ---------------------------------------------------------------------------
  // Precedence: error (non-access_denied) + token_hash
  // ---------------------------------------------------------------------------

  it('AC11 gap: ?error=server_error + token_hash → error path, callback_failed, no verifyOtp', async () => {
    // AC11 in primary tests only covers error=access_denied + token_hash.
    // This covers the non-access_denied branch (callback_failed, not silent /login).
    await expect(
      GET(makeRequest({ error: 'server_error', token_hash: 'valid-hash', type: 'email' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('?error=access_denied + code present → silent /login, no exchangeCodeForSession', async () => {
    await expect(
      GET(makeRequest({ error: 'access_denied', code: 'valid-code' }))
    ).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  // ---------------------------------------------------------------------------
  // Duplicate query params
  // ---------------------------------------------------------------------------

  it('duplicate token_hash params — first value used (standard URL behaviour)', async () => {
    // URL.searchParams.get() returns the first occurrence when a key appears multiple times.
    await expect(
      GET(makeRawRequest('token_hash=first-hash&token_hash=second-hash&type=email'))
    ).rejects.toThrow('NEXT_REDIRECT:/hablar');
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'first-hash', type: 'email' });
  });

  // ---------------------------------------------------------------------------
  // NEXT_REDIRECT re-throw: redirect called inside catch body must propagate
  // ---------------------------------------------------------------------------

  it('NEXT_REDIRECT from redirect() inside catch body propagates correctly', async () => {
    // verifyOtp throws a non-redirect error. Catch block calls redirect('/login?error=callback_failed').
    // That redirect() also throws NEXT_REDIRECT. Since there is no enclosing try around the catch
    // body, the throw propagates naturally. The test confirms the final redirect destination.
    mockVerifyOtp.mockRejectedValueOnce(new Error('Supabase unavailable'));
    await expect(GET(makeRequest({ token_hash: 'valid-hash', type: 'email' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  it('NEXT_REDIRECT from redirect() inside exchangeCodeForSession catch body propagates correctly', async () => {
    mockExchangeCodeForSession.mockRejectedValueOnce(new Error('Network error'));
    await expect(GET(makeRequest({ code: 'valid-code' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=callback_failed'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });

  // ---------------------------------------------------------------------------
  // Null-byte / injection attempt in type param (belt-and-suspenders)
  // ---------------------------------------------------------------------------

  it('type param with null byte ("email\\x00") is rejected — allowlist check fails', async () => {
    await expect(
      GET(makeRawRequest('token_hash=valid-hash&type=email%00'))
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=callback_failed');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/login?error=callback_failed');
  });
});
