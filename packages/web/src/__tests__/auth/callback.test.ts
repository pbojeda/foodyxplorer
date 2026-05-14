// F107a: AuthCallback Route Handler tests — AC22 server side.
// Tests: code exchange success, all S3 error codes, missing code, exchange throws.

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockExchangeCodeForSession = jest.fn();

jest.mock('../../lib/supabase/server', () => ({
  getSupabaseServerClient: jest.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
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
});
