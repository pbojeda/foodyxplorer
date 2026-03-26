import type { Dictionary } from '@/lib/i18n';

interface HowItWorksSectionProps {
  dict: Dictionary['howItWorks'];
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

export function HowItWorksSection({ dict }: HowItWorksSectionProps) {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      data-section="how-it-works"
      className="bg-slate-50 py-20 lg:py-24"
    >
      <div className="max-w-container mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-[13px] md:text-sm font-semibold tracking-widest uppercase text-brand-orange mb-4">
            {dict.eyebrow}
          </p>
          <h2
            id="how-it-works-heading"
            className="text-3xl md:text-[44px] font-bold tracking-tight leading-snug text-slate-900"
          >
            {dict.headline}
          </h2>
        </div>

        {/* 3-column grid on lg+, single column on mobile */}
        <ol className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
          {dict.steps.map((step, index) => (
            <li key={step.title} className="relative flex flex-col">
              {/* Step number — decorative large numeral */}
              <span
                aria-hidden="true"
                className="absolute -top-4 -left-2 text-7xl font-black text-brand-green opacity-10 select-none leading-none"
              >
                {index + 1}
              </span>
              {/* Icon */}
              <div className="relative mb-5 text-brand-green">
                {StepIcons[index]}
              </div>
              {/* Content */}
              <h3 className="text-xl md:text-[28px] font-bold text-slate-900 mb-3">
                {step.title}
              </h3>
              <p className="text-base leading-relaxed text-slate-600">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
