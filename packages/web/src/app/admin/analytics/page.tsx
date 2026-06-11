// Admin analytics page — F-ADMIN-ANALYTICS-UI.
// Server Component: no 'use client' — each panel manages its own client state.
// Design spec: W28 (panel stack).

import type { Metadata } from 'next';
import { MissedQueriesPanel } from '@/components/admin/MissedQueriesPanel';
import { ResponseReviewPanel } from '@/components/admin/ResponseReviewPanel';
import { OverviewPanel } from '@/components/admin/OverviewPanel';

export const metadata: Metadata = {
  title: 'Analytics · Admin · nutriXplorer',
};

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-8">
      <MissedQueriesPanel />
      <ResponseReviewPanel />
      <OverviewPanel />
    </div>
  );
}
