export const es = {
  hero: {
    eyebrow: 'Conoce lo que comes',
    headlineA: 'Come fuera sin ir a ciegas.',
    headlineB: 'Disfruta de comer fuera con más contexto y menos improvisación.',
    subtitleA:
      'Disfruta de comer fuera con más contexto y menos improvisación. Calorías, macros y nivel de confianza visible antes de decidir.',
    subtitleB:
      'Información nutricional de restaurantes españoles con trazabilidad real. Calorías, macros y confianza en cada plato.',
    cta: 'Quiero saber qué como',
    microcopy: 'Sin spam. Sin compromisos. Avisamos cuando lancemos.',
    trustPills: ['Datos verificados', 'Confianza visible', 'Hecho en España'],
  },
  variants: {
    a: {
      hero: {
        eyebrow: 'Conoce lo que comes',
        headline: 'Come fuera sin ir a ciegas.',
        subtitle:
          'Disfruta de comer fuera con más contexto y menos improvisación. Calorías, macros y nivel de confianza visible antes de decidir.',
        supporting: 'Sin spam. Solo lanzamiento y acceso temprano.',
      },
    },
    c: {
      hero: {
        eyebrow: 'El problema que nadie ha resuelto',
        headline: 'Cuando comes fuera, decides a ciegas.',
        subtitle:
          'No sabes cuántas calorías tiene un plato. No sabes si el dato es fiable. Y si hay alergias, improvisar no vale.',
        scrollCta: 'Ver cómo lo solucionamos',
      },
    },
    f: {
      hero: {
        eyebrow: 'Para familias con alergias alimentarias',
        headline: 'Come fuera sin miedo.',
        subtitle:
          'Alérgenos verificados en restaurantes de España. Si no hay dato oficial, no nos la jugamos.',
      },
    },
  },
  postSimulatorCta: {
    headline: '¿Te gusta lo que ves?',
    subtitle: 'Apúntate para acceder cuando lancemos.',
  },
  problem: {
    eyebrow: 'El problema',
    headline: 'Cuando comes fuera, decides casi a ciegas',
    p1: 'Sabes perfectamente lo que comes en casa. Tienes los ingredientes, las proporciones, el control. Pero cuando entras a un restaurante, esa claridad desaparece.',
    p2: 'No sabes cuántas calorías tiene el plato. No sabes si el dato que encuentras en internet es de ese restaurante concreto o de otro completamente diferente. No sabes si hay riesgo por alérgenos. Y si haces seguimiento nutricional, ese día simplemente lo abandonas.',
    p3: 'No debería ser tan difícil. Comer fuera es parte de la vida, no una excepción que hay que gestionar con ansiedad.',
  },
  howItWorks: {
    eyebrow: 'Cómo funciona',
    headline: 'Lo entiendes en 10 segundos',
    steps: [
      {
        title: 'Busca un plato',
        description:
          'Escribe el nombre del plato o el restaurante en nuestro bot de Telegram o en la web. Sin apps que instalar.',
      },
      {
        title: 'Entiende la respuesta',
        description:
          'Calorías, macros, ingredientes principales y el nivel de confianza del dato: verificado, estimado o inferido. Siempre sabes en qué te puedes apoyar.',
      },
      {
        title: 'Decide con contexto',
        description:
          'Elige con más información y menos ansiedad. No hay que ser perfecto: solo tener más claridad para decidir mejor.',
      },
    ],
  },
  trustEngine: {
    eyebrow: 'Reglas de confianza',
    headline: 'Qué hace distinta a cada respuesta',
    subtitle:
      'nutriXplorer no inventa precisión donde no la hay. Cada dato lleva su nivel de confianza visible, para que sepas exactamente en qué te puedes apoyar.',
    levels: [
      {
        badge: 'high' as 'high' | 'medium' | 'low',
        badgeLabel: 'ALTA CONFIANZA',
        title: 'Verificado',
        description:
          'Dato confirmado directamente con el restaurante o de fuentes oficiales con información nutricional certificada. El más fiable.',
      },
      {
        badge: 'medium' as 'high' | 'medium' | 'low',
        badgeLabel: 'MEDIA CONFIANZA',
        title: 'Estimado',
        description:
          'Calculado a partir de recetas estándar, bases nutricionales de referencia y patrones conocidos de preparación. Útil para una orientación clara.',
      },
      {
        badge: 'low' as 'high' | 'medium' | 'low',
        badgeLabel: 'BAJA CONFIANZA',
        title: 'Inferido',
        description:
          'Basado en similitud con platos análogos cuando no hay datos más precisos disponibles. Transparente sobre sus limitaciones.',
      },
    ],
    allergenTitle: 'Guardia de alérgenos',
    allergenDescription:
      'Cuando el dato de alérgenos no está verificado, te lo indicamos claramente. Nunca asumimos que algo es seguro si no lo hemos comprobado.',
  },
  forWho: {
    eyebrow: 'Para quién empieza hoy',
    headline: '¿Te reconoces aquí?',
    profiles: [
      {
        title: 'Cuidas lo que comes',
        description:
          'Haces seguimiento nutricional o simplemente quieres saber lo que entra. Comer fuera no tiene que ser un agujero negro en tu registro.',
      },
      {
        title: 'Gestionas alérgenos',
        description:
          'Tú o alguien de tu familia tiene una alergia o intolerancia. Necesitas certeza, no suposiciones, antes de elegir un plato.',
      },
      {
        title: 'Cuidas tu salud',
        description:
          'Tienes un objetivo de salud o sigues un plan dietético. Quieres seguir disfrutando de salir sin abandonar tu camino.',
      },
      {
        title: 'Sales mucho a comer',
        description:
          'Reuniones, menús del día, compromisos sociales. Necesitas decisiones rápidas e informadas sin montar un escándalo en la mesa.',
      },
    ],
  },
  emotionalBlock: {
    headline: 'Volver a disfrutar de comer fuera',
    quote: '"Por fin puedo salir a comer con mi familia sin el miedo constante a los alérgenos."',
    quoteAuthor: 'Usuario beta, Madrid',
    scenarios: [
      {
        scene: 'Mirar la carta',
        description:
          'Abres el menú y sabes qué está pasando en ese plato. No tienes que adivinar, comparar con recuerdos vagos ni renunciar a lo que te apetece.',
      },
      {
        scene: 'En grupo, sin fricción',
        description:
          'Eliges sin tener que explicar nada, justificar nada, ni sentirte diferente. La información está ahí; la decisión es tuya.',
      },
      {
        scene: 'El menú del día',
        description:
          'Ese momento en que te preguntan qué quieres y tienes diez segundos para decidir. Con nutriXplorer, ya lo sabes antes de llegar.',
      },
    ],
  },
  comparison: {
    headline: 'Lo habitual hoy frente a lo que propone nutriXplorer',
    cards: [
      {
        title: 'Apps de fitness',
        versus: 'MyFitnessPal, Cronometer...',
        description:
          'Fantásticas para alimentos envasados y cocina en casa. Pero cuando buscas un plato concreto de un restaurante español, el resultado es vacío, inexacto o de otro continente.',
        advantage: 'nutriXplorer se centra en restaurantes españoles reales.',
      },
      {
        title: 'Apps de restaurantes',
        versus: 'TheFork, Yelp, Google Maps...',
        description:
          'Te dicen dónde ir y cómo está la comida. No te dicen qué contiene nutricionalmente ni con qué nivel de fiabilidad.',
        advantage: 'nutriXplorer añade la capa nutricional que falta.',
      },
      {
        title: 'Adivinar',
        versus: '"Creo que serán unos 600 kcal..."',
        description:
          'La opción más usada. Rápida, gratuita, completamente poco fiable. Y encima genera culpa cuando el resultado no encaja con tus objetivos.',
        advantage: 'nutriXplorer te da un punto de referencia real.',
      },
    ],
  },
  productDemo: {
    eyebrow: 'Así se vería una consulta real',
    headline: 'Más producto real, menos promesa abstracta',
    subtitle:
      'La experiencia está pensada para el momento exacto de decidir: escribes, entiendes de dónde sale el dato y eliges con más contexto.',
  },
  searchSimulator: {
    eyebrow: 'Demo interactiva',
    headline: 'Lo entiendes en 10 segundos',
    subtitle:
      'Más que un número: una respuesta que te dice qué sabe, de dónde lo sabe y cuándo no debería presentarse como verificado.',
  },
  restaurants: {
    eyebrow: 'Dónde funciona',
    headline: 'Restaurantes de toda España',
    subtitle:
      'Desde cadenas con datos oficiales hasta el bar de tu barrio. nutriXplorer ajusta la confianza al dato disponible.',
    items: [
      { label: 'Cadenas nacionales', note: 'Dato oficial' },
      { label: 'Cocina tradicional', note: 'Estimación inteligente' },
      { label: 'Restaurantes locales', note: 'Inferido por similitud' },
    ],
  },
  audienceGrid: {
    eyebrow: 'Para quién empieza hoy',
    headline: 'Para quién empieza hoy',
  },
  siteHeader: {
    cta: 'Probar gratis',
    mobileCta: 'Probar',
  },
  waitlistCta: {
    headline: 'Descubre exactamente qué comes en tu restaurante favorito',
    subtitle:
      'nutriXplorer está en fase de desarrollo. Únete a la lista de espera y sé de los primeros en acceder cuando lancemos.',
    urgency: 'Plazas limitadas para el acceso anticipado',
    trustNote: 'Sin spam. Sin compromisos. Solo te avisamos cuando lancemos.',
  },
  footer: {
    tagline: 'Conoce lo que comes. Come fuera con tranquilidad.',
    links: {
      privacy: 'Política de privacidad',
      cookies: 'Política de cookies',
      legal: 'Aviso legal',
    },
    madeIn: 'Hecho en España',
    copyright: '© 2026 nutriXplorer. Todos los derechos reservados.',
  },
};

export type Dictionary = typeof es;
