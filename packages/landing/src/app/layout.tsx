import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://nutrixplorer.com'
  ),
  title: {
    default: 'nutriXplorer | Información nutricional de restaurantes en España',
    template: '%s | nutriXplorer',
  },
  description:
    'La forma más clara de entender qué estás comiendo en restaurantes de España: calorías, macros y nivel de confianza visible antes de decidir.',
  keywords: [
    'información nutricional restaurantes',
    'calorías restaurantes España',
    'macros restaurante',
    'alérgenos restaurante',
    'nutrición fuera de casa',
    'nutriXplorer',
  ],
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    url: '/',
    siteName: 'nutriXplorer',
    title: 'nutriXplorer | Conoce lo que comes',
    description:
      'Come fuera con tranquilidad. Calorías, macros y nivel de confianza de restaurantes españoles.',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'nutriXplorer — Información nutricional de restaurantes',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'nutriXplorer | Conoce lo que comes',
    description:
      'Come fuera con tranquilidad. Calorías, macros y nivel de confianza de restaurantes españoles.',
    images: ['/og-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="bg-ivory text-slate-700 antialiased scroll-smooth">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
