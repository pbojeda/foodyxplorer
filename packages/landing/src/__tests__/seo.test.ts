import {
  generateWebSiteSchema,
  generateSoftwareApplicationSchema,
  generateFAQPageSchema,
} from '@/lib/seo';

describe('generateWebSiteSchema', () => {
  it('returns a WebSite schema with correct type', () => {
    const schema = generateWebSiteSchema();
    expect(schema['@type']).toBe('WebSite');
  });

  it('does NOT include potentialAction (SearchAction removed — BUG-LANDING-08)', () => {
    const schema = generateWebSiteSchema();
    expect(schema).not.toHaveProperty('potentialAction');
  });

  it('includes name and url', () => {
    const schema = generateWebSiteSchema();
    expect(schema).toHaveProperty('name', 'nutriXplorer');
    expect(schema).toHaveProperty('url');
  });
});

describe('generateSoftwareApplicationSchema', () => {
  it('returns a SoftwareApplication schema', () => {
    const schema = generateSoftwareApplicationSchema();
    expect(schema['@type']).toBe('SoftwareApplication');
  });
});

describe('generateFAQPageSchema', () => {
  it('returns FAQPage schema with correct @type and @context', () => {
    const schema = generateFAQPageSchema([
      { question: 'Q1', answer: 'A1' },
    ]);
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('FAQPage');
  });

  it('maps items to mainEntity Question/Answer pairs', () => {
    const schema = generateFAQPageSchema([
      { question: 'What is X?', answer: 'X is a tool.' },
      { question: 'Is it free?', answer: 'Yes.' },
    ]);
    expect(schema.mainEntity).toHaveLength(2);
    expect(schema.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: 'What is X?',
      acceptedAnswer: { '@type': 'Answer', text: 'X is a tool.' },
    });
    expect(schema.mainEntity[1]).toEqual({
      '@type': 'Question',
      name: 'Is it free?',
      acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
    });
  });

  it('returns empty mainEntity array for empty input', () => {
    const schema = generateFAQPageSchema([]);
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toEqual([]);
  });
});
