import Image from 'next/image';

/**
 * VisualDivider — full-bleed decorative strip with a blurred food photo.
 * Purely visual, aria-hidden. Breaks visual monotony between sections.
 */
export function VisualDivider() {
  return (
    <div aria-hidden="true" className="relative h-24 overflow-hidden py-0">
      <Image
        src="/images/emotional-friends-dining.jpg"
        alt=""
        fill
        className="object-cover object-center blur-sm scale-105 brightness-50"
        sizes="100vw"
      />
    </div>
  );
}
