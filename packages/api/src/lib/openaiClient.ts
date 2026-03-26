// Shared OpenAI client utilities — extracted from level4Lookup.ts (F035).
//
// Exports:
//   getOpenAIClient(apiKey)         — cached OpenAI client factory
//   isRetryableError(error)         — true for 429 or 5xx status codes
//   sleep(ms)                       — Promise.resolve after ms milliseconds
//   callChatCompletion(...)         — wraps OpenAI chat with 2-attempt retry
//   callOpenAIEmbeddingsOnce(...)   — single text embedding via OpenAI (for recipe resolveIngredient)
//
// Both resolveIngredient.ts (L4-A) and parseRecipeFreeForm.ts import from here.
// level4Lookup.ts imports from here too (replaces its local copy).

import OpenAI from 'openai';
import { callOpenAIEmbeddings } from '../embeddings/embeddingClient.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 2 total attempts: 1 initial + 1 retry (loop runs twice). */
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1_000;

// ---------------------------------------------------------------------------
// Logger type (compatible with Fastify logger and estimation engine logger)
// ---------------------------------------------------------------------------

export type OpenAILogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  debug: (obj: Record<string, unknown>, msg?: string) => void;
};

// ---------------------------------------------------------------------------
// OpenAI client caching
// ---------------------------------------------------------------------------

let cachedOpenAIClient: OpenAI | undefined;
let cachedOpenAIKey: string | undefined;

export function getOpenAIClient(apiKey: string): OpenAI {
  if (cachedOpenAIClient && cachedOpenAIKey === apiKey) return cachedOpenAIClient;
  cachedOpenAIClient = new OpenAI({ apiKey });
  cachedOpenAIKey = apiKey;
  return cachedOpenAIClient;
}

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

export function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const status = (error as Record<string, unknown>)['status'];
    if (typeof status === 'number') {
      return status === 429 || status >= 500;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// callChatCompletion — wraps OpenAI chat with 2-attempt retry.
//
// Returns the message content string or null on failure.
// Catches ALL OpenAI errors internally — never propagates them.
// Logs token usage via logger?.info after success.
// Logs errors via logger?.warn after exhausting retries.
// ---------------------------------------------------------------------------

export async function callChatCompletion(
  apiKey: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  logger?: OpenAILogger,
  chatModel?: string,
  maxTokens?: number,
  logLabel?: string,
): Promise<string | null> {
  const client = getOpenAIClient(apiKey);
  const model = chatModel ?? 'gpt-4o-mini';

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      });

      const content = response.choices[0]?.message?.content ?? null;
      if (content === null) return null;

      // Log token usage after successful call
      if (response.usage) {
        logger?.info(
          {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            model,
          },
          logLabel ?? 'OpenAI chat call',
        );
      }

      return content;
    } catch (error) {
      if (!isRetryableError(error)) {
        // Non-retryable (e.g. 400) — log and return null immediately (no retry)
        logger?.warn({ error }, 'OpenAI chat call failed');
        return null;
      }

      lastError = error;

      // Retryable (429/5xx) — backoff before retry
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  // Exhausted retries
  logger?.warn({ error: lastError }, 'OpenAI chat call failed');
  return null;
}

// ---------------------------------------------------------------------------
// callOpenAIEmbeddingsOnce — generate embedding for a single text string.
//
// Wraps callOpenAIEmbeddings (batch API) for single-text convenience.
// Returns number[] or null on any failure (graceful skip).
// ---------------------------------------------------------------------------

export async function callOpenAIEmbeddingsOnce(
  text: string,
  apiKey: string,
  logger?: OpenAILogger,
): Promise<number[] | null> {
  try {
    const embeddings = await callOpenAIEmbeddings([text], {
      apiKey,
      model: 'text-embedding-3-small',
      rpm: 500,
    });
    const embedding = embeddings[0];
    if (embedding === undefined) return null;
    if (!embedding.every(Number.isFinite)) return null;
    return embedding;
  } catch {
    logger?.warn({}, 'callOpenAIEmbeddingsOnce failed');
    return null;
  }
}
