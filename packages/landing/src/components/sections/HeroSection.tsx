'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { WaitlistForm } from '@/components/features/WaitlistForm';
import { FloatingBadge } from '@/components/features/FloatingBadge';
import { Badge } from '@/components/ui/Badge';
import { trackEvent, getUtmParams } from '@/lib/analytics';
import type { Variant } from '@/types';
import type { Dictionary } from '@/lib/i18n';

interface HeroSectionProps {
  variant: Variant;
  dict: Dictionary['hero'];
  variantsCopy?: Dictionary['variants'];
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.15 },
  },
};

export function HeroSection({ variant, dict, variantsCopy }: HeroSectionProps) {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const utmParams = getUtmParams();
    trackEvent({ event: 'landing_view', variant, lang: 'es', ...utmParams });
    trackEvent({ event: 'variant_assigned', variant, lang: 'es', ...utmParams });
  }, [variant]);

  // Disable animations when user prefers reduced motion
  const animProps = prefersReducedMotion
    ? {}
    : { variants: fadeUp, initial: 'hidden', animate: 'visible' };

  const containerAnimProps = prefersReducedMotion
    ? {}
    : { variants: stagger, initial: 'hidden', animate: 'visible' };

  if (variant === 'c') {
    const copy = variantsCopy?.c.hero;
    return <HeroVariantC dict={dict} copy={copy} animProps={animProps} />;
  }

  if (variant === 'f') {
    const copy = variantsCopy?.f.hero;
    return <HeroVariantF dict={dict} variant={variant} copy={copy} animProps={animProps} containerAnimProps={containerAnimProps} />;
  }

  // Default: Variant A — "Improved Baseline" with new hero image
  const copy = variantsCopy?.a.hero;
  return <HeroVariantA dict={dict} variant={variant} copy={copy} animProps={animProps} containerAnimProps={containerAnimProps} />;
}

// ---------------------------------------------------------------------------
// Variant A: Improved baseline — 55/45 asymmetric split, real food photo
// ---------------------------------------------------------------------------
type VariantACopy = {
  eyebrow: string;
  headline: string;
  subtitle: string;
  supporting?: string;
};

interface VariantAProps {
  dict: Dictionary['hero'];
  variant: Variant;
  copy: VariantACopy | undefined;
  animProps: object;
  containerAnimProps: object;
}

function HeroVariantA({ dict, variant, copy, animProps, containerAnimProps }: VariantAProps) {
  return (
    <section
      aria-label="Inicio"
      className="relative bg-ivory overflow-hidden py-16 lg:py-24"
    >
      {/* Radial gradient background overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, rgba(45,90,39,0.06) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-container mx-auto px-6">
        {/* 55/45 asymmetric split */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-12 lg:gap-16">
          {/* Left column — text + form */}
          <motion.div
            className="flex flex-col flex-1 lg:max-w-[55%]"
            {...containerAnimProps}
          >
            <motion.p
              className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4"
              {...animProps}
            >
              {copy?.eyebrow ?? dict.eyebrow}
            </motion.p>
            <motion.h1
              className="text-4xl md:text-7xl font-extrabold tracking-tighter leading-tight text-slate-900 mb-6"
              {...animProps}
            >
              {copy?.headline ?? dict.headlineA}
            </motion.h1>
            <motion.p
              className="text-lg md:text-xl leading-relaxed text-slate-600 mb-8 max-w-2xl"
              {...animProps}
            >
              {copy?.subtitle ?? dict.subtitleA}
            </motion.p>
            <motion.div {...animProps} className="mb-6">
              {/* Email-only form in hero */}
              <WaitlistForm source="hero" variant={variant} showPhone={false} />
            </motion.div>
            {/* Trust pills */}
            <motion.div
              {...animProps}
              className="flex flex-wrap gap-2"
            >
              {dict.trustPills.map((pill) => (
                <Badge key={pill} variant="high">
                  {pill}
                </Badge>
              ))}
            </motion.div>
          </motion.div>

          {/* Right column — image */}
          <div className="relative flex-1 lg:max-w-[45%]">
            <div className="relative">
              <Image
                src="/images/hero-telegram-lentejas.png"
                alt="Consulta nutricional en Telegram: lentejas con chorizo, 650 kcal, nivel de confianza ALTO"
                width={800}
                height={600}
                priority
                className="rounded-3xl object-cover w-full animate-float"
                sizes="(max-width: 768px) 100vw, 45vw"
              />
              <FloatingBadge label="Sin Gluten — Verificado" variant="high" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant C: Pain-First — dark hero, no form, scroll CTA
// ---------------------------------------------------------------------------
type VariantCCopy = {
  eyebrow: string;
  headline: string;
  subtitle: string;
  scrollCta: string;
};

interface VariantCProps {
  dict: Dictionary['hero'];
  copy: VariantCCopy | undefined;
  animProps: object;
}

function HeroVariantC({ dict, copy, animProps }: VariantCProps) {
  return (
    <section
      aria-label="Inicio"
      className="relative overflow-hidden py-16 lg:py-24"
      style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 60%, #0F172A 100%)',
      }}
    >
      {/* Subtle dark overlay gradient */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(45,90,39,0.08) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-container mx-auto px-6">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
          <motion.p
            className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4"
            {...animProps}
          >
            {copy?.eyebrow ?? dict.eyebrow}
          </motion.p>
          <motion.h1
            className="text-4xl md:text-7xl font-extrabold tracking-tighter leading-tight text-white mb-6"
            {...animProps}
          >
            {copy?.headline ?? dict.headlineA}
          </motion.h1>
          <motion.p
            className="text-lg md:text-xl leading-relaxed text-slate-300 mb-10 max-w-2xl"
            {...animProps}
          >
            {copy?.subtitle ?? dict.subtitleA}
          </motion.p>
          {/* Scroll CTA — no form */}
          <a
            href="#como-funciona"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur hover:bg-white/20 transition-colors"
          >
            {copy?.scrollCta ?? 'Ver cómo lo solucionamos'}
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant F: Single-Audience (allergies/celiacs focus)
// ---------------------------------------------------------------------------
type VariantFCopy = {
  eyebrow: string;
  headline: string;
  subtitle: string;
};

interface VariantFProps {
  dict: Dictionary['hero'];
  variant: Variant;
  copy: VariantFCopy | undefined;
  animProps: object;
  containerAnimProps: object;
}

function HeroVariantF({ dict, variant, copy, animProps, containerAnimProps }: VariantFProps) {
  return (
    <section
      aria-label="Inicio"
      className="relative bg-ivory overflow-hidden py-16 lg:py-24"
    >
      {/* Radial gradient background overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, rgba(45,90,39,0.06) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-container mx-auto px-6">
        {/* 55/45 asymmetric split — allergen focus */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-12 lg:gap-16">
          {/* Left column — text + form */}
          <motion.div
            className="flex flex-col flex-1 lg:max-w-[55%]"
            {...containerAnimProps}
          >
            <motion.p
              className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4"
              {...animProps}
            >
              {copy?.eyebrow ?? dict.eyebrow}
            </motion.p>
            <motion.h1
              className="text-4xl md:text-7xl font-extrabold tracking-tighter leading-tight text-slate-900 mb-6"
              {...animProps}
            >
              {copy?.headline ?? dict.headlineA}
            </motion.h1>
            <motion.p
              className="text-lg md:text-xl leading-relaxed text-slate-600 mb-8 max-w-2xl"
              {...animProps}
            >
              {copy?.subtitle ?? dict.subtitleA}
            </motion.p>
            <motion.div {...animProps} className="mb-6">
              <WaitlistForm source="hero" variant={variant} showPhone={false} />
            </motion.div>
            {/* Trust pills */}
            <motion.div {...animProps} className="flex flex-wrap gap-2">
              {dict.trustPills.map((pill) => (
                <Badge key={pill} variant="high">
                  {pill}
                </Badge>
              ))}
            </motion.div>
          </motion.div>

          {/* Right column — allergen family image */}
          <div className="relative flex-1 lg:max-w-[45%]">
            <div className="relative">
              <Image
                src="/images/trust-allergen-family.png"
                alt="Familia disfrutando de una comida segura gracias a alérgenos verificados"
                width={800}
                height={600}
                priority
                className="rounded-3xl object-cover w-full animate-float"
                sizes="(max-width: 768px) 100vw, 45vw"
              />
              <FloatingBadge label="Alérgenos Verificados" variant="high" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
