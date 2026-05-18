/**
 * @jest-environment jsdom
 *
 * F105 — Landing Coverage Showcase: section component render tests.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { CoverageShowcaseSection } from '@/components/sections/CoverageShowcaseSection';
import { getDictionary } from '@/lib/i18n';
import { COVERAGE_COUNTS } from '@/lib/coverage-counts';

const dict = getDictionary('es');

describe('CoverageShowcaseSection', () => {
  it('renders a section landmark with the expected aria-label', () => {
    render(<CoverageShowcaseSection dict={dict.coverageShowcase} />);
    expect(
      screen.getByRole('region', { name: dict.coverageShowcase.headline }),
    ).toBeInTheDocument();
  });

  it('renders the eyebrow, headline and subtitle from the dictionary', () => {
    render(<CoverageShowcaseSection dict={dict.coverageShowcase} />);
    expect(screen.getByText(dict.coverageShowcase.eyebrow)).toBeInTheDocument();
    expect(screen.getByText(dict.coverageShowcase.headline)).toBeInTheDocument();
    expect(screen.getByText(dict.coverageShowcase.subtitle)).toBeInTheDocument();
  });

  it('renders four stat cards with the live counts from the helper', () => {
    render(<CoverageShowcaseSection dict={dict.coverageShowcase} />);
    const region = screen.getByRole('region', {
      name: dict.coverageShowcase.headline,
    });
    expect(
      within(region).getByText(String(COVERAGE_COUNTS.dishes)),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(String(COVERAGE_COUNTS.foods)),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(String(COVERAGE_COUNTS.categories)),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(String(COVERAGE_COUNTS.confidenceLevels)),
    ).toBeInTheDocument();
  });

  it('renders the four stat labels from the dictionary', () => {
    render(<CoverageShowcaseSection dict={dict.coverageShowcase} />);
    for (const stat of dict.coverageShowcase.stats) {
      expect(screen.getByText(stat.label)).toBeInTheDocument();
    }
  });

  it('exposes data-section="coverage-showcase" for analytics observers', () => {
    const { container } = render(
      <CoverageShowcaseSection dict={dict.coverageShowcase} />,
    );
    expect(container.querySelector('[data-section="coverage-showcase"]')).not.toBeNull();
  });
});
