// Next.js Route Handler proxy for POST /analyze/menu (F092).
//
// The browser cannot attach the private API_KEY header — exposing it as
// NEXT_PUBLIC_ would share a single key across all users and allow extraction
// via browser DevTools. This server-side proxy attaches API_KEY from the
// server environment and forwards the multipart request to Fastify.
//
// Key invariants:
// - Reads API_KEY from process.env (server-only, NOT NEXT_PUBLIC_)
// - Forwards Content-Type header unchanged (must preserve multipart boundary)
// - Passes X-Actor-Id and X-FXP-Source through from the client
// - All proxy-level failures use the structured envelope
//     { error: { code, message } }
//   so that apiClient.ts can surface specific codes to the UI and metrics.
// - Upstream fetch is bounded by a 65 s AbortSignal.timeout to prevent
//   indefinite hangs when the backend is unresponsive (BUG-PROD-001).

const UPSTREAM_TIMEOUT_MS = 65_000;

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env['API_KEY'];
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'];

  if (!apiKey || !apiUrl) {
    return new Response(
      errorBody('CONFIG_ERROR', 'API key or upstream URL not configured'),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // Build merged headers: preserve Content-Type (multipart boundary!), inject API key,
  // pass through X-Actor-Id and X-FXP-Source from the client request.
  const mergedHeaders = new Headers();

  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    mergedHeaders.set('Content-Type', contentType);
  }

  mergedHeaders.set('X-API-Key', apiKey);

  const actorId = request.headers.get('X-Actor-Id');
  if (actorId) {
    mergedHeaders.set('X-Actor-Id', actorId);
  }

  const source = request.headers.get('X-FXP-Source');
  if (source) {
    mergedHeaders.set('X-FXP-Source', source);
  }

  // Proxy the request body as-is (multipart stream).
  // duplex: 'half' is required by the fetch spec when sending a streaming body.
  // signal: AbortSignal.timeout(65s) protects against backend hangs — matches
  //   the hard client timeout in apiClient.sendPhotoAnalysis.
  const upstreamRequest = new Request(`${apiUrl}/analyze/menu`, {
    method: 'POST',
    headers: mergedHeaders,
    body: request.body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    // @ts-expect-error duplex is required for streaming body in Node.js fetch
    duplex: 'half',
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamRequest);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return new Response(
        errorBody('UPSTREAM_TIMEOUT', 'Upstream API did not respond in time'),
        {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response(
      errorBody('UPSTREAM_UNAVAILABLE', 'Upstream API unreachable'),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // Return the upstream response as-is (body + status code).
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
