// parseRecipeFreeForm — LLM-based recipe text parser (F035).
//
// Converts free-form recipe text (Spanish or English) into a structured array
// of { name, grams, portionMultiplier } items.
//
// The LLM is ONLY used to interpret text into structured tuples.
// Nutritional calculation is NEVER delegated to the LLM (ADR-001).
//
// Returns:
//   - ParsedIngredient[] on success (1–50 items, validated with LlmParseOutputSchema)
//   - null on any failure (no API key, call failed, parse error, validation failure)
//     → caller maps null to FREE_FORM_PARSE_FAILED

import { LlmParseOutputSchema, type ParsedIngredient } from '@foodxplorer/shared';
import { callChatCompletion, type OpenAILogger } from '../lib/openaiClient.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a recipe parsing assistant. Your job is to extract ingredient names and gram weights from recipe descriptions. ' +
  'Do not provide nutritional values. Output ONLY valid JSON — no other text, no markdown fences.';

function buildUserPrompt(text: string): string {
  return (
    `Parse the following recipe description and extract all ingredients with gram weights.\n\n` +
    `Recipe text: "${text}"\n\n` +
    `Reply with a JSON array of objects. Each object must have:\n` +
    `  - "name": string — generic ingredient name (e.g., "pollo" not "pollo ecológico de corral")\n` +
    `  - "grams": number — positive weight in grams\n` +
    `  - "portionMultiplier": number (optional, 0.1–5.0) — only include if the recipe explicitly mentions a size modifier (e.g., "ración pequeña"→0.7, "ración grande"→1.3)\n\n` +
    `Example output: [{"name":"pechuga de pollo","grams":200},{"name":"arroz blanco","grams":100}]\n\n` +
    `Important: output ONLY the JSON array, no explanations, no markdown.`
  );
}

// ---------------------------------------------------------------------------
// parseRecipeFreeForm
// ---------------------------------------------------------------------------

/**
 * Parse a free-form recipe text into a structured ingredient list.
 *
 * @param text        - Free-form recipe description in any language
 * @param openAiApiKey - OpenAI API key (undefined → return null immediately)
 * @param logger      - Optional logger for debug/warn
 * @returns ParsedIngredient[] or null on any failure
 */
export async function parseRecipeFreeForm(
  text: string,
  openAiApiKey: string | undefined,
  logger?: OpenAILogger,
  signal?: AbortSignal,
): Promise<ParsedIngredient[] | null> {
  // Guard: LLM required for free-form mode
  if (openAiApiKey === undefined) {
    return null;
  }

  // Guard: abort before making expensive LLM call
  if (signal?.aborted) {
    return null;
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(text) },
  ];

  const rawResponse = await callChatCompletion(openAiApiKey, messages, logger);
  if (rawResponse === null) {
    return null;
  }

  // Strip markdown code fences (LLMs sometimes add them despite the prompt)
  const cleaned = rawResponse
    .replace(/```json\n?/g, '')
    .replace(/```/g, '')
    .trim();

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger?.warn({ response: cleaned }, 'parseRecipeFreeForm: malformed JSON from LLM');
    return null;
  }

  // Validate with LlmParseOutputSchema (1–50 items)
  const validationResult = LlmParseOutputSchema.safeParse(parsed);
  if (!validationResult.success) {
    logger?.warn({ error: validationResult.error.message }, 'parseRecipeFreeForm: LLM output failed schema validation');
    return null;
  }

  return validationResult.data;
}
