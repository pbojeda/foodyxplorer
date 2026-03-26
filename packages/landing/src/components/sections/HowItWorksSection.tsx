import type { Dictionary } from '@/lib/i18n';
import { SearchSimulatorWithCTA } from '@/components/features/SearchSimulatorWithCTA';
import type { Variant } from '@/types';

interface HowItWorksSectionProps {
  dict: Dictionary['howItWorks'];
  variant?: Variant;
}

// Inline SVG icons for each step
const StepIcons = [
  // Search icon
  <svg
    key="search"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>,
  // Chart/macros icon
  <svg
    key="chart"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 3v18h18" />
    <path d="m19 9-5 5-4-4-3 3" />
  </svg>,
  // Checkmark/decision icon
  <svg
    key="check"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 12l2 2 4-4" />
    <circle cx="12" cy="12" r="10" />
  </svg>,
];

export function HowItWorksSection({ dict, variant = 'a' }: HowItWorksSectionProps) {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      data-section="how-it-works"
      id="como-funciona"
      className="bg-paper py-16 lg:py-20"
    >
      <div className="section-shell">
        {/* Header */}
        <div className="mb-16 text-center">
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-widest text-brand-orange md:text-sm">
            {dict.eyebrow}
          </p>
          <h2
            id="how-it-works-heading"
            className="text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-[44px]"
          >
            {dict.headline}
          </h2>
        </div>

        {/* 3-column grid on lg+, single column on mobile */}
        <ol className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-12">
          {dict.steps.map((step, index) => (
            <li key={step.title} className="relative flex flex-col">
              {/* Step number — decorative large numeral */}
              <span
                aria-hidden="true"
                className="-left-2 -top-4 absolute select-none text-7xl font-black leading-none text-brand-green opacity-10"
              >
                {index + 1}
              </span>
              {/* Icon */}
              <div className="relative mb-5 text-brand-green">{StepIcons[index]}</div>
              {/* Content */}
              <h3 className="mb-3 text-xl font-bold text-slate-900 md:text-[28px]">
                {step.title}
              </h3>
              <p className="text-base leading-relaxed text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>

        {/* SearchSimulator with post-interaction CTA — embedded below steps */}
        <SearchSimulatorWithCTA variant={variant} />
      </div>
    </section>
  );
}
