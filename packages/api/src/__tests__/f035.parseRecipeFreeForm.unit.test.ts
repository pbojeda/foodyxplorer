// F035 — Unit tests for parseRecipeFreeForm.ts
//
// Tests:
//   - Returns null when openAiApiKey is undefined
//   - Returns parsed array on valid LLM response
//   - Returns null on malformed JSON from LLM
//   - Returns null on LLM validation failure (> 50 items, grams = 0, etc.)
//   - Returns null when LLM returns null (call failed)
//   - Returns null when LLM returns 0 ingredients
//
// Mocks:
//   - callChatCompletion from openaiClient

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/openaiClient.js', () => ({
  callChatCompletion: vi.fn(),
}));

import { callChatCompletion } from '../lib/openaiClient.js';
import { parseRecipeFreeForm } from '../calculation/parseRecipeFreeForm.js';

const API_KEY = 'test-key';

describe('parseRecipeFreeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null immediately when openAiApiKey is undefined', async () => {
    const result = await parseRecipeFreeForm('200g de pollo', undefined);

    expect(callChatCompletion).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns parsed ingredient array on valid LLM response', async () => {
    const llmOutput = JSON.stringify([
      { name: 'pechuga de pollo', grams: 200, portionMultiplier: 1.0 },
      { name: 'arroz blanco', grams: 100 },
    ]);
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(llmOutput);

    const result = await parseRecipeFreeForm('200g de pollo y 100g de arroz', API_KEY);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result?.[0]?.name).toBe('pechuga de pollo');
    expect(result?.[0]?.grams).toBe(200);
    expect(result?.[0]?.portionMultiplier).toBe(1.0);
    expect(result?.[1]?.name).toBe('arroz blanco');
    expect(result?.[1]?.portionMultiplier).toBe(1.0); // defaulted
  });

  it('returns null when LLM call fails (callChatCompletion returns null)', async () => {
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).toBeNull();
  });

  it('returns null on malformed JSON from LLM', async () => {
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not valid json {{{');

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).toBeNull();
  });

  it('returns null when LLM returns JSON that is not an array', async () => {
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('{"name":"pollo","grams":200}');

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).toBeNull();
  });

  it('returns null when LLM returns empty array (0 ingredients)', async () => {
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce('[]');

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).toBeNull();
  });

  it('returns null when LLM returns > 50 ingredients', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `food${i}`, grams: 10 }));
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(tooMany));

    const result = await parseRecipeFreeForm('a very large recipe', API_KEY);

    expect(result).toBeNull();
  });

  it('returns null when LLM returns ingredients with invalid grams (0)', async () => {
    // An item with grams = 0 fails ParsedIngredientSchema → entire output invalid
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify([{ name: 'pollo', grams: 0 }]),
    );

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).toBeNull();
  });

  it('strips markdown code fences before JSON parsing', async () => {
    const withFences = '```json\n[{"name":"pollo","grams":200}]\n```';
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(withFences);

    const result = await parseRecipeFreeForm('pollo', API_KEY);

    expect(result).not.toBeNull();
    expect(result?.[0]?.name).toBe('pollo');
  });

  it('passes text and API key to callChatCompletion', async () => {
    (callChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify([{ name: 'arroz', grams: 100 }]),
    );

    await parseRecipeFreeForm('100g de arroz', API_KEY);

    expect(callChatCompletion).toHaveBeenCalledWith(
      API_KEY,
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('100g de arroz') }),
      ]),
      undefined,
    );
  });
});
