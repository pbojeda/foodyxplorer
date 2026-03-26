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
 * The PostSimulatorCTA is visible from the start since SearchSimulator
 * initializes with a default result (pulpo a feira), meaning the user
 * can already see a result when the page loads.
 */
export function SearchSimulatorWithCTA({ variant }: SearchSimulatorWithCTAProps) {
  // Start with true since SearchSimulator defaults to 'result' state
  const [hasInteracted, setHasInteracted] = useState(true);

  return (
    <div>
      <SearchSimulator onInteract={() => setHasInteracted(true)} />
      <PostSimulatorCTA variant={variant} show={hasInteracted} />
    </div>
  );
}
