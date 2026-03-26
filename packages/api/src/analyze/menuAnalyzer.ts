// menuAnalyzer — Core orchestration service for POST /analyze/menu (F034).
//
// analyzeMenu(opts) → MenuAnalysisResult
//
// Pipeline:
//   1. Detect file type via magic bytes (JPEG/PNG/WebP/PDF → throws INVALID_IMAGE otherwise)
//   2. Route to extraction pipeline based on mode:
//      - ocr:      PDF → extractText; image → extractTextFromImage
//      - vision:   image only → callVisionCompletion; PDF → INVALID_IMAGE
//      - identify: image only → callVisionCompletion (single-dish prompt); PDF → INVALID_IMAGE
//      - auto:     PDF → OCR; image + key → Vision; image + no key → VISION_API_UNAVAILABLE
//   3. Parse dish names via parseDishNames (OCR) or JSON parse (Vision)
//   4. Run runEstimationCascade per dish name, checking signal.aborted between iterations
//   5. Return { dishes, partial, mode }
//
// ADR-001 compliance: Vision API identifies dish names only. All nutrient
// computation is delegated to runEstimationCascade.

import type { Kysely } from 'kysely';
import type { DB } from '../generated/kysely-types.js';
import type { AnalyzeMenuMode, MenuAnalysisDish } from '@foodxplorer/shared';
import type { Level4LookupFn } from '../estimation/engineRouter.js';
import type { OpenAILogger } from '../lib/openaiClient.js';
import { extractTextFromImage } from '../lib/imageOcrExtractor.js';
import { extractText } from '../lib/pdfParser.js';
import { callVisionCompletion } from '../lib/openaiClient.js';
import { runEstimationCascade } from '../estimation/engineRouter.js';
import { parseDishNames } from './dishNameParser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VISION_MAX_TOKENS = 2048;

const MENU_EXTRACTION_PROMPT =
  'List all dish names visible in this restaurant menu. ' +
  'Return a JSON array of strings, one dish name per element. ' +
  'Return only the array, no other text.';

const DISH_IDENTIFICATION_PROMPT =
  'Identify the single dish or plate of food shown in this photo. ' +
  'Return a JSON array with exactly one string element containing the dish name.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MenuAnalyzerOptions {
  fileBuffer: Buffer;
  mode: AnalyzeMenuMode;
  db: Kysely<DB>;
  openAiApiKey: string | undefined;
  level4Lookup: Level4LookupFn | undefined;
  logger: OpenAILogger;
  signal: AbortSignal;
}

export interface MenuAnalysisResult {
  dishes: MenuAnalysisDish[];
  partial: boolean;
  mode: AnalyzeMenuMode;
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

type DetectedFileType = 'jpeg' | 'png' | 'webp' | 'pdf';

/**
 * Detects file type from buffer magic bytes.
 *
 * @throws Error with code INVALID_IMAGE if the magic bytes are unknown.
 */
export function detectFileType(buffer: Buffer): DetectedFileType {
  if (buffer.length < 4) {
    throw Object.assign(
      new Error('File is too small to be a valid image or PDF'),
      { statusCode: 422, code: 'INVALID_IMAGE' },
    );
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }

  // WebP: RIFF at [0..3] + WEBP at [8..11] — requires at least 12 bytes
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'webp';
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }

  throw Object.assign(
    new Error('Unsupported file type — must be JPEG, PNG, WebP, or PDF'),
    { statusCode: 422, code: 'INVALID_IMAGE' },
  );
}

// ---------------------------------------------------------------------------
// stripMarkdownJson — remove ```json or ``` markers from LLM response
// ---------------------------------------------------------------------------

export function stripMarkdownJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');
}

// ---------------------------------------------------------------------------
// parseVisionJsonArray — parse JSON array from Vision response string
// ---------------------------------------------------------------------------

function parseVisionJsonArray(raw: string): string[] {
  try {
    const stripped = stripMarkdownJson(raw);
    const parsed: unknown = JSON.parse(stripped);
    if (!Array.isArray(parsed)) return [];
    // Filter to non-empty strings only
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// extractDishNamesFromImage — call Vision API with given prompt
// ---------------------------------------------------------------------------

async function extractDishNamesFromImage(
  fileBuffer: Buffer,
  fileType: DetectedFileType,
  prompt: string,
  openAiApiKey: string,
  logger: OpenAILogger,
): Promise<string[] | null> {
  const mimeTypeMap: Record<DetectedFileType, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  const mimeType = mimeTypeMap[fileType];
  const imageBase64 = fileBuffer.toString('base64');

  const raw = await callVisionCompletion(
    openAiApiKey,
    imageBase64,
    mimeType,
    prompt,
    logger,
    VISION_MAX_TOKENS,
  );

  if (raw === null) return null;

  const names = parseVisionJsonArray(raw);
  return names.length > 0 ? names : null;
}

// ---------------------------------------------------------------------------
// extractDishNames — routes to appropriate extraction pipeline
// ---------------------------------------------------------------------------

async function extractDishNames(
  fileBuffer: Buffer,
  fileType: DetectedFileType,
  mode: AnalyzeMenuMode,
  openAiApiKey: string | undefined,
  logger: OpenAILogger,
): Promise<string[]> {
  // --- OCR pipeline ---
  if (mode === 'ocr') {
    if (fileType === 'pdf') {
      const pages = await extractText(fileBuffer);
      const lines = pages.flatMap((page) => page.split('\n'));
      return parseDishNames(lines);
    } else {
      // JPEG, PNG, WebP → Tesseract
      const lines = await extractTextFromImage(fileBuffer);
      return parseDishNames(lines);
    }
  }

  // --- Vision and Identify pipelines — images only ---
  if (mode === 'vision' || mode === 'identify') {
    if (fileType === 'pdf') {
      throw Object.assign(
        new Error('PDF files are not supported in vision/identify mode — use ocr or auto mode'),
        { statusCode: 422, code: 'INVALID_IMAGE' },
      );
    }

    if (!openAiApiKey) {
      throw Object.assign(
        new Error('OPENAI_API_KEY is not configured — Vision API unavailable'),
        { statusCode: 422, code: 'VISION_API_UNAVAILABLE' },
      );
    }

    const prompt = mode === 'identify' ? DISH_IDENTIFICATION_PROMPT : MENU_EXTRACTION_PROMPT;
    const names = await extractDishNamesFromImage(fileBuffer, fileType, prompt, openAiApiKey, logger);

    if (names === null || names.length === 0) {
      if (mode === 'identify') {
        // No OCR fallback for identify mode
        throw Object.assign(
          new Error('Vision API failed to identify a dish in this photo'),
          { statusCode: 422, code: 'MENU_ANALYSIS_FAILED' },
        );
      }
      // vision mode → OCR fallback
      logger.warn({}, 'Vision API returned no dish names — falling back to OCR');
      const ocrLines = await extractTextFromImage(fileBuffer);
      return parseDishNames(ocrLines);
    }

    if (mode === 'identify') {
      // Return only the first candidate (names is non-empty at this point — checked above)
      const firstDish = names[0];
      if (firstDish === undefined) {
        throw Object.assign(
          new Error('Vision API returned no dish names'),
          { statusCode: 422, code: 'MENU_ANALYSIS_FAILED' },
        );
      }
      return [firstDish];
    }

    return names;
  }

  // --- Auto mode ---
  if (mode === 'auto') {
    if (fileType === 'pdf') {
      // PDF → OCR pipeline (no Vision needed)
      const pages = await extractText(fileBuffer);
      const lines = pages.flatMap((page) => page.split('\n'));
      return parseDishNames(lines);
    } else {
      // Image → Vision pipeline (requires OpenAI key)
      if (!openAiApiKey) {
        throw Object.assign(
          new Error('OPENAI_API_KEY is not configured — Vision API unavailable for image analysis'),
          { statusCode: 422, code: 'VISION_API_UNAVAILABLE' },
        );
      }

      const names = await extractDishNamesFromImage(
        fileBuffer,
        fileType,
        MENU_EXTRACTION_PROMPT,
        openAiApiKey,
        logger,
      );

      if (names === null || names.length === 0) {
        // Vision fallback → OCR
        logger.warn({}, 'Vision API returned no dish names in auto mode — falling back to OCR');
        const ocrLines = await extractTextFromImage(fileBuffer);
        return parseDishNames(ocrLines);
      }

      return names;
    }
  }

  // Should never reach here — mode is typed
  throw Object.assign(
    new Error('Unknown analysis mode'),
    { statusCode: 400, code: 'VALIDATION_ERROR' },
  );
}

// ---------------------------------------------------------------------------
// analyzeMenu — main orchestration entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full menu analysis pipeline.
 *
 * File-type validation via magic bytes is performed first.
 * Extraction delegates to OCR or Vision based on mode.
 * Per-dish cascade is cooperative: checks signal.aborted between iterations.
 *
 * @returns MenuAnalysisResult with dishes, partial flag, and echoed mode.
 * @throws Error with INVALID_IMAGE, VISION_API_UNAVAILABLE, or MENU_ANALYSIS_FAILED codes.
 */
export async function analyzeMenu(opts: MenuAnalyzerOptions): Promise<MenuAnalysisResult> {
  const { fileBuffer, mode, db, openAiApiKey, level4Lookup, logger, signal } = opts;

  // Step 1: Detect file type
  const fileType = detectFileType(fileBuffer);

  // Step 2: Extract dish names
  const dishNames = await extractDishNames(fileBuffer, fileType, mode, openAiApiKey, logger);

  // Step 3: Validate — need at least 1 dish name after parsing/filtering
  if (dishNames.length === 0) {
    throw Object.assign(
      new Error('No dish names could be extracted from the provided file'),
      { statusCode: 422, code: 'MENU_ANALYSIS_FAILED' },
    );
  }

  // Step 4: Run cascade per dish name (cooperative abort check)
  const processedDishes: MenuAnalysisDish[] = [];

  for (const dishName of dishNames) {
    // Check abort before each cascade call
    if (signal.aborted) {
      return { dishes: processedDishes, partial: true, mode };
    }

    let estimate: MenuAnalysisDish['estimate'] = null;

    try {
      const cascadeResult = await runEstimationCascade({
        db,
        query: dishName,
        openAiApiKey,
        level4Lookup,
        logger,
      });
      // A total miss (result: null, all levels missed) → estimate stays null.
      // A successful match → store full EstimateData.
      estimate = cascadeResult.data.result !== null ? cascadeResult.data : null;
    } catch {
      // Cascade error for one dish → treat as null estimate, continue
      logger.warn({ dishName }, 'Cascade failed for dish — using null estimate');
    }

    processedDishes.push({ dishName, estimate });
  }

  return { dishes: processedDishes, partial: false, mode };
}
