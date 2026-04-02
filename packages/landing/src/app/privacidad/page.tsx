import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { CookieSettingsLink } from '@/components/analytics/CookieSettingsLink';

export const metadata: Metadata = {
  title: 'Política de privacidad | nutriXplorer',
  robots: { index: false },
};

export default function PrivacidadPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <article>
            <h1 className="mb-8 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Política de privacidad
            </h1>
            <p className="mb-6 text-sm text-slate-500">
              Última actualización: marzo 2026
            </p>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Responsable del tratamiento
              </h2>
              <p className="text-slate-600 leading-relaxed">
                En cumplimiento del Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018
                (LOPD-GDD), te informamos de que el responsable del tratamiento de tus datos
                personales es:
              </p>
              <ul className="mt-3 space-y-1 text-slate-600 list-none">
                <li><strong>Nombre / Razón social:</strong> Pablo Eduardo Ojeda Vasco</li>
                <li><strong>NIF/CIF:</strong> 12387725V</li>
                <li><strong>Dirección:</strong> Calle Luis Morote 41, Playa de Melenara, Las Palmas, 35214</li>
                <li>
                  <strong>Correo electrónico:</strong>{' '}
                  <a href="mailto:privacidad@nutrixplorer.com" className="text-green-700 underline">
                    privacidad@nutrixplorer.com
                  </a>
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Finalidad del tratamiento
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Tratamos tus datos con las siguientes finalidades:
              </p>
              <ul className="mt-3 space-y-2 text-slate-600 list-disc pl-6">
                <li>
                  <strong>Lista de espera:</strong> gestionar tu registro en la lista de espera de
                  nutriXplorer y comunicarte el lanzamiento del servicio.
                </li>
                <li>
                  <strong>Comunicaciones de lanzamiento:</strong> enviarte avisos sobre la
                  disponibilidad del servicio y acceso anticipado.
                </li>
                <li>
                  <strong>Analítica web:</strong> mejorar la experiencia de usuario mediante el
                  análisis del comportamiento en el sitio (solo si aceptas cookies analíticas).
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Base jurídica
              </h2>
              <p className="text-slate-600 leading-relaxed">
                La base jurídica del tratamiento es el consentimiento del interesado (art. 6.1.a
                RGPD), que otorgas al cumplimentar el formulario de lista de espera. Puedes revocar
                tu consentimiento en cualquier momento sin que ello afecte a la licitud del
                tratamiento previo a la revocación.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Plazos de conservación
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Conservaremos tus datos mientras exista el servicio de lista de espera y no
                solicites su supresión. Una vez lanzado el servicio, tus datos se conservarán
                durante el tiempo necesario para el mantenimiento de la relación contractual y,
                posteriormente, durante los plazos legalmente establecidos.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Destinatarios
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Tus datos no se cederán a terceros salvo obligación legal. Utilizamos los siguientes
                encargados del tratamiento:
              </p>
              <ul className="mt-3 space-y-1 text-slate-600 list-disc pl-6">
                <li>
                  <strong>Supabase</strong> (base de datos y autenticación) — datos almacenados en la
                  UE.
                </li>
                <li>
                  <strong>Google Analytics 4</strong> (analítica, solo si aceptas cookies) — sujeto a
                  las Cláusulas Contractuales Tipo aprobadas por la Comisión Europea.
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Derechos del interesado
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Tienes derecho a ejercer los siguientes derechos respecto a tus datos personales:
              </p>
              <ul className="mt-3 space-y-1 text-slate-600 list-disc pl-6">
                <li><strong>Acceso:</strong> conocer qué datos tratamos sobre ti.</li>
                <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos.</li>
                <li><strong>Supresión:</strong> solicitar la eliminación de tus datos.</li>
                <li>
                  <strong>Portabilidad:</strong> recibir tus datos en formato estructurado y de uso
                  común.
                </li>
                <li>
                  <strong>Oposición:</strong> oponerte al tratamiento en los supuestos legalmente
                  previstos.
                </li>
                <li>
                  <strong>Limitación:</strong> solicitar la restricción del tratamiento en
                  determinadas circunstancias.
                </li>
              </ul>
              <p className="mt-3 text-slate-600 leading-relaxed">
                También tienes derecho a presentar una reclamación ante la Agencia Española de
                Protección de Datos (
                <a href="https://www.aepd.es" className="text-green-700 underline" target="_blank" rel="noopener noreferrer">
                  www.aepd.es
                </a>
                ).
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Cómo ejercer tus derechos
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Para ejercer cualquiera de los derechos descritos, envía un correo a{' '}
                <a href="mailto:privacidad@nutrixplorer.com" className="text-green-700 underline">
                  privacidad@nutrixplorer.com
                </a>{' '}
                indicando el derecho que deseas ejercer y adjuntando una copia de tu documento de
                identidad. Responderemos en el plazo máximo de un mes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-slate-800">
                Modificaciones de la política
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Nos reservamos el derecho a modificar esta política de privacidad para adaptarla a
                cambios legislativos o de nuestro servicio. Te informaremos de cambios sustanciales
                por correo electrónico si tienes una cuenta activa.
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
