import { generateWebSiteSchema, generateSoftwareApplicationSchema } from '@/lib/seo';

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
