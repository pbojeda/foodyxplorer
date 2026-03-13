// Unit tests for lib/htmlTextExtractor.ts
//
// extractTextFromHtml is a pure synchronous function — no mocks needed.
// Inputs are HTML strings (inline or loaded from fixtures/html/).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { extractTextFromHtml } from '../../lib/htmlTextExtractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../fixtures/html');

function loadFixtureHtml(filename: string): string {
  return readFileSync(join(fixturesDir, filename), 'utf-8');
}

describe('extractTextFromHtml', () => {
  describe('Simple table extraction', () => {
    it('returns tab-separated lines for each <tr>', () => {
      const html = `
        <table>
          <tr><th>Calorías</th><th>Proteínas</th><th>Grasas</th></tr>
          <tr><td>Pollo asado</td><td>285</td><td>14</td></tr>
          <tr><td>Ensalada</td><td>120</td><td>8</td></tr>
        </table>
      `;
      const result = extractTextFromHtml(html);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Calorías\tProteínas\tGrasas');
      expect(result[1]).toBe('Pollo asado\t285\t14');
      expect(result[2]).toBe('Ensalada\t120\t8');
    });
  });

  describe('Multiple tables in document order', () => {
    it('extracts rows from both tables in document order', () => {
      const html = loadFixtureHtml('multi-section-table.html');
      const result = extractTextFromHtml(html);

      // Find header rows from each table
      const firstTableHeaderIdx = result.findIndex((line) =>
        line.includes('Calorías') && line.includes('Proteínas'),
      );
      expect(firstTableHeaderIdx).toBeGreaterThanOrEqual(0);

      // Look for "Ensalada mixta" (first table) and "Pollo a la plancha" (second table)
      const ensaladaIdx = result.findIndex((l) => l.startsWith('Ensalada mixta'));
      const polloIdx = result.findIndex((l) => l.startsWith('Pollo a la plancha'));

      expect(ensaladaIdx).toBeGreaterThan(-1);
      expect(polloIdx).toBeGreaterThan(-1);
      // First table rows must appear before second table rows
      expect(ensaladaIdx).toBeLessThan(polloIdx);
    });

    it('contains rows from the second table', () => {
      const html = loadFixtureHtml('multi-section-table.html');
      const result = extractTextFromHtml(html);
      const hamburguesaLine = result.find((l) => l.startsWith('Hamburguesa clásica'));
      expect(hamburguesaLine).toBeDefined();
    });
  });

  describe('<script> and <style> excluded', () => {
    it('does not include script content in output', () => {
      const html = `
        <html><body>
          <script>alert('should-not-appear')</script>
          <p>Texto visible</p>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('alert');
      expect(joined).not.toContain('should-not-appear');
    });

    it('does not include style content in output', () => {
      const html = `
        <html><body>
          <style>body { color: red; } /* STYLE_CONTENT */</style>
          <p>Texto visible</p>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('color: red');
      expect(joined).not.toContain('STYLE_CONTENT');
    });
  });

  describe('Noise structural elements excluded', () => {
    it('excludes text inside <nav>', () => {
      const html = `
        <html><body>
          <nav>NAV_CONTENT nav link</nav>
          <p>Contenido principal</p>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('NAV_CONTENT');
    });

    it('excludes text inside <footer>', () => {
      const html = `
        <html><body>
          <p>Contenido principal</p>
          <footer>FOOTER_CONTENT copyright 2026</footer>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('FOOTER_CONTENT');
    });

    it('excludes text inside <header>', () => {
      const html = `
        <html><body>
          <header>HEADER_CONTENT logo brand</header>
          <p>Contenido principal</p>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('HEADER_CONTENT');
    });

    it('excludes text inside <aside>', () => {
      const html = `
        <html><body>
          <p>Contenido principal</p>
          <aside>ASIDE_CONTENT alérgenos disponibles</aside>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');
      expect(joined).not.toContain('ASIDE_CONTENT');
    });
  });

  describe('Block-level elements emitted as separate lines', () => {
    it('emits <p> and <div> as separate lines', () => {
      const html = `
        <html><body>
          <p>Hola mundo</p>
          <div>Otro texto</div>
        </body></html>
      `;
      const result = extractTextFromHtml(html);
      expect(result).toContain('Hola mundo');
      expect(result).toContain('Otro texto');
    });
  });

  describe('Empty HTML', () => {
    it('returns [] for empty body', () => {
      const html = loadFixtureHtml('empty.html');
      const result = extractTextFromHtml(html);
      expect(result).toEqual([]);
    });

    it('returns [] for bare empty body string', () => {
      const result = extractTextFromHtml('<html><body></body></html>');
      expect(result).toEqual([]);
    });
  });

  describe('Comma decimal normalisation', () => {
    it('converts "1,5" to "1.5" in table cell values', () => {
      const html = `
        <table>
          <tr><td>Pollo</td><td>1,5</td><td>2,3</td></tr>
        </table>
      `;
      const result = extractTextFromHtml(html);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Pollo\t1.5\t2.3');
    });

    it('does not alter non-numeric comma contexts', () => {
      const html = `
        <table>
          <tr><th>Plato</th><th>Calorías</th></tr>
          <tr><td>Pollo asado</td><td>32,5</td></tr>
        </table>
      `;
      const result = extractTextFromHtml(html);
      // 32,5 should become 32.5
      const dataLine = result.find((l) => l.startsWith('Pollo asado'));
      expect(dataLine).toBeDefined();
      expect(dataLine).toContain('32.5');
    });
  });

  describe('<thead> and <tbody> processed in document order', () => {
    it('emits header row before data rows', () => {
      const html = `
        <table>
          <thead>
            <tr><th>Plato</th><th>Calorías</th></tr>
          </thead>
          <tbody>
            <tr><td>Pollo asado</td><td>285</td></tr>
          </tbody>
        </table>
      `;
      const result = extractTextFromHtml(html);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Plato\tCalorías');
      expect(result[1]).toBe('Pollo asado\t285');
    });
  });

  describe('Whitespace-only lines stripped', () => {
    it('does not include whitespace-only lines in output', () => {
      const html = `
        <table>
          <tr><td>  </td><td>   </td></tr>
          <tr><td>Pollo</td><td>285</td></tr>
        </table>
      `;
      const result = extractTextFromHtml(html);
      // Only the non-empty row should appear
      expect(result.every((l) => l.trim().length > 0)).toBe(true);
      expect(result).toContain('Pollo\t285');
    });
  });

  describe('Sample nutrition table fixture', () => {
    it('extracts all 11 rows (1 header + 10 data) from sample-nutrition-table.html', () => {
      const html = loadFixtureHtml('sample-nutrition-table.html');
      const result = extractTextFromHtml(html);

      // Find the header row
      const headerIdx = result.findIndex(
        (l) => l.includes('Calorías') && l.includes('Proteínas'),
      );
      expect(headerIdx).toBeGreaterThanOrEqual(0);

      // Find a data row
      const polloLine = result.find((l) => l.startsWith('Pollo a la plancha'));
      expect(polloLine).toBeDefined();
      // Comma decimal should be normalized
      expect(polloLine).toContain('32.5');
    });

    it('does not contain nav/footer/header/aside/script content', () => {
      const html = loadFixtureHtml('sample-nutrition-table.html');
      const result = extractTextFromHtml(html);
      const joined = result.join(' ');

      // From <nav>
      expect(joined).not.toContain('Inicio');
      // From <footer>
      expect(joined).not.toContain('Todos los derechos reservados');
      // From <aside>
      expect(joined).not.toContain('Alérgenos disponibles');
      // From <script>
      expect(joined).not.toContain('console.log');
    });
  });
});
