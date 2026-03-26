// F034 — Unit tests for analyzeMenu in analyze/menuAnalyzer.ts
//
// All external dependencies are mocked:
//   - extractTextFromImage (Tesseract OCR)
//   - extractText (pdf-parse wrapper)
//   - callVisionCompletion (OpenAI Vision)
//   - runEstimationCascade (engine router)
//
// Tests cover all mode-routing branches, fallback logic, partial results,
// signal abort, and error conditions.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EngineRouterResult } from '../estimation/engineRouter.js';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const { mockExtractTextFromImage } = vi.hoisted(() => ({
  mockExtractTextFromImage: vi.fn(),
}));

vi.mock('../lib/imageOcrExtractor.js', () => ({
  extractTextFromImage: mockExtractTextFromImage,
}));

const { mockExtractText } = vi.hoisted(() => ({
  mockExtractText: vi.fn(),
}));

vi.mock('../lib/pdfParser.js', () => ({
  extractText: mockExtractText,
}));

const { mockCallVisionCompletion } = vi.hoisted(() => ({
  mockCallVisionCompletion: vi.fn(),
}));

vi.mock('../lib/openaiClient.js', () => ({
  callVisionCompletion: mockCallVisionCompletion,
  callChatCompletion: vi.fn(),
  callOpenAIEmbeddingsOnce: vi.fn(),
  getOpenAIClient: vi.fn(),
  isRetryableError: vi.fn(),
  sleep: vi.fn(),
}));

const { mockRunEstimationCascade } = vi.hoisted(() => ({
  mockRunEstimationCascade: vi.fn(),
}));

vi.mock('../estimation/engineRouter.js', () => ({
  runEstimationCascade: mockRunEstimationCascade,
}));

import { analyzeMenu } from '../analyze/menuAnalyzer.js';
import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockDb = {} as Kysely<DB>;
const mockLogger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

// JPEG magic bytes buffer
function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

// PNG magic bytes buffer
function makePngBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  return buf;
}

// WebP magic bytes buffer
function makeWebpBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x52; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x46;
  buf[8] = 0x57; buf[9] = 0x45; buf[10] = 0x42; buf[11] = 0x50;
  return buf;
}

// PDF magic bytes buffer
function makePdfBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46; // %PDF
  return buf;
}

// Unknown file buffer
function makeUnknownBuffer(): Buffer {
  return Buffer.from([0x00, 0x01, 0x02, 0x03]);
}

/** A non-null cascade result for a dish */
function makeCascadeResult(dishName: string): EngineRouterResult {
  return {
    levelHit: 1,
    data: {
      query: dishName,
      chainSlug: null,
      level1Hit: true,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: 'exact_dish',
      result: null,
      cachedAt: null,
    },
  };
}

/** A total-miss cascade result */
function makeMissCascadeResult(dishName: string): EngineRouterResult {
  return {
    levelHit: null,
    data: {
      query: dishName,
      chainSlug: null,
      level1Hit: false,
      level2Hit: false,
      level3Hit: false,
      level4Hit: false,
      matchType: null,
      result: null,
      cachedAt: null,
    },
  };
}

/** Create a non-aborted AbortSignal */
function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // File type detection — unknown type
  // ---------------------------------------------------------------------------

  it('throws INVALID_IMAGE for unknown file magic bytes', async () => {
    await expect(
      analyzeMenu({
        fileBuffer: makeUnknownBuffer(),
        mode: 'ocr',
        db: mockDb,
        openAiApiKey: 'key',
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  // ---------------------------------------------------------------------------
  // OCR mode — image buffer
  // ---------------------------------------------------------------------------

  it('mode=ocr + image: calls extractTextFromImage → parseDishNames → cascade', async () => {
    mockExtractTextFromImage.mockResolvedValue(['Burger King', 'Whopper', 'Fries']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Burger King'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'ocr',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockExtractTextFromImage).toHaveBeenCalledOnce();
    expect(mockRunEstimationCascade).toHaveBeenCalledTimes(3);
    expect(result.mode).toBe('ocr');
    expect(result.dishes).toHaveLength(3);
    expect(result.partial).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // OCR mode — PDF buffer
  // ---------------------------------------------------------------------------

  it('mode=ocr + PDF: calls extractText → splits pages → parseDishNames → cascade', async () => {
    mockExtractText.mockResolvedValue(['Burger\nWhopper\nFries', 'Desserts\nApple Pie']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Burger'));

    const result = await analyzeMenu({
      fileBuffer: makePdfBuffer(),
      mode: 'ocr',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockExtractText).toHaveBeenCalledOnce();
    expect(mockExtractTextFromImage).not.toHaveBeenCalled();
    expect(result.mode).toBe('ocr');
    // Lines: Burger, Whopper, Fries, Desserts, Apple Pie → all valid names
    expect(result.dishes.length).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // Vision mode — image buffer
  // ---------------------------------------------------------------------------

  it('mode=vision + image: calls callVisionCompletion with menu prompt → parses JSON → cascade', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Big Mac", "Filet-O-Fish", "McFlurry"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Big Mac'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockCallVisionCompletion).toHaveBeenCalledOnce();
    // Verify maxTokens=2048 was passed
    const callArgs = mockCallVisionCompletion.mock.calls[0] as unknown[];
    expect(callArgs[5]).toBe(2048);
    expect(result.mode).toBe('vision');
    expect(result.dishes).toHaveLength(3);
  });

  it('mode=vision + image: strips markdown code blocks from Vision response', async () => {
    mockCallVisionCompletion.mockResolvedValue('```json\n["Pasta", "Pizza"]\n```');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Pasta'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(2);
  });

  it('mode=vision + image: falls back to OCR when Vision returns null', async () => {
    mockCallVisionCompletion.mockResolvedValue(null);
    mockExtractTextFromImage.mockResolvedValue(['Tortilla', 'Patatas bravas', 'Croquetas']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Tortilla'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockExtractTextFromImage).toHaveBeenCalledOnce();
    expect(result.dishes).toHaveLength(3);
  });

  it('mode=vision + PDF: throws INVALID_IMAGE (no PDF-to-image conversion)', async () => {
    await expect(
      analyzeMenu({
        fileBuffer: makePdfBuffer(),
        mode: 'vision',
        db: mockDb,
        openAiApiKey: 'key',
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  // ---------------------------------------------------------------------------
  // Identify mode — image buffer
  // ---------------------------------------------------------------------------

  it('mode=identify + image: calls callVisionCompletion with dish-ID prompt → returns exactly 1 dish', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Tortilla española"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Tortilla española'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'identify',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.mode).toBe('identify');
    expect(result.dishes).toHaveLength(1);
    expect(result.dishes[0]?.dishName).toBe('Tortilla española');
  });

  it('mode=identify + image: when Vision returns multiple candidates, uses first only', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Burger", "Sandwich", "Wrap"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Burger'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'identify',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(1);
    expect(result.dishes[0]?.dishName).toBe('Burger');
  });

  it('mode=identify + image: throws MENU_ANALYSIS_FAILED when Vision returns null (no OCR fallback)', async () => {
    mockCallVisionCompletion.mockResolvedValue(null);

    await expect(
      analyzeMenu({
        fileBuffer: makeJpegBuffer(),
        mode: 'identify',
        db: mockDb,
        openAiApiKey: 'key',
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'MENU_ANALYSIS_FAILED' });

    // Verify no OCR fallback attempted
    expect(mockExtractTextFromImage).not.toHaveBeenCalled();
  });

  it('mode=identify + PDF: throws INVALID_IMAGE', async () => {
    await expect(
      analyzeMenu({
        fileBuffer: makePdfBuffer(),
        mode: 'identify',
        db: mockDb,
        openAiApiKey: 'key',
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  // ---------------------------------------------------------------------------
  // Auto mode
  // ---------------------------------------------------------------------------

  it('mode=auto + PDF: routes to OCR pipeline', async () => {
    mockExtractText.mockResolvedValue(['Pizza Margherita\nCalzone\nLasagna']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Pizza Margherita'));

    const result = await analyzeMenu({
      fileBuffer: makePdfBuffer(),
      mode: 'auto',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockExtractText).toHaveBeenCalledOnce();
    expect(mockCallVisionCompletion).not.toHaveBeenCalled();
    expect(result.mode).toBe('auto');
  });

  it('mode=auto + image + openAiApiKey present: routes to Vision pipeline', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Sushi Roll", "Miso Soup"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Sushi Roll'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'auto',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockCallVisionCompletion).toHaveBeenCalledOnce();
    expect(result.mode).toBe('auto');
  });

  it('mode=auto + image + openAiApiKey absent: throws VISION_API_UNAVAILABLE', async () => {
    await expect(
      analyzeMenu({
        fileBuffer: makeJpegBuffer(),
        mode: 'auto',
        db: mockDb,
        openAiApiKey: undefined,
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'VISION_API_UNAVAILABLE' });
  });

  it('mode=auto + PDF + openAiApiKey absent: succeeds via OCR (no Vision needed)', async () => {
    mockExtractText.mockResolvedValue(['Salad\nSoup\nBread']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Salad'));

    const result = await analyzeMenu({
      fileBuffer: makePdfBuffer(),
      mode: 'auto',
      db: mockDb,
      openAiApiKey: undefined,
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Zero dish names
  // ---------------------------------------------------------------------------

  it('throws MENU_ANALYSIS_FAILED when extraction produces zero valid dish names', async () => {
    // OCR returns only filtered-out lines (numeric, short, etc.)
    mockExtractTextFromImage.mockResolvedValue(['123', '45', 'AB', '€€€']);

    await expect(
      analyzeMenu({
        fileBuffer: makeJpegBuffer(),
        mode: 'ocr',
        db: mockDb,
        openAiApiKey: 'key',
        level4Lookup: undefined,
        logger: mockLogger,
        signal: makeSignal(),
      })
    ).rejects.toMatchObject({ code: 'MENU_ANALYSIS_FAILED' });
  });

  // ---------------------------------------------------------------------------
  // All-null cascade results
  // ---------------------------------------------------------------------------

  it('returns dishes array with estimate: null for total-miss cascade (HTTP 200, no throw)', async () => {
    mockExtractTextFromImage.mockResolvedValue(['XYZ Exotic Dish']);
    mockRunEstimationCascade.mockResolvedValue(makeMissCascadeResult('XYZ Exotic Dish'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'ocr',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(1);
    expect(result.dishes[0]?.estimate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Partial results on abort
  // ---------------------------------------------------------------------------

  it('returns partial: true when AbortSignal is aborted mid-cascade loop', async () => {
    const ctrl = new AbortController();

    // OCR returns 3 dish names
    mockExtractTextFromImage.mockResolvedValue(['Dish A', 'Dish B', 'Dish C']);

    // Abort after first cascade call
    let callCount = 0;
    mockRunEstimationCascade.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        ctrl.abort(); // abort after first dish is processed
      }
      return makeCascadeResult('dish');
    });

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'ocr',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: ctrl.signal,
    });

    expect(result.partial).toBe(true);
    // Only 1 dish processed before abort check on 2nd iteration
    expect(result.dishes).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // PNG and WebP detection
  // ---------------------------------------------------------------------------

  it('detects PNG files correctly', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Burger"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Burger'));

    const result = await analyzeMenu({
      fileBuffer: makePngBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(1);
  });

  it('detects WebP files correctly', async () => {
    mockCallVisionCompletion.mockResolvedValue('["Taco"]');
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Taco'));

    const result = await analyzeMenu({
      fileBuffer: makeWebpBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Vision JSON parsing edge cases
  // ---------------------------------------------------------------------------

  it('mode=vision: handles empty JSON array from Vision → OCR fallback', async () => {
    mockCallVisionCompletion.mockResolvedValue('[]');
    mockExtractTextFromImage.mockResolvedValue(['Paella', 'Gazpacho']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Paella'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(mockExtractTextFromImage).toHaveBeenCalledOnce();
    expect(result.dishes).toHaveLength(2);
  });

  it('mode=vision: handles unparseable Vision response → OCR fallback', async () => {
    mockCallVisionCompletion.mockResolvedValue('not valid json {{{');
    mockExtractTextFromImage.mockResolvedValue(['Churros', 'Horchata']);
    mockRunEstimationCascade.mockResolvedValue(makeCascadeResult('Churros'));

    const result = await analyzeMenu({
      fileBuffer: makeJpegBuffer(),
      mode: 'vision',
      db: mockDb,
      openAiApiKey: 'key',
      level4Lookup: undefined,
      logger: mockLogger,
      signal: makeSignal(),
    });

    expect(result.dishes).toHaveLength(2);
  });
});
