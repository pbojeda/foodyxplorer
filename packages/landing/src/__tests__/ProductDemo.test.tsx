import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProductDemo } from '@/components/ProductDemo';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
  },
}));

describe('ProductDemo', () => {
  it('renders the section badge', () => {
    render(<ProductDemo />);
    expect(screen.getByText(/consulta real/i)).toBeInTheDocument();
  });

  it('renders the main headline', () => {
    render(<ProductDemo />);
    expect(screen.getByRole('heading', { name: /más producto real/i })).toBeInTheDocument();
  });

  it('renders timeline step labels', () => {
    render(<ProductDemo />);
    // Timeline steps include "Paso X · Title" so check for step titles within the text
    expect(screen.getByText(/Paso 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Paso 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Paso 3/i)).toBeInTheDocument();
  });

  it('renders the app mockup with calories', () => {
    render(<ProductDemo />);
    // Use getAllByText since calories appear in both timeline and mockup
    const kcalElements = screen.getAllByText(/482 kcal/);
    expect(kcalElements.length).toBeGreaterThan(0);
  });

  it('renders the confidence level badge', () => {
    render(<ProductDemo />);
    expect(screen.getByText('L2')).toBeInTheDocument();
  });

  it('renders the allergen guardrail', () => {
    render(<ProductDemo />);
    expect(screen.getAllByText(/sin dato oficial/i).length).toBeGreaterThan(0);
  });

  it('renders macros summary', () => {
    render(<ProductDemo />);
    expect(screen.getByText(/31 g proteína/)).toBeInTheDocument();
  });

  it('renders trust route section', () => {
    render(<ProductDemo />);
    expect(screen.getByText(/ruta de confianza/i)).toBeInTheDocument();
  });
});
