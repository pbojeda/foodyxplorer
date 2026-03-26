import Image from 'next/image';
import type { Dictionary } from '@/lib/i18n';

interface ForWhoSectionProps {
  dict: Dictionary['forWho'];
}

const profileImages = [
  {
    src: '/images/for-who-fitness.png',
    alt: 'Persona consciente de su alimentación revisando información nutricional',
  },
  {
    src: '/images/for-who-family-gluten-free.png',
    alt: 'Familia gestionando alérgenos en restaurantes, verificando información de platos',
  },
  {
    src: '/images/trust-engine-huevos-rotos.png',
    alt: 'Persona mayor disfrutando de una comida saludable con información nutricional clara',
  },
  {
    src: '/images/how-it-works-menu.png',
    alt: 'Profesional consultando el menú del día con nutriXplorer en su teléfono',
  },
];

export function ForWhoSection({ dict }: ForWhoSectionProps) {
  return (
    <section
      aria-labelledby="for-who-heading"
      data-section="for-who"
      className="bg-ivory py-16 md:py-20"
    >
      <div className="max-w-[1200px] mx-auto px-5 md:px-8 lg:px-10">
        {/* Header — deliberately LEFT-aligned (breaks centered pattern) */}
        <div className="mb-10 md:mb-12">
          <p className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-3">
            {dict.eyebrow}
          </p>
          <h2
            id="for-who-heading"
            className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-slate-900 max-w-[640px]"
          >
            {dict.headline}
          </h2>
        </div>

        {/* 2x2 grid on desktop, 1 col on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {dict.profiles.map((profile, index) => {
            const image = profileImages[index];
            return (
              <div
                key={profile.title}
                className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-hidden hover:-translate-y-1 hover:shadow-layered transition-all duration-300"
              >
                {/* Profile image — 4:3 aspect */}
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={image?.src ?? '/images/hero-telegram-restaurant.png'}
                    alt={image?.alt ?? profile.title}
                    width={600}
                    height={450}
                    className="object-cover w-full h-full"
                    sizes="(max-width: 768px) 100vw, 50vw"
                    loading="lazy"
                  />
                </div>
                {/* Card content */}
                <div className="p-6 md:p-8">
                  <h3 className="text-lg md:text-xl font-semibold text-slate-900 mb-3">
                    {profile.title}
                  </h3>
                  <p className="text-base leading-relaxed text-slate-600">
                    {profile.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
