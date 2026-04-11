'use client';

import { trackEvent } from '@/lib/analytics';
import type { Variant } from '@/types';

interface HeaderCTAProps {
  hablarBaseUrl: string | null;
  variant: Variant;
}

const WAITLIST_CTA = 'Probar gratis';

/**
 * HeaderCTA — thin Client Component for the desktop navigation CTA.
 * Extracted from SiteHeader so SiteHeader can remain a pure Server Component.
 *
 * When hablarBaseUrl is set: links to /hablar with header_cta UTM params,
 * opens in new tab, fires cta_hablar_click analytics event.
 * When hablarBaseUrl is null: falls back to #waitlist anchor, no analytics.
 */
export function HeaderCTA({ hablarBaseUrl, variant }: HeaderCTAProps) {
  const isExternal = hablarBaseUrl !== null;
  const href = isExternal
    ? `${hablarBaseUrl}?utm_source=landing&utm_medium=header_cta`
    : '#waitlist';

  function handleClick() {
    if (!isExternal) return;
    trackEvent({
      event: 'cta_hablar_click',
      source: 'header',
      variant,
      lang: 'es',
      utm_medium: 'header_cta',
    });
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="rounded-full bg-botanical px-4 py-2 text-sm font-semibold text-white transition hover:scale-[1.02]"
    >
      {WAITLIST_CTA}
    </a>
  );
}
