// PROTOTYPE — `/hablar-v2` parallel route for empirical validation of the
// FU7 rebuild architecture (composer in-column + native overflow-y-auto +
// pin-aware auto-scroll). NOT for production use. NO auth, NO voice, NO photo.
// Test panel embedded for manual operator validation on iOS Safari + web.
//
// Plan: validate the architecture on a real iPhone BEFORE committing to the
// full rebuild. If this layout works (composer stays above keyboard, no
// horizontal clipping, pin-aware scroll behaves) → confirm FU7 spec and
// proceed. If it fails (e.g. iOS keyboard hides composer) → know empirically
// to pivot before touching production.
//
// Delete this route + HablarV2Shell when FU7 ships or pivots.

import type { Metadata } from 'next';
import { HablarV2Shell } from '@/components/HablarV2Shell';

export const metadata: Metadata = {
  title: '/hablar-v2 (prototype) — nutriXplorer',
  description: 'FU7 architectural prototype — empirical iOS Safari validation',
  robots: 'noindex,nofollow',
};

export default function HablarV2Page() {
  return <HablarV2Shell />;
}
