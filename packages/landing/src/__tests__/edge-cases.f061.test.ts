/**
 * F061 — Landing Copy Accuracy & Content Fixes
 *
 * Pure data assertions against i18n dictionaries and ab-testing.ts source.
 * No component rendering needed — fast and deterministic.
 *
 * Covers: I3 (FAQ chain count), I4 (testimonial attribution), I7 (A/B comment),
 *         S6 (urgency copy)
 */

import * as fs from 'fs';
import * as path from 'path';
import { es } from '../lib/i18n/locales/es';
import { en } from '../lib/i18n/locales/en';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFaqAnswer(
  dict: typeof es | typeof en,
  questionFragment: string
): string {
  const item = dict.faq.items.find((i) => i.question.includes(questionFragment));
  if (!item) throw new Error(`FAQ item not found for: "${questionFragment}"`);
  return item.answer;
}

// ---------------------------------------------------------------------------
// Bug I3 — FAQ chain coverage (no longer claims "10 cadenas")
// ---------------------------------------------------------------------------

describe('F061 — FAQ restaurants answer', () => {
  it('ES answer starts with "Actualmente cubrimos las principales cadenas"', () => {
    const answer = getFaqAnswer(es, 'restaurantes');
    expect(answer).toMatch(/^Actualmente cubrimos las principales cadenas/);
  });

  it('ES answer contains "entre otras"', () => {
    const answer = getFaqAnswer(es, 'restaurantes');
    expect(answer).toContain('entre otras');
  });

  it('ES answer does NOT contain "10 cadenas"', () => {
    const answer = getFaqAnswer(es, 'restaurantes');
    expect(answer).not.toContain('10 cadenas');
  });

  it('EN answer starts with "We currently cover the main Spanish chains"', () => {
    const answer = getFaqAnswer(en, 'restaurants');
    expect(answer).toMatch(/^We currently cover the main Spanish chains/);
  });

  it('EN answer contains "among others"', () => {
    const answer = getFaqAnswer(en, 'restaurants');
    expect(answer).toContain('among others');
  });

  it('EN answer does NOT contain "10 chains"', () => {
    const answer = getFaqAnswer(en, 'restaurants');
    expect(answer).not.toContain('10 chains');
  });
});

// ---------------------------------------------------------------------------
// Bug I4 — Fabricated testimonial attribution
// ---------------------------------------------------------------------------

describe('F061 — emotionalBlock.quoteAuthor', () => {
  it('ES quoteAuthor === "Experiencia que buscamos ofrecer"', () => {
    expect(es.emotionalBlock.quoteAuthor).toBe('Experiencia que buscamos ofrecer');
  });

  it('EN quoteAuthor === "The experience we aim to deliver"', () => {
    expect(en.emotionalBlock.quoteAuthor).toBe('The experience we aim to deliver');
  });
});

// ---------------------------------------------------------------------------
// Bug S6 — Urgency claim without backing
// ---------------------------------------------------------------------------

describe('F061 — waitlistCta.urgency', () => {
  it('ES urgency === "Apúntate para acceder antes que nadie cuando lancemos"', () => {
    expect(es.waitlistCta.urgency).toBe(
      'Apúntate para acceder antes que nadie cuando lancemos'
    );
  });

  it('EN urgency === "Sign up to get early access when we launch"', () => {
    expect(en.waitlistCta.urgency).toBe('Sign up to get early access when we launch');
  });
});

// ---------------------------------------------------------------------------
// Bug I7 — A/B resolver JSDoc comment mismatch
// ---------------------------------------------------------------------------

describe('F061 — ab-testing.ts source accuracy', () => {
  const abTestingPath = path.resolve(
    __dirname,
    '../lib/ab-testing.ts'
  );
  const source = fs.readFileSync(abTestingPath, 'utf-8');

  it('source contains "default \'a\'"', () => {
    expect(source).toContain("default 'a'");
  });

  it('source does NOT contain "random 50/50"', () => {
    expect(source).not.toContain('random 50/50');
  });

  it('source does NOT contain the random parameter in the signature', () => {
    expect(source).not.toContain('random: () => number');
  });
});
