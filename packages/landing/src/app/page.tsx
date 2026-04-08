import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { WaitlistSuccessBanner } from '@/components/features/WaitlistSuccessBanner';
import { HeroSection } from '@/components/sections/HeroSection';
import { ProductDemo } from '@/components/ProductDemo';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { EmotionalBlock } from '@/components/sections/EmotionalBlock';
import { TrustEngineSection } from '@/components/sections/TrustEngineSection';
import { ForWhoSection } from '@/components/sections/ForWhoSection';
import { ComparisonSection } from '@/components/sections/ComparisonSection';
import { RestaurantsSection } from '@/components/sections/RestaurantsSection';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { FAQSection } from '@/components/sections/FAQSection';
import { Footer } from '@/components/sections/Footer';
import { CookieBanner } from '@/components/analytics/CookieBanner';
import { ScrollTracker } from '@/components/analytics/ScrollTracker';
import { SectionObserver } from '@/components/analytics/SectionObserver';
import { resolveVariant, VARIANT_COOKIE_NAME } from '@/lib/ab-testing';
import { generateWebSiteSchema, generateSoftwareApplicationSchema, generateFAQPageSchema } from '@/lib/seo';
import { getDictionary } from '@/lib/i18n';
import { VisualDivider } from '@/components/VisualDivider';
import type { Variant, Palette } from '@/types';
import type { Dictionary } from '@/lib/i18n';

function safeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

interface LandingPageProps {
  searchParams: Promise<{ variant?: string; palette?: string }>;
}

// ---------------------------------------------------------------------------
// Variant A layout — "Improved Baseline"
// ---------------------------------------------------------------------------
function VariantALayout({ dict, variant, hablarBaseUrl }: { dict: Dictionary; variant: Variant; hablarBaseUrl: string | null }) {
  return (
    <main>
      <SectionObserver sectionId="hero" variant={variant}>
        <HeroSection variant={variant} dict={dict.hero} variantsCopy={dict.variants} hablarUrl={hablarBaseUrl ?? undefined} />
      </SectionObserver>

      <SectionObserver sectionId="product-demo" variant={variant}>
        <section
          id="demo"
          aria-label={dict.productDemo.headline}
          data-section="product-demo"
          className="bg-paper py-12 lg:py-16"
        >
          <div className="section-shell">
            <ProductDemo />
          </div>
        </section>
      </SectionObserver>

      <SectionObserver sectionId="how-it-works" variant={variant}>
        <HowItWorksSection dict={dict.howItWorks} variant={variant} />
      </SectionObserver>

      <SectionObserver sectionId="emotional" variant={variant}>
        <EmotionalBlock dict={dict.emotionalBlock} />
      </SectionObserver>

      {/* Visual breathing room between EmotionalBlock and TrustEngine */}
      <VisualDivider />

      <SectionObserver sectionId="trust-engine" variant={variant}>
        <TrustEngineSection dict={dict.trustEngine} />
      </SectionObserver>

      <SectionObserver sectionId="for-who" variant={variant}>
        <ForWhoSection dict={dict.forWho} />
      </SectionObserver>

      <SectionObserver sectionId="comparison" variant={variant}>
        <ComparisonSection dict={dict.comparison} />
      </SectionObserver>

      <SectionObserver sectionId="restaurants" variant={variant}>
        <RestaurantsSection dict={dict.restaurants} />
      </SectionObserver>

      {dict.faq.items.length > 0 && (
        <SectionObserver sectionId="faq" variant={variant}>
          <FAQSection dict={dict.faq} />
        </SectionObserver>
      )}

      <SectionObserver sectionId="waitlist-cta" variant={variant}>
        <WaitlistCTASection dict={dict.waitlistCta} variant={variant} hablarUrl={hablarBaseUrl ?? undefined} />
      </SectionObserver>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant C layout — "Pain-First"
// Order: Hero (dark, no form) → EmotionalBlock → ProductDemo → HowItWorks → TrustEngine → Comparison → WaitlistCTA
// ---------------------------------------------------------------------------
function VariantCLayout({ dict, variant, hablarBaseUrl }: { dict: Dictionary; variant: Variant; hablarBaseUrl: string | null }) {
  return (
    <main>
      <SectionObserver sectionId="hero" variant={variant}>
        <HeroSection variant={variant} dict={dict.hero} variantsCopy={dict.variants} />
      </SectionObserver>

      <SectionObserver sectionId="emotional" variant={variant}>
        <EmotionalBlock dict={dict.emotionalBlock} />
      </SectionObserver>

      <SectionObserver sectionId="product-demo" variant={variant}>
        <section
          id="demo"
          aria-label={dict.productDemo.headline}
          data-section="product-demo"
          className="bg-paper py-12 lg:py-16"
        >
          <div className="section-shell">
            <ProductDemo />
          </div>
        </section>
      </SectionObserver>

      <SectionObserver sectionId="how-it-works" variant={variant}>
        <HowItWorksSection dict={dict.howItWorks} variant={variant} />
      </SectionObserver>

      <SectionObserver sectionId="trust-engine" variant={variant}>
        <TrustEngineSection dict={dict.trustEngine} />
      </SectionObserver>

      <SectionObserver sectionId="comparison" variant={variant}>
        <ComparisonSection dict={dict.comparison} />
      </SectionObserver>

      {dict.faq.items.length > 0 && (
        <SectionObserver sectionId="faq" variant={variant}>
          <FAQSection dict={dict.faq} />
        </SectionObserver>
      )}

      <SectionObserver sectionId="waitlist-cta" variant={variant}>
        <WaitlistCTASection dict={dict.waitlistCta} variant={variant} hablarUrl={hablarBaseUrl ?? undefined} />
      </SectionObserver>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant F layout — "Single-Audience" (allergens focus)
// Order: Hero (allergen image, email-only form) → TrustEngine → ProductDemo → HowItWorks → EmotionalBlock → WaitlistCTA
// ---------------------------------------------------------------------------
function VariantFLayout({ dict, variant, hablarBaseUrl }: { dict: Dictionary; variant: Variant; hablarBaseUrl: string | null }) {
  return (
    <main>
      <SectionObserver sectionId="hero" variant={variant}>
        <HeroSection variant={variant} dict={dict.hero} variantsCopy={dict.variants} />
      </SectionObserver>

      <SectionObserver sectionId="trust-engine" variant={variant}>
        <TrustEngineSection dict={dict.trustEngine} />
      </SectionObserver>

      <SectionObserver sectionId="product-demo" variant={variant}>
        <section
          id="demo"
          aria-label={dict.productDemo.headline}
          data-section="product-demo"
          className="bg-paper py-12 lg:py-16"
        >
          <div className="section-shell">
            <ProductDemo />
          </div>
        </section>
      </SectionObserver>

      <SectionObserver sectionId="how-it-works" variant={variant}>
        <HowItWorksSection dict={dict.howItWorks} variant={variant} />
      </SectionObserver>

      <SectionObserver sectionId="emotional" variant={variant}>
        <EmotionalBlock dict={dict.emotionalBlock} />
      </SectionObserver>

      {dict.faq.items.length > 0 && (
        <SectionObserver sectionId="faq" variant={variant}>
          <FAQSection dict={dict.faq} />
        </SectionObserver>
      )}

      <SectionObserver sectionId="waitlist-cta" variant={variant}>
        <WaitlistCTASection dict={dict.waitlistCta} variant={variant} hablarUrl={hablarBaseUrl ?? undefined} />
      </SectionObserver>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant router
// ---------------------------------------------------------------------------
function getVariantLayout(variant: Variant, dict: Dictionary, hablarBaseUrl: string | null): React.JSX.Element {
  switch (variant) {
    case 'c':
      return <VariantCLayout dict={dict} variant={variant} hablarBaseUrl={hablarBaseUrl} />;
    case 'f':
      return <VariantFLayout dict={dict} variant={variant} hablarBaseUrl={hablarBaseUrl} />;
    default:
      return <VariantALayout dict={dict} variant={variant} hablarBaseUrl={hablarBaseUrl} />;
  }
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const { variant: variantParam, palette: paletteParam } = await searchParams;

  // Resolve A/B variant: URL param > cookie > default 'a'
  const cookieStore = await cookies();
  const cookieVariant = cookieStore.get(VARIANT_COOKIE_NAME)?.value;
  const variant = resolveVariant(variantParam, cookieVariant);
  const palette: Palette = paletteParam === 'med' ? 'med' : 'botanical';

  // Resolve hablar base URL — strips trailing slashes; null when unset
  const rawWebUrl = process.env['NEXT_PUBLIC_WEB_URL'] ?? '';
  const hablarBaseUrl: string | null = rawWebUrl
    ? rawWebUrl.replace(/\/+$/, '') + '/hablar'
    : null;

  const dict = getDictionary('es');

  const websiteSchema = generateWebSiteSchema();
  const softwareSchema = generateSoftwareApplicationSchema();
  const faqSchema =
    dict.faq.items.length > 0 ? generateFAQPageSchema(dict.faq.items) : null;

  return (
    <>
      {/* Palette — sets data-palette on <html> before paint to avoid flash */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.dataset.palette="${palette}"`,
        }}
      />

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(softwareSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema) }}
        />
      )}

      {/* Sticky site header */}
      <SiteHeader hablarBaseUrl={hablarBaseUrl} variant={variant} />

      {/* No-JS waitlist success banner — useSearchParams requires Suspense to preserve SSG */}
      <Suspense fallback={null}>
        <WaitlistSuccessBanner />
      </Suspense>

      {/* Variant-specific layout */}
      {getVariantLayout(variant, dict, hablarBaseUrl)}

      {/* Footer is outside <main> — it's a landmark element */}
      <SectionObserver sectionId="footer" variant={variant}>
        <Footer dict={dict.footer} variant={variant} />
      </SectionObserver>

      {/* ScrollTracker fires scroll_depth analytics events */}
      <ScrollTracker variant={variant} />

      {/* CookieBanner needs the resolved variant to write A/B cookie after consent */}
      <CookieBanner variant={variant} />
    </>
  );
}
