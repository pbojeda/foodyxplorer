import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

const AUDIENCE_CARDS = [
  {
    name: 'Quien cuenta macros',
    body: 'Quieres disfrutar de comer fuera sin perder de vista calorías, proteína y objetivo diario.',
    cta: 'Quiero ese control',
    image: '/images/for-who-fitness-guy.jpg',
    imageAlt: 'Persona deportista consultando información nutricional en su móvil',
  },
  {
    name: 'Quien evita alérgenos',
    body: 'Necesitas una regla clara: distinguir lo verificado de lo que solo puede estimarse.',
    cta: 'Necesito esa claridad',
    image: '/images/trust-allergen-family.png',
    imageAlt: 'Familia disfrutando de una comida segura sin preocupaciones por alérgenos',
  },
  {
    name: 'Quien busca equilibrio',
    body: 'Te importa comer bien, pero no quieres convertir cada salida en una hoja de cálculo.',
    cta: 'Eso es lo que busco',
    image: '/images/emotional-friends-dining.jpg',
    imageAlt: 'Amigos disfrutando de una cena en restaurante de forma equilibrada',
  },
  {
    name: 'Quien decide sobre la marcha',
    body: 'Viajas, comes fuera y quieres elegir rápido sin perder contexto ni improvisar demasiado.',
    cta: 'Lo necesito al viajar',
    image: '/images/restaurants-map-street.jpg',
    imageAlt: 'Calle con restaurantes de una ciudad española, vista aérea',
  },
];

/**
 * AudienceGrid — 4 lifestyle image cards showing different user profiles.
 * Each card has a darkened image background with white text overlay.
 * Server Component.
 */
export function AudienceGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {AUDIENCE_CARDS.map((card) => (
        <div
          key={card.name}
          className="relative h-[320px] overflow-hidden rounded-[32px] group"
        >
          {/* Background image */}
          <Image
            src={card.image}
            alt={card.imageAlt}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
          />
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/85 via-slate-900/40 to-slate-900/10" />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col justify-end p-6">
            <div className="text-xs font-semibold uppercase tracking-widest text-brand-orange mb-2">
              Empieza si tú eres…
            </div>
            <h3 className="mb-2 text-xl font-semibold text-white">{card.name}</h3>
            <p className="mb-4 text-sm leading-6 text-white/80">{card.body}</p>
            <a
              href="#waitlist"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white transition hover:text-brand-orange"
            >
              {card.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
