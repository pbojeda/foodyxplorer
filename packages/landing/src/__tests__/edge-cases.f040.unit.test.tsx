/**
 * F040 — FAQ Section + Schema: Unit Edge-Case Tests
 *
 * Tests for: dictionary parity, generateFAQPageSchema special characters,
 * FAQSection boundary/structural cases.
 *
 * No page.tsx mocks here — this file imports and renders the REAL components.
 *
 * Run with: cd packages/landing && npx jest edge-cases.f040.unit --no-coverage
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { getDictionary } from '@/lib/i18n';
import { generateFAQPageSchema } from '@/lib/seo';
import { FAQSection } from '@/components/sections/FAQSection';

// ---------------------------------------------------------------------------
// 1. i18n structural parity — en.ts mirrors es.ts
// ---------------------------------------------------------------------------

describe('F040 — dictionary parity (es / en)', () => {
  const es = getDictionary('es');
  const en = getDictionary('en');

  it('en.ts faq key exists with eyebrow, headline, and items', () => {
    expect(en.faq).toBeDefined();
    expect(typeof en.faq.eyebrow).toBe('string');
    expect(en.faq.eyebrow.length).toBeGreaterThan(0);
    expect(typeof en.faq.headline).toBe('string');
    expect(en.faq.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(en.faq.items)).toBe(true);
  });

  it('en.ts faq.items has the same count as es.ts (6)', () => {
    expect(en.faq.items).toHaveLength(es.faq.items.length);
    expect(en.faq.items).toHaveLength(6);
  });

  it('every en.ts faq item has non-empty question and answer strings', () => {
    for (const item of en.faq.items) {
      expect(typeof item.question).toBe('string');
      expect(item.question.length).toBeGreaterThan(0);
      expect(typeof item.answer).toBe('string');
      expect(item.answer.length).toBeGreaterThan(0);
    }
  });

  it('es.ts and en.ts faq items all have non-empty question and answer (cross-check)', () => {
    for (const locale of ['es', 'en'] as const) {
      const d = getDictionary(locale);
      for (const item of d.faq.items) {
        expect(item.question.length).toBeGreaterThan(0);
        expect(item.answer.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Special characters in generateFAQPageSchema
//    es.ts item 3 contains apostrophes (McDonald's, Domino's).
//    The schema generator must preserve strings as-is;
//    safeJsonLd (in page.tsx) handles < escaping.
// ---------------------------------------------------------------------------

describe('F040 — generateFAQPageSchema: special characters', () => {
  it('preserves apostrophes in question and answer fields', () => {
    const schema = generateFAQPageSchema([
      { question: "What's available?", answer: "McDonald's and Domino's." },
    ]);
    expect(schema.mainEntity[0].name).toBe("What's available?");
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe("McDonald's and Domino's.");
  });

  it('preserves double-quotes in question and answer fields', () => {
    const schema = generateFAQPageSchema([
      { question: 'Is it "free"?', answer: 'Yes, "always".' },
    ]);
    expect(schema.mainEntity[0].name).toBe('Is it "free"?');
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe('Yes, "always".');
  });

  it('raw generator output preserves < characters (escaping is safeJsonLd\'s responsibility)', () => {
    // The spec explicitly states the generator does NOT pre-escape.
    // safeJsonLd at the call site in page.tsx handles < → \u003c.
    const schema = generateFAQPageSchema([
      { question: 'A < B?', answer: 'Yes, A < B.' },
    ]);
    expect(schema.mainEntity[0].name).toBe('A < B?');
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe('Yes, A < B.');
  });

  it('safeJsonLd escapes < in serialised FAQ schema (XSS prevention)', () => {
    // Replicate safeJsonLd exactly as implemented in page.tsx
    function safeJsonLd(data: object): string {
      return JSON.stringify(data).replace(/</g, '\\u003c');
    }
    const schema = generateFAQPageSchema([
      { question: 'A < B?', answer: '<script>alert(1)</script>' },
    ]);
    const serialised = safeJsonLd(schema);
    expect(serialised).not.toContain('<');
    expect(serialised).toContain('\\u003c');
    // The serialised output must still be valid JSON when parsed back
    const parsed = JSON.parse(serialised) as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(parsed.mainEntity[0].name).toBe('A < B?');
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe('<script>alert(1)</script>');
  });

  it('real es.ts FAQ items serialise through safeJsonLd without throwing', () => {
    function safeJsonLd(data: object): string {
      return JSON.stringify(data).replace(/</g, '\\u003c');
    }
    const { faq } = getDictionary('es');
    const schema = generateFAQPageSchema(faq.items);
    expect(() => safeJsonLd(schema)).not.toThrow();
    expect(() => JSON.parse(safeJsonLd(schema))).not.toThrow();
  });

  it('es.ts FAQ item 3 (restaurants — McDonald\'s) survives schema round-trip', () => {
    const { faq } = getDictionary('es');
    const restaurantItem = faq.items[2]; // "¿Qué restaurantes están disponibles?"
    const schema = generateFAQPageSchema([restaurantItem]);
    expect(schema.mainEntity[0].name).toBe(restaurantItem.question);
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe(restaurantItem.answer);
  });
});

// ---------------------------------------------------------------------------
// 3. FAQSection boundary and structural edge cases
// ---------------------------------------------------------------------------

describe('F040 — FAQSection: boundary and structural edge cases', () => {
  it('renders correctly with exactly 1 item (single-item boundary)', () => {
    const singleItem = [{ question: 'Solo question?', answer: 'Solo answer.' }];
    const { container } = render(
      <FAQSection dict={{ eyebrow: 'FAQ', headline: 'Questions', items: singleItem }} />,
    );
    expect(container.querySelector('section')).not.toBeNull();
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(container.querySelectorAll('summary')).toHaveLength(1);
    expect(screen.getByText('Solo question?')).toBeInTheDocument();
    expect(screen.getByText('Solo answer.')).toBeInTheDocument();
  });

  it('single-item details element still carries name="faq"', () => {
    const singleItem = [{ question: 'Q?', answer: 'A.' }];
    const { container } = render(
      <FAQSection dict={{ eyebrow: 'E', headline: 'H', items: singleItem }} />,
    );
    const details = container.querySelector('details');
    expect(details?.getAttribute('name')).toBe('faq');
  });

  it('each answer is rendered inside a <p> element (spec: "rendered as single <p> per item")', () => {
    const { container } = render(<FAQSection dict={getDictionary('es').faq} />);
    const allDetails = container.querySelectorAll('details');
    const items = getDictionary('es').faq.items;
    allDetails.forEach((detail, i) => {
      const p = detail.querySelector('p');
      expect(p).not.toBeNull();
      expect(p?.textContent).toBe(items[i].answer);
    });
  });

  it('question is rendered inside <summary> (not just any element)', () => {
    const { container } = render(<FAQSection dict={getDictionary('es').faq} />);
    const allDetails = container.querySelectorAll('details');
    const items = getDictionary('es').faq.items;
    allDetails.forEach((detail, i) => {
      const summary = detail.querySelector('summary');
      expect(summary).not.toBeNull();
      expect(summary?.textContent).toBe(items[i].question);
    });
  });

  it('renders items with apostrophes without distorting visible text', () => {
    const specialItems = [
      { question: "What's in McDonald's?", answer: "It's available at Domino's too." },
    ];
    render(
      <FAQSection dict={{ eyebrow: 'FAQ', headline: 'Questions', items: specialItems }} />,
    );
    expect(screen.getByText("What's in McDonald's?")).toBeInTheDocument();
    expect(screen.getByText("It's available at Domino's too.")).toBeInTheDocument();
  });

  it('renders items with HTML-special characters as literal text (React escaping)', () => {
    const xssItem = [
      { question: 'Safe?', answer: '<script>alert("xss")</script>' },
    ];
    const { container } = render(
      <FAQSection dict={{ eyebrow: 'FAQ', headline: 'Questions', items: xssItem }} />,
    );
    // React renders the string as text content — no actual <script> tag is created
    const p = container.querySelector('details p');
    expect(p?.textContent).toBe('<script>alert("xss")</script>');
    expect(container.querySelector('details script')).toBeNull();
  });
});
