import { z } from 'zod';

const waitlistSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    // Progressive enhancement: native form POST (no JS)
    const formData = await request.formData();
    const email = formData.get('email') as string | null;
    const rawVariant = (formData.get('variant') as string | null) ?? 'a';
    const variant = rawVariant === 'a' || rawVariant === 'b' ? rawVariant : 'a';

    const result = waitlistSchema.safeParse({ email });

    if (!result.success) {
      return new Response(null, {
        status: 303,
        headers: { location: `/?variant=${variant}&waitlist=error` },
      });
    }

    // TODO: persist result.data.email to waitlist storage
    return new Response(null, {
      status: 303,
      headers: { location: `/?variant=${variant}&waitlist=success` },
    });
  }

  // JSON path
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  const result = waitlistSchema.safeParse(body);

  if (!result.success) {
    return Response.json(
      { success: false, error: 'Invalid email' },
      { status: 400 }
    );
  }

  // TODO: persist result.data.email to waitlist storage
  return Response.json({ success: true }, { status: 200 });
}
