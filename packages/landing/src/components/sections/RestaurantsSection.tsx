import Image from 'next/image';
import type { Dictionary } from '@/lib/i18n';

interface RestaurantsSectionProps {
  dict: Dictionary['restaurants'];
}

export function RestaurantsSection({ dict }: RestaurantsSectionProps) {
  return (
    <section
      aria-labelledby="restaurants-heading"
      data-section="restaurants"
      className="bg-ivory py-8 lg:py-12"
    >
      <div className="section-shell">
        <div className="card-surface overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Text content */}
            <div className="p-6 md:p-10">
              <div className="mb-2 text-[13px] font-semibold uppercase tracking-widest text-brand-orange">
                {dict.eyebrow}
              </div>
              <h2
                id="restaurants-heading"
                className="mb-3 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl"
              >
                {dict.headline}
              </h2>
              <p className="mb-8 max-w-xl text-base leading-relaxed text-slate-600">{dict.subtitle}</p>

              <div className="grid gap-4 sm:grid-cols-3">
                {dict.items.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft"
                  >
                    <div className="text-base font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-sm text-botanical">{item.note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Side image */}
            <div className="relative hidden lg:block min-h-[280px]">
              <Image
                src="/images/restaurants-map-street.jpg"
                alt="Vista de calle con restaurantes en una ciudad española"
                fill
                className="object-cover"
                sizes="50vw"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
