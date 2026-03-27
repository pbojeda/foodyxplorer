/**
 * Mock for lucide-react icons in Jest tests.
 * Replaces SVG icon components with simple span elements to avoid
 * React child rendering issues with the root workspace's React 18.
 */
import React from 'react';

function createIconMock(name: string) {
  const Icon = ({ className, 'aria-hidden': ariaHidden }: { className?: string; 'aria-hidden'?: string | boolean }) =>
    React.createElement('span', {
      'data-testid': `icon-${name}`,
      className,
      'aria-hidden': ariaHidden,
    });
  Icon.displayName = name;
  return Icon;
}

export const AlertTriangle = createIconMock('AlertTriangle');
export const ArrowRight = createIconMock('ArrowRight');
export const BadgeCheck = createIconMock('BadgeCheck');
export const CheckCircle2 = createIconMock('CheckCircle2');
export const Clock3 = createIconMock('Clock3');
export const Quote = createIconMock('Quote');
export const Search = createIconMock('Search');
export const ShieldCheck = createIconMock('ShieldCheck');
export const Sparkles = createIconMock('Sparkles');
