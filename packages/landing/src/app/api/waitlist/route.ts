import { z } from 'zod';

const waitlistSchema = z.object({
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val.trim() === '') return true;
        const stripped = val.replace(/\s/g, '');
        return /^\+\d{7,15}$/.test(stripped);
      },
      { message: 'Invalid phone number format' }
    ),
});

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    // Progressive enhancement: native form POST (no JS)
    const formData = await request.formData();
    const email = formData.get('email') as string | null;
    const phone = (formData.get('phone') as string | null) ?? undefined;
    const rawVariant = (formData.get('variant') as string | null) ?? 'a';
    const variant = ['a', 'c', 'd', 'f'].includes(rawVariant) ? rawVariant : 'a';

    const result = waitlistSchema.safeParse({ email, phone });

    if (!result.success) {
      return new Response(null, {
        status: 303,
        headers: { location: `/?variant=${variant}&waitlist=error` },
      });
    }

    // TODO: persist result.data to waitlist storage
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
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const result = waitlistSchema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.errors[0]?.message ?? 'Invalid data';
    return Response.json({ success: false, error: firstError }, { status: 400 });
  }

  // TODO: persist result.data to waitlist storage
  return Response.json({ success: true }, { status: 200 });
}
