'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { AlertTriangle, BadgeCheck, Clock3, Search, ShieldCheck } from 'lucide-react';

const TIMELINE = [
  {
    title: 'Usuario',
    value: 'Pulpo a feira · Madrid',
    helper: 'Búsqueda natural, sin formatear nada',
  },
  {
    title: 'Motor',
    value: 'Buscando fuentes oficiales y platos comparables',
    helper: 'Dato oficial > ingredientes > similitud',
  },
  {
    title: 'Respuesta',
    value: '482 kcal · Confianza MEDIA',
    helper: 'Estimación inteligente por ingredientes',
  },
];

/**
 * ProductDemo — shows a real query flow timeline + app mockup.
 * "Más producto real, menos promesa abstracta"
 */
export function ProductDemo() {
  return (
    <div className="card-surface relative overflow-hidden p-4 sm:p-6">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(45,90,39,0.14),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(255,140,66,0.16),transparent_28%)]" />
      <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-mist px-3 py-1 text-sm font-medium text-botanical">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            Así se vería una consulta real
          </div>
          <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Más producto real, menos promesa abstracta
          </h3>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 sm:text-base">
            La experiencia está pensada para el momento exacto de decidir: escribes, entiendes de
            dónde sale el dato y eliges con más contexto.
          </p>
          <div className="mt-5 space-y-3">
            {TIMELINE.map((item, index) => (
              <div
                key={item.title}
                className="rounded-[24px] border border-white/80 bg-white/85 p-4 shadow-soft"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Paso {index + 1} · {item.title}
                </div>
                <div className="mt-2 font-semibold text-slate-900">{item.value}</div>
                <div className="mt-1 text-sm text-slate-600">{item.helper}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[420px]">
          {/* Food photo for context */}
          <div className="mb-4 overflow-hidden rounded-2xl">
            <Image
              src="/images/demo-pulpo-feira.png"
              alt="Pulpo a feira en restaurante gallego — plato de referencia en la demo"
              width={420}
              height={180}
              className="w-full object-cover"
              sizes="420px"
            />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5 }}
            className="overflow-hidden rounded-[34px] border border-slate-200 bg-slate-950 p-3 shadow-lift"
          >
            <div className="rounded-[28px] bg-white p-4">
              <div className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <Search className="h-4 w-4" aria-hidden="true" />
                Pulpo a feira
              </div>
              <div className="mt-4 rounded-[24px] bg-slate-950 p-4 text-white">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">Resultado</div>
                    <div className="mt-2 text-xl font-semibold">482 kcal</div>
                    <div className="mt-1 text-sm text-white/65">
                      31 g proteína · 18 g hidratos · 21 g grasa
                    </div>
                  </div>
                  <div className="rounded-2xl bg-green-500/15 px-3 py-2 text-sm font-semibold text-green-200">
                    L2
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/45">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Ruta de confianza
                    </div>
                    <div className="mt-2 text-sm text-white/80">
                      Estimación inteligente por ingredientes y ración estándar.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/45">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Alérgenos
                    </div>
                    <div className="mt-2 flex items-start gap-2 text-sm text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      Sin dato oficial, no verificado.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
