'use client';

import { useState } from 'react';
import { SearchSimulator } from '@/components/SearchSimulator';
import { PostSimulatorCTA } from '@/components/features/PostSimulatorCTA';
import type { Variant } from '@/types';

interface SearchSimulatorWithCTAProps {
  variant: Variant;
}

/**
 * SearchSimulatorWithCTA — wraps SearchSimulator with a post-interaction CTA.
 * The PostSimulatorCTA is hidden until the user interacts with the SearchSimulator.
 * BUG-LANDING-05: CTA was incorrectly visible on initial load; fixed by starting with false.
 */
export function SearchSimulatorWithCTA({ variant }: SearchSimulatorWithCTAProps) {
  // Start with false — CTA only appears after user interaction
  const [hasInteracted, setHasInteracted] = useState(false);

  return (
    <div>
      <SearchSimulator onInteract={() => setHasInteracted(true)} />
      <PostSimulatorCTA variant={variant} show={hasInteracted} />
    </div>
  );
}
