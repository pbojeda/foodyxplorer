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
}

const heroAnimation = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const staggerContainer = {
  visible: {
    transition: { staggerChildren: 0.15 },
  },
};

export function HeroSection({ variant, dict }: HeroSectionProps) {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const utmParams = getUtmParams();
    trackEvent({ event: 'landing_view', variant, lang: 'es', ...utmParams });
    trackEvent({ event: 'variant_assigned', variant, lang: 'es', ...utmParams });
  }, [variant]);

  const isVariantA = variant === 'a';
  const headline = isVariantA ? dict.headlineA : dict.headlineB;
  const subtitle = isVariantA ? dict.subtitleA : dict.subtitleB;
  const heroImage = isVariantA
    ? '/images/hero-telegram-restaurant.png'
    : '/images/hero-burger-holographic.png';
  const heroImageAlt =
    'Mockup de nutriXplorer mostrando información nutricional de un plato en un restaurante';

  // Disable animations when user prefers reduced motion
  const animProps = prefersReducedMotion
    ? {}
    : { variants: heroAnimation, initial: 'hidden', animate: 'visible' };

  const containerAnimProps = prefersReducedMotion
    ? {}
    : { variants: staggerContainer, initial: 'hidden', animate: 'visible' };

  return (
    <section
      aria-label="Inicio"
      className="relative bg-ivory overflow-hidden pt-16 pb-24 lg:pt-32 lg:pb-32"
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
        {isVariantA ? (
          /* Variant A: 55/45 asymmetric split */
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
                {dict.eyebrow}
              </motion.p>
              <motion.h1
                className="text-4xl md:text-7xl font-extrabold tracking-tighter leading-tight text-slate-900 mb-6"
                {...animProps}
              >
                {headline}
              </motion.h1>
              <motion.p
                className="text-lg md:text-xl leading-relaxed text-slate-600 mb-8 max-w-2xl"
                {...animProps}
              >
                {subtitle}
              </motion.p>
              <motion.div {...animProps} className="mb-6">
                <WaitlistForm source="hero" variant={variant} />
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
                  src={heroImage}
                  alt={heroImageAlt}
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
        ) : (
          /* Variant B: single centered column */
          <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
            <motion.p
              className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4"
              {...animProps}
            >
              {dict.eyebrow}
            </motion.p>
            <motion.h1
              className="text-[40px] md:text-[72px] font-extrabold leading-tight text-slate-900 mb-6"
              {...animProps}
            >
              {headline}
            </motion.h1>
            <motion.p
              className="text-lg md:text-xl leading-relaxed text-slate-600 mb-8"
              {...animProps}
            >
              {subtitle}
            </motion.p>
            <motion.div {...animProps} className="w-full max-w-md mb-6">
              <WaitlistForm source="hero" variant={variant} />
            </motion.div>
            {/* Trust pills */}
            <motion.div {...animProps} className="flex flex-wrap gap-2 justify-center mb-12">
              {dict.trustPills.map((pill) => (
                <Badge key={pill} variant="high">
                  {pill}
                </Badge>
              ))}
            </motion.div>
            <div className="relative w-full">
              <Image
                src={heroImage}
                alt={heroImageAlt}
                width={800}
                height={600}
                priority
                className="rounded-3xl object-cover w-full animate-float"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
              <FloatingBadge label="Sin Gluten — Verificado" variant="high" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
