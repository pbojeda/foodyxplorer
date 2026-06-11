// Admin route layout — F-ADMIN-ANALYTICS-UI.
// Server Component shell: noindex metadata + delegates auth guard to AdminGuard (client).
// Design spec: W27 (admin layout shell).

import type { Metadata } from 'next';
import { AdminGuard } from '@/components/admin/AdminGuard';

export const metadata: Metadata = {
  title: 'Admin · nutriXplorer',
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
