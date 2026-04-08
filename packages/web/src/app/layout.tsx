import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import '../styles/globals.css';

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
    default: 'nutriXplorer | Asistente nutricional',
    template: '%s | nutriXplorer',
  },
  description:
    'Consulta calorías y macros de platos de restaurantes en España. Escribe un plato y obtén información nutricional al instante.',
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#2d5a27',
  width: 'device-width',
  initialScale: 1,
};

const GA_ID = process.env['NEXT_PUBLIC_GA_MEASUREMENT_ID'];
const isValidGAId = GA_ID && /^G-[A-Z0-9]+$/.test(GA_ID);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans">
        {children}
        {/* GA4 — conditional: only injected when NEXT_PUBLIC_GA_MEASUREMENT_ID is set.
            strategy="afterInteractive" avoids hydration warnings from raw script tags.
            send_page_view: false — page views are fired manually per route (HablarAnalytics)
            to include UTM params captured from the URL. */}
        {isValidGAId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false});`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
