// Preprocessor unit tests for Pans & Company Spain (F015)
//
// The PDF extracted text has product names separated from nutritional data.
// Per-page structure (pages 1,2,4,5):
//   - Meta/header lines (date, page number, nutrient column labels)
//   - Alternating pairs:
//       "Por Unidade Consumo \t values"  (per-serving, skip)
//       "Por 100 gramas \t values"       (per-100g, collect)
//   - Product names mixed with ALL-CAPS category headers
// Page 3 has inline items: "ProductName \t Por 100 gramas \t kJ \t kcal \t ..."
//
// The preprocessor pairs product names with Per-100g rows (1:1 in order),
// strips kJ, and emits: "Name \t kcal \t fat \t satfat \t carbs \t sugars \t protein \t salt"

import { describe, it, expect } from 'vitest';
import { preprocessChainText } from '../../../ingest/chainTextPreprocessor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Simulate pages 1-2 structure: data rows appear before product names
// (pdf-parse outputs column-by-column in multi-column layouts)
const PAGE1_LINES = [
  // Meta header (real PDF format: combined line with tab)
  'Data de impressão: 17/03/2026',
  'Página 1 de 5 \tPSA IC 001pac.49',
  // Column labels (real PDF format: includes unit suffixes)
  'Energia (Kj)',
  'Energia (kcal)',
  'Lípidos (g)',
  '…dos quais\t',
  'saturados (g)\t',
  'Hidratos de\t',
  'Carbono (g)',
  '…dos quais\t',
  'açucares (g)',
  'Proteínas (g)',
  'Sal (g)',
  // Repeating page headers (skipped)
  'TABELA NUTRICIONAL',
  'SANDES QUENTES',
  // Per-unit rows (skip label + values)
  'Por Unidade Consumo\t875\t208\t5,3\t1,4\t26,9\t4,1\t11,6\t1,4',
  // Per-100g row (collect)
  'Por 100 gramas\t750\t179\t4,5\t1,2\t23,1\t3,5\t9,9\t1,2',
  'Por Unidade Consumo\t1090\t260\t7,9\t2,3\t32,0\t5,2\t14,2\t1,8',
  'Por 100 gramas\t840\t200\t6,1\t1,8\t24,6\t4,0\t10,9\t1,4',
  'Por Unidade Consumo\t980\t234\t6,8\t2,0\t29,8\t4,8\t12,7\t1,6',
  'Por 100 gramas\t810\t193\t5,6\t1,6\t25,4\t4,1\t10,8\t1,3',
  // ALL-CAPS category header (skip)
  'SANDES FRIAS',
  // Product names appear at the end of the column layout
  'Americana',
  'Mexicana',
  'Italiana',
];

// Page 3 has inline items (Name\tPor 100 gramas\tkJ\tkcal\t...)
// plus some separated name/data rows
const PAGE3_LINES = [
  'Página 3 de 5',
  // Inline items (single row has both name and data)
  'Sopa do Dia\tPor 100 gramas\t168\t40\t0,5\t0,1\t7,2\t1,8\t1,9\t0,4',
  'Sopa de Legumes\tPor 100 gramas\t175\t42\t0,6\t0,1\t7,5\t2,0\t1,8\t0,5',
  // Separated format: per-100g rows then names
  'Por 100 gramas\t630\t150\t3,2\t0,8\t21,5\t3,4\t8,5\t1,0',
  'Por 100 gramas\t710\t169\t4,1\t1,0\t23,8\t4,2\t9,2\t1,1',
  // Category header (skip)
  'SALADAS',
  // Product names
  'Salada Caesar',
  'Salada Tuna',
];

// Mixed format with various things to filter
const FILTER_TEST_LINES = [
  // Disclaimer lines (skip)
  'Notas: Os valores nutricionais apresentados...',
  'Esta informação é baseada nos ingredientes padrão.',
  'Alguns restaurantes podem apresentar variações.',
  'locais de fornecimento podem alterar os valores.',
  // Page header (skip)
  'TABELA NUTRICIONAL',
  // ALL-CAPS headers (skip)
  'PÃO PROVENÇAL',
  'BOLA RÚSTICA',
  'PÃO SEMENTES',
  'PÃO CANTABRICO',
  // Data rows to skip
  'Por Unidade Consumo\t950\t227\t8,1\t2,5\t27,3\t4,8\t12,2\t1,5',
  'Dose Pequena\t1373\t328\t9,2\t1,1\t31,1\t0,4\t3,4\t0,2',
  // Per-100g data row (collect)
  'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
  // Product name (collect)
  'Sande Atum',
];

// Empty / edge cases
const EMPTY_LINES: string[] = [];
const ONLY_META_LINES = [
  'TABELA NUTRICIONAL',
  'Página 1 de 5 \tPSA IC 001pac.49',
  'Data de impressão: 17/03/2026',
  'Energia (Kj)',
  'Energia (kcal)',
  'Lípidos (g)',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preprocessChainText — pans-and-company-es', () => {
  describe('basic routing', () => {
    it('returns non-empty output for valid input', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty array for empty input', () => {
      const result = preprocessChainText('pans-and-company-es', EMPTY_LINES);
      expect(result).toEqual([]);
    });

    it('returns empty array when only meta lines present (no data/names)', () => {
      const result = preprocessChainText('pans-and-company-es', ONLY_META_LINES);
      expect(result).toEqual([]);
    });
  });

  describe('synthetic header injection', () => {
    it('injects synthetic header as first non-empty output line', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result[0]).toContain('Calorías');
    });

    it('synthetic header contains all 7 required nutrient keywords', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      const header = result[0] ?? '';
      expect(header).toContain('Calorías');
      expect(header).toContain('Grasas');
      expect(header).toContain('Saturadas');
      expect(header).toContain('Hidratos');
      expect(header).toContain('Azúcares');
      expect(header).toContain('Proteínas');
      expect(header).toContain('Sal');
    });
  });

  describe('pages 1-2 format: separated names and data', () => {
    it('produces one output line per product (header + 3 dishes)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      // header + 3 dish lines
      expect(result.length).toBe(4);
    });

    it('merges name with Per-100g data (1:1 pairing)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      const americanaLine = result.find((l) => l.startsWith('Americana'));
      expect(americanaLine).toBeDefined();
    });

    it('first data value is kcal (not kJ)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      const americanaLine = result.find((l) => l.startsWith('Americana'));
      expect(americanaLine).toBeDefined();
      // First Per-100g row: 750\t179\t4,5\t1,2\t23,1\t3,5\t9,9\t1,2
      // After stripping "Por 100 gramas" prefix and kJ (750): kcal=179
      const parts = (americanaLine ?? '').split('\t');
      expect(parts[1]).toBe('179');
    });

    it('each dish line has 8 tab-separated parts (name + 7 values)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      const dishLines = result.slice(1); // skip header
      for (const line of dishLines) {
        const parts = line.split('\t');
        expect(parts.length).toBe(8);
      }
    });

    it('kJ column is removed (first value in Per-100g row is dropped)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      // kJ values from fixture: 750, 840, 810 — must NOT appear as first data value
      const dishLines = result.slice(1);
      for (const line of dishLines) {
        const firstValue = line.split('\t')[1];
        expect(['750', '840', '810']).not.toContain(firstValue);
      }
    });
  });

  describe('page 3 format: inline items', () => {
    it('extracts inline items (name\\tPor 100 gramas\\tvalues)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE3_LINES);
      const sopaLine = result.find((l) => l.startsWith('Sopa do Dia'));
      expect(sopaLine).toBeDefined();
    });

    it('inline item has kcal as first data value (kJ stripped)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE3_LINES);
      // Sopa do Dia: kJ=168, kcal=40
      const sopaLine = result.find((l) => l.startsWith('Sopa do Dia'));
      expect(sopaLine).toBeDefined();
      const parts = (sopaLine ?? '').split('\t');
      expect(parts[1]).toBe('40');
      expect(parts[0]).toBe('Sopa do Dia');
    });

    it('inline item has 8 parts (name + 7 values)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE3_LINES);
      const sopaLine = result.find((l) => l.startsWith('Sopa do Dia'));
      expect(sopaLine).toBeDefined();
      expect((sopaLine ?? '').split('\t').length).toBe(8);
    });

    it('handles mix of inline items and separated format on same page', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE3_LINES);
      // 2 inline items (Sopa do Dia, Sopa de Legumes) + 2 separated (Salada Caesar, Salada Tuna)
      const dishLines = result.slice(1); // skip header
      expect(dishLines.length).toBe(4);
    });

    it('separated items on page 3 also appear in output', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE3_LINES);
      const caesarLine = result.find((l) => l.startsWith('Salada Caesar'));
      expect(caesarLine).toBeDefined();
    });
  });

  describe('filtering — meta lines', () => {
    it('filters out "Data de impressão" lines', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.includes('Data de impressão'))).toBe(false);
    });

    it('filters out "Página X de Y" lines', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.includes('Página'))).toBe(false);
    });

    it('filters out PSA IC and page number lines', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.includes('PSA IC'))).toBe(false);
      expect(result.some((l) => l.includes('Página'))).toBe(false);
    });

    it('filters out nutrient column labels (Energia (Kj), Lípidos (g), etc.)', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.startsWith('Energia'))).toBe(false);
      expect(result.some((l) => l.startsWith('Lípidos'))).toBe(false);
      expect(result.some((l) => l === 'Proteínas (g)')).toBe(false);
    });

    it('filters out TABELA NUTRICIONAL repeating header', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.includes('TABELA NUTRICIONAL'))).toBe(false);
    });

    it('filters out SANDES QUENTES repeating header', () => {
      const result = preprocessChainText('pans-and-company-es', PAGE1_LINES);
      expect(result.some((l) => l.includes('SANDES QUENTES'))).toBe(false);
    });
  });

  describe('filtering — ALL-CAPS category headers', () => {
    it('filters out ALL-CAPS lines (SANDES FRIAS, BOLA RÚSTICA, etc.)', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.includes('SANDES FRIAS'))).toBe(false);
      expect(result.some((l) => l.includes('PÃO PROVENÇAL'))).toBe(false);
      expect(result.some((l) => l.includes('BOLA RÚSTICA'))).toBe(false);
      expect(result.some((l) => l.includes('PÃO SEMENTES'))).toBe(false);
      expect(result.some((l) => l.includes('PÃO CANTABRICO'))).toBe(false);
    });

    it('does NOT filter mixed-case product names', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      const sandeLine = result.find((l) => l.startsWith('Sande Atum'));
      expect(sandeLine).toBeDefined();
    });
  });

  describe('filtering — data and disclaimer lines', () => {
    it('filters out "Por Unidade Consumo" rows', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.includes('Por Unidade Consumo'))).toBe(false);
    });

    it('filters out numeric portion rows (4 Unidades, 12 unidades, etc.)', () => {
      const lines = [
        'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
        '4 Unidades\t1641\t392\t27,2\t5,6\t3,1\t0,8\t33,8\t1,1',
        '12 Unidades\t4924\t1177\t81,6\t16,9\t9,2\t2,3\t101,4\t3,2',
        '9 unidades\t1531\t365\t15,1\t1,8\t31,3\t2,7\t20,5\t1,3',
        '5 Unidades\t882\t211\t8,5\t2,1\t28,1\t5,6\t5,6\t1,3',
        'Nuggets de Frango',
      ];
      const result = preprocessChainText('pans-and-company-es', lines);
      // Only header + Nuggets de Frango should appear
      expect(result.length).toBe(2);
      expect(result.some((l) => l.includes('Unidades'))).toBe(false);
      expect(result.some((l) => l.includes('unidades'))).toBe(false);
      expect(result.find((l) => l.startsWith('Nuggets de Frango'))).toBeDefined();
    });

    it('filters out "Dose Pequena" lines with values', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.includes('Dose Pequena'))).toBe(false);
    });

    it('filters out disclaimer lines starting with "Notas:"', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.startsWith('Notas:'))).toBe(false);
    });

    it('filters out "Esta informação" disclaimer lines', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.startsWith('Esta informação'))).toBe(false);
    });

    it('filters out "Alguns restaurantes" disclaimer lines', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.startsWith('Alguns restaurantes'))).toBe(false);
    });

    it('filters out "locais de fornecimento" disclaimer lines', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.some((l) => l.startsWith('locais de fornecimento'))).toBe(false);
    });
  });

  describe('filter test combined output', () => {
    it('produces exactly header + 1 dish line from FILTER_TEST_LINES', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      expect(result.length).toBe(2); // header + "Sande Atum"
    });

    it('Sande Atum has kcal=191 as first data value (kJ=800 stripped)', () => {
      const result = preprocessChainText('pans-and-company-es', FILTER_TEST_LINES);
      const sandeLine = result.find((l) => l.startsWith('Sande Atum'));
      expect(sandeLine).toBeDefined();
      const parts = (sandeLine ?? '').split('\t');
      expect(parts[1]).toBe('191');
    });
  });

  describe('pairing mismatch handling', () => {
    it('drops extra data rows when more data than names', () => {
      const lines = [
        'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
        'Por 100 gramas\t900\t215\t7,2\t2,5\t25,0\t4,5\t11,0\t1,5',
        'Por 100 gramas\t700\t167\t5,0\t1,5\t20,0\t3,0\t9,0\t1,0',
        'Sande Atum',
        'Sande Frango',
        // Only 2 names but 3 data rows — third data row should be dropped
      ];
      const result = preprocessChainText('pans-and-company-es', lines);
      const dishLines = result.slice(1);
      expect(dishLines.length).toBe(2);
    });

    it('drops extra names when more names than data', () => {
      const lines = [
        'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
        'Sande Atum',
        'Sande Frango',
        'Sande Presunto',
        // Only 1 data row but 3 names — extra names should be dropped
      ];
      const result = preprocessChainText('pans-and-company-es', lines);
      const dishLines = result.slice(1);
      expect(dishLines.length).toBe(1);
      expect(dishLines[0]).toMatch(/^Sande Atum/);
    });
  });

  describe('isAllCaps helper — accent-aware', () => {
    it('treats accented uppercase lines as ALL-CAPS (filtered)', () => {
      const lines = [
        'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
        'PÃO CANTABRICO',
        'Sande Frango',
      ];
      const result = preprocessChainText('pans-and-company-es', lines);
      expect(result.some((l) => l.includes('PÃO CANTABRICO'))).toBe(false);
      const frango = result.find((l) => l.startsWith('Sande Frango'));
      expect(frango).toBeDefined();
    });

    it('treats mixed-case product names as valid (not filtered)', () => {
      const lines = [
        'Por 100 gramas\t800\t191\t6,8\t2,1\t23,5\t4,1\t10,4\t1,3',
        'Portuguesa', // single word — mixed case
      ];
      const result = preprocessChainText('pans-and-company-es', lines);
      const port = result.find((l) => l.startsWith('Portuguesa'));
      expect(port).toBeDefined();
    });
  });
});
