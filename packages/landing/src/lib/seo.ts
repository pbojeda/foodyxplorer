const SITE_URL =
  process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://nutrixplorer.com';

export function generateWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'nutriXplorer',
    url: SITE_URL,
    description:
      'Información nutricional de restaurantes en España: calorías, macros y nivel de confianza visible.',
  };
}

export function generateFAQPageSchema(
  items: ReadonlyArray<{ question: string; answer: string }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function generateSoftwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'nutriXplorer',
    url: SITE_URL,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web, Telegram',
    description:
      'Plataforma de información nutricional para restaurantes en España con motor de estimación de 3 niveles y trazabilidad del dato.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    inLanguage: 'es',
    countryOfOrigin: 'ES',
  };
}
