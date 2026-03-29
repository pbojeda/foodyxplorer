import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { CookieSettingsLink } from '@/components/analytics/CookieSettingsLink';

export const metadata: Metadata = {
  title: 'Política de cookies | nutriXplorer',
  robots: { index: false },
};

export default function CookiesPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <article>
            <h1 className="mb-8 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Política de cookies
            </h1>
            <p className="mb-6 text-sm text-slate-500">
              Última actualización: marzo 2026
            </p>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Qué son las cookies
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Las cookies son pequeños archivos de texto que los sitios web almacenan en tu
                navegador o dispositivo. Permiten que el sitio recuerde información sobre tu visita
                para mejorar tu experiencia. Esta política describe qué cookies utilizamos en
                nutrixplorer.com y cómo puedes controlarlas.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Cookies que utilizamos
              </h2>
              <p className="mb-4 text-slate-600 leading-relaxed">
                A continuación detallamos las cookies y valores de almacenamiento local que
                utilizamos en este sitio:
              </p>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm text-slate-600">
                  <thead>
                    <tr className="border-b-2 border-slate-200 bg-slate-50">
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Nombre</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Tipo</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Finalidad</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">nx-cookie-consent</td>
                      <td className="px-4 py-3">Almacenamiento local</td>
                      <td className="px-4 py-3">
                        Almacena tu preferencia de consentimiento de cookies (técnica,
                        estrictamente necesaria).
                      </td>
                      <td className="px-4 py-3">365 días</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">nx-variant</td>
                      <td className="px-4 py-3">Cookie HTTP</td>
                      <td className="px-4 py-3">
                        Asigna y mantiene la variante de diseño A/B para que el sitio sea
                        consistente entre visitas (técnica, estrictamente necesaria).
                      </td>
                      <td className="px-4 py-3">7 días</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">_ga</td>
                      <td className="px-4 py-3">Cookie de analítica</td>
                      <td className="px-4 py-3">
                        Google Analytics 4. Distingue usuarios únicos mediante un identificador
                        anónimo. Solo se activa si aceptas las cookies analíticas.
                      </td>
                      <td className="px-4 py-3">2 años</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">_ga_*</td>
                      <td className="px-4 py-3">Cookie de analítica</td>
                      <td className="px-4 py-3">
                        Google Analytics 4. Mantiene el estado de la sesión de analítica. Solo se
                        activa si aceptas las cookies analíticas.
                      </td>
                      <td className="px-4 py-3">Sesión / 2 años</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Cookies de terceros
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Las cookies de analítica ({' '}
                <code className="rounded bg-slate-100 px-1 text-xs">_ga</code>,{' '}
                <code className="rounded bg-slate-100 px-1 text-xs">_ga_*</code>) son gestionadas
                por Google LLC bajo sus propias políticas de privacidad. Puedes consultar la
                política de privacidad de Google en{' '}
                <a
                  href="https://policies.google.com/privacy"
                  className="text-green-700 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  policies.google.com/privacy
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Cómo gestionar tus cookies
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                Puedes controlar y revocar tu consentimiento en cualquier momento:
              </p>
              <ul className="space-y-3 text-slate-600 list-disc pl-6">
                <li>
                  <strong>Panel de consentimiento:</strong> haz clic en el enlace {'"'}Gestionar
                  cookies{'"'} en la parte inferior de cualquier página para reabrir el banner de
                  consentimiento y modificar tus preferencias.
                </li>
                <li>
                  <strong>Configuración del navegador:</strong> puedes bloquear o eliminar cookies
                  desde la configuración de tu navegador. Ten en cuenta que deshabilitar cookies
                  técnicas puede afectar al funcionamiento del sitio.
                </li>
                <li>
                  <strong>Opt-out de Google Analytics:</strong> puedes instalar el complemento de
                  inhabilitación de Google Analytics en{' '}
                  <a
                    href="https://tools.google.com/dlpage/gaoptout"
                    className="text-green-700 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    tools.google.com/dlpage/gaoptout
                  </a>
                  .
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Más información
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Para cualquier consulta sobre el uso de cookies, puedes contactarnos en{' '}
                <a href="mailto:privacidad@nutrixplorer.com" className="text-green-700 underline">
                  privacidad@nutrixplorer.com
                </a>
                . Consulta también nuestra{' '}
                <Link href="/privacidad" className="text-green-700 underline">
                  Política de privacidad
                </Link>{' '}
                para más información sobre el tratamiento de tus datos personales.
              </p>
            </section>
          </article>
        </div>
      </main>
      <footer className="border-t border-slate-200 bg-slate-50 py-6 text-center">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
          ← Volver al inicio
        </Link>
        {' · '}
        <CookieSettingsLink
          label="Gestionar cookies"
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        />
      </footer>
    </>
  );
}
