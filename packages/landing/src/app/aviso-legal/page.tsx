import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { CookieSettingsLink } from '@/components/analytics/CookieSettingsLink';

export const metadata: Metadata = {
  title: 'Aviso legal | nutriXplorer',
  robots: { index: false },
};

export default function AvisoLegalPage() {
  return (
    <>
      <SiteHeader hablarBaseUrl={null} variant="a" />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <article>
            <h1 className="mb-8 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Aviso legal
            </h1>
            <p className="mb-6 text-sm text-slate-500">
              En cumplimiento con el deber de información establecido en el artículo 10 de la Ley
              34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y del Comercio
              Electrónico (LSSI-CE).
            </p>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Titular del sitio web
              </h2>
              <ul className="space-y-1 text-slate-600 list-none">
                <li><strong>Nombre / Razón social:</strong> Pablo Eduardo Ojeda Vasco</li>
                <li><strong>NIF/CIF:</strong> 12387725V</li>
                <li><strong>Domicilio:</strong> Calle Luis Morote 41, Playa de Melenara, Las Palmas, 35214</li>
                <li>
                  <strong>Correo electrónico:</strong>{' '}
                  <a href="mailto:hola@nutrixplorer.com" className="text-green-700 underline">
                    hola@nutrixplorer.com
                  </a>
                </li>
                <li>
                  <strong>Sitio web:</strong>{' '}
                  <a
                    href="https://nutrixplorer.com"
                    className="text-green-700 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    nutrixplorer.com
                  </a>
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Actividad
              </h2>
              <p className="text-slate-600 leading-relaxed">
                nutriXplorer es una plataforma de información nutricional para restaurantes en
                España. Ofrece datos sobre calorías, macronutrientes y alérgenos de platos de
                restaurante, con indicación del nivel de confianza de cada dato (verificado,
                estimado o inferido).
              </p>
              <p className="mt-3 text-slate-600 leading-relaxed">
                El servicio se encuentra actualmente en fase de desarrollo. El acceso anticipado se
                gestiona mediante lista de espera.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Propiedad intelectual e industrial
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Todos los contenidos del sitio web nutrixplorer.com (textos, imágenes, diseños,
                código fuente, logotipos y demás elementos) son titularidad del responsable del
                sitio o de sus licenciantes y están protegidos por la normativa española e
                internacional sobre propiedad intelectual e industrial.
              </p>
              <p className="mt-3 text-slate-600 leading-relaxed">
                Queda prohibida su reproducción, distribución, comunicación pública o transformación
                sin autorización expresa del titular, salvo que la ley lo permita expresamente.
              </p>
              <p className="mt-3 text-slate-600 leading-relaxed">
                El código fuente de nutriXplorer se publica como proyecto open source bajo la
                licencia MIT. Consulta el repositorio en GitHub para más detalles.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Exclusión de garantías y responsabilidad
              </h2>
              <p className="text-slate-600 leading-relaxed">
                La información nutricional publicada en nutriXplorer se proporciona con fines
                informativos y orientativos. No constituye consejo médico ni dietético. Los datos
                son estimaciones basadas en recetas estándar y fuentes públicas; pueden variar según
                el restaurante, la preparación concreta y los ingredientes utilizados.
              </p>
              <p className="mt-3 text-slate-600 leading-relaxed">
                El titular no garantiza la exactitud, completitud o actualidad de la información y
                no se responsabiliza de los daños derivados de decisiones tomadas en base a los
                datos publicados.
              </p>
              <p className="mt-3 text-slate-600 leading-relaxed">
                En particular, las personas con alergias alimentarias graves deben siempre confirmar
                directamente con el establecimiento la presencia de alérgenos antes de consumir
                cualquier alimento.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Ley aplicable y jurisdicción
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Las presentes condiciones legales se rigen por la legislación española. Para la
                resolución de cualquier controversia derivada del uso de este sitio web, las partes
                se someten, con renuncia expresa a cualquier otro fuero, a los Juzgados y Tribunales
                competentes según la normativa vigente.
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
