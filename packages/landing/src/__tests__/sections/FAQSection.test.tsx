import React from 'react';
import { render, screen } from '@testing-library/react';
import { FAQSection } from '@/components/sections/FAQSection';
import { getDictionary } from '@/lib/i18n';

const dict = getDictionary('es');

describe('FAQSection — dictionary data', () => {
  it('es.ts faq has eyebrow, headline, and 6 items', () => {
    expect(dict.faq.eyebrow).toBeTruthy();
    expect(dict.faq.headline).toBeTruthy();
    expect(dict.faq.items).toHaveLength(6);
    for (const item of dict.faq.items) {
      expect(typeof item.question).toBe('string');
      expect(typeof item.answer).toBe('string');
      expect(item.question.length).toBeGreaterThan(0);
      expect(item.answer.length).toBeGreaterThan(0);
    }
  });
});

describe('FAQSection', () => {
  it('renders nothing when items array is empty', () => {
    const { container } = render(
      <FAQSection dict={{ eyebrow: '', headline: '', items: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders eyebrow and headline', () => {
    render(<FAQSection dict={dict.faq} />);
    expect(screen.getByText(dict.faq.eyebrow)).toBeInTheDocument();
    expect(screen.getByText(dict.faq.headline)).toBeInTheDocument();
  });

  it('renders a level-2 heading', () => {
    render(<FAQSection dict={dict.faq} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      dict.faq.headline,
    );
  });

  it('renders all 6 items as details/summary elements', () => {
    const { container } = render(<FAQSection dict={dict.faq} />);
    const details = container.querySelectorAll('details');
    expect(details).toHaveLength(6);

    const summaries = container.querySelectorAll('summary');
    expect(summaries).toHaveLength(6);
  });

  it('all details share the same name attribute', () => {
    const { container } = render(<FAQSection dict={dict.faq} />);
    const details = container.querySelectorAll('details');
    const names = Array.from(details).map((d) => d.getAttribute('name'));
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBe('faq');
  });

  it('renders each question as summary text', () => {
    render(<FAQSection dict={dict.faq} />);
    for (const item of dict.faq.items) {
      expect(screen.getByText(item.question)).toBeInTheDocument();
    }
  });

  it('renders each answer as paragraph text', () => {
    render(<FAQSection dict={dict.faq} />);
    for (const item of dict.faq.items) {
      expect(screen.getByText(item.answer)).toBeInTheDocument();
    }
  });

  it('has data-section="faq" attribute', () => {
    const { container } = render(<FAQSection dict={dict.faq} />);
    expect(container.querySelector('[data-section="faq"]')).not.toBeNull();
  });

  it('has aria-labelledby pointing to heading id', () => {
    const { container } = render(<FAQSection dict={dict.faq} />);
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('aria-labelledby', 'faq-heading');
    expect(container.querySelector('#faq-heading')).not.toBeNull();
  });
});

describe('FAQSection — data safety answer (F059 C3)', () => {
  it('FAQ answer for data safety contains "lista de espera"', () => {
    const dataSafetyItem = dict.faq.items.find((item) =>
      item.question.includes('datos están seguros')
    );
    expect(dataSafetyItem).toBeDefined();
    expect(dataSafetyItem!.answer).toContain('lista de espera');
  });

  it('FAQ answer for data safety does NOT contain "No almacenamos datos personales"', () => {
    const dataSafetyItem = dict.faq.items.find((item) =>
      item.question.includes('datos están seguros')
    );
    expect(dataSafetyItem).toBeDefined();
    expect(dataSafetyItem!.answer).not.toContain('No almacenamos datos personales');
  });
});
