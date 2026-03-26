import { cookies } from 'next/headers';
import { HeroSection } from '@/components/sections/HeroSection';
import { ProblemSection } from '@/components/sections/ProblemSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { TrustEngineSection } from '@/components/sections/TrustEngineSection';
import { ForWhoSection } from '@/components/sections/ForWhoSection';
import { EmotionalBlock } from '@/components/sections/EmotionalBlock';
import { ComparisonSection } from '@/components/sections/ComparisonSection';
import { WaitlistCTASection } from '@/components/sections/WaitlistCTASection';
import { Footer } from '@/components/sections/Footer';
import { CookieBanner } from '@/components/analytics/CookieBanner';
import { ScrollTracker } from '@/components/analytics/ScrollTracker';
import { SectionObserver } from '@/components/analytics/SectionObserver';
import { resolveVariant, VARIANT_COOKIE_NAME } from '@/lib/ab-testing';
import { generateWebSiteSchema, generateSoftwareApplicationSchema } from '@/lib/seo';
import { getDictionary } from '@/lib/i18n';

interface LandingPageProps {
  searchParams: { variant?: string };
}

export default function LandingPage({ searchParams }: LandingPageProps) {
  // Resolve A/B variant: URL param > cookie > random
  // Server Components can read cookies but NOT write them (no cookies().set())
  const cookieVariant = cookies().get(VARIANT_COOKIE_NAME)?.value;
  const variant = resolveVariant(searchParams.variant, cookieVariant);

  const dict = getDictionary('es');

  const websiteSchema = generateWebSiteSchema();
  const softwareSchema = generateSoftwareApplicationSchema();

  return (
    <>
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />

      <main>
        <SectionObserver sectionId="hero" variant={variant}>
          <HeroSection variant={variant} dict={dict.hero} />
        </SectionObserver>

        <SectionObserver sectionId="problem" variant={variant}>
          <ProblemSection dict={dict.problem} />
        </SectionObserver>

        <SectionObserver sectionId="how-it-works" variant={variant}>
          <HowItWorksSection dict={dict.howItWorks} />
        </SectionObserver>

        <SectionObserver sectionId="trust-engine" variant={variant}>
          <TrustEngineSection dict={dict.trustEngine} />
        </SectionObserver>

        <SectionObserver sectionId="for-who" variant={variant}>
          <ForWhoSection dict={dict.forWho} />
        </SectionObserver>

        <SectionObserver sectionId="emotional" variant={variant}>
          <EmotionalBlock dict={dict.emotionalBlock} />
        </SectionObserver>

        <SectionObserver sectionId="comparison" variant={variant}>
          <ComparisonSection dict={dict.comparison} />
        </SectionObserver>

        <SectionObserver sectionId="waitlist-cta" variant={variant}>
          <WaitlistCTASection dict={dict.waitlistCta} variant={variant} />
        </SectionObserver>
      </main>

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
