import { MetadataRoute } from 'next';

// Update when landing page content changes
const LAST_CONTENT_UPDATE = '2026-03-30';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://nutrixplorer.com';

  return [
    {
      url: baseUrl,
      lastModified: new Date(LAST_CONTENT_UPDATE),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
