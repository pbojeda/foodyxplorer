// HTML-to-text extractor for the URL ingestion pipeline.
//
// extractTextFromHtml(html) parses an HTML string with node-html-parser,
// strips noise elements (script, style, nav, footer, header, aside, noscript),
// emits <tr> rows as tab-separated cell text, and emits block-level elements
// one per line. Returns a flat string[] compatible with parseNutritionTable.
//
// Comma decimal separators (e.g. "1,5") are normalized to dots ("1.5").

import { parse } from 'node-html-parser';
import type { HTMLElement as NhpHTMLElement } from 'node-html-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOISE_TAGS = new Set([
  'script', 'style', 'noscript',
  'nav', 'footer', 'header', 'aside',
]);

const BLOCK_TAGS = new Set([
  'p', 'div', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article',
]);

// ---------------------------------------------------------------------------
// Comma-to-dot normalisation
// ---------------------------------------------------------------------------

/**
 * Normalizes comma decimal separators within numeric tokens.
 * "1,5" → "1.5", "32,5" → "32.5". Does not affect plain text.
 */
function normalizeCommas(line: string): string {
  return line.replace(/\b(\d+),(\d+)\b/g, '$1.$2');
}

// ---------------------------------------------------------------------------
// Core extractor
// ---------------------------------------------------------------------------

/**
 * Extracts visible text lines from an HTML string.
 *
 * Rules:
 * 1. Parse with node-html-parser (lowerCaseTagName: true).
 * 2. Remove all NOISE_TAGS nodes before traversal.
 * 3. For each <table>: collect all <tr> rows; per row join <td>/<th> cell
 *    text with '\t'; emit each non-empty row as a line.
 * 4. For non-table block-level elements: emit innerText as individual lines.
 * 5. Processing preserves document order (tables relative to blocks).
 * 6. Comma decimal normalization applied to each emitted line.
 * 7. Whitespace-only lines are stripped.
 *
 * @param html - Raw HTML string (typically page outerHTML from Playwright)
 * @returns Array of text lines ready for parseNutritionTable()
 */
export function extractTextFromHtml(html: string): string[] {
  const root = parse(html, { lowerCaseTagName: true });

  // Step 1: Remove noise elements in-place (modifies the parsed tree)
  for (const tag of NOISE_TAGS) {
    for (const node of root.querySelectorAll(tag)) {
      node.remove();
    }
  }

  const lines: string[] = [];

  // Step 2: Walk root children in document order.
  // For subtrees containing <table>, extract table rows.
  // For block-level elements outside tables, extract text.
  processNode(root, lines);

  // Step 3: Strip empty/whitespace-only lines
  return lines.filter((l) => l.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Recursive document-order traversal
// ---------------------------------------------------------------------------

function processNode(node: NhpHTMLElement, lines: string[]): void {
  const tagName = node.tagName?.toLowerCase() ?? '';

  if (tagName === 'table') {
    // Emit all <tr> rows in this table
    extractTableRows(node, lines);
    return; // Do not recurse further — table rows handle their own children
  }

  if (BLOCK_TAGS.has(tagName)) {
    // Block element that is NOT inside a table: emit its full innerText
    // (but only if it does not contain any nested table — in that case we
    // recurse to preserve table row granularity)
    if (node.querySelectorAll('table').length === 0) {
      const text = node.innerText.trim();
      if (text.length > 0) {
        lines.push(normalizeCommas(text));
      }
      return;
    }
    // Contains a nested table — recurse to preserve document order
  }

  // Recurse into children for container elements (body, main, section, etc.)
  for (const child of node.childNodes) {
    if ('tagName' in child) {
      processNode(child as NhpHTMLElement, lines);
    }
  }
}

// ---------------------------------------------------------------------------
// Table row extraction
// ---------------------------------------------------------------------------

function extractTableRows(table: NhpHTMLElement, lines: string[]): void {
  const rows = table.querySelectorAll('tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td, th');
    const cellTexts = cells.map((cell) => cell.innerText.trim());
    const joined = cellTexts.join('\t');
    if (joined.trim().length > 0) {
      lines.push(normalizeCommas(joined));
    }
  }
}
