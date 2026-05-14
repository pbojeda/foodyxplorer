// LoginPage — F107a (ADR-025 R3 §6)
// Server Component wrapper: LoginForm consumes useSearchParams() and must be
// wrapped in <Suspense> for Next.js 15 static prerendering. Matches the
// HablarAnalytics + HablarShell pattern used elsewhere in this app.

import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
