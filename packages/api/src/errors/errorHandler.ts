// Global error handler for the Fastify application.
//
// registerErrorHandler(app) registers both the setErrorHandler and the
// setNotFoundHandler on the Fastify instance.
//
// mapError(error) is a pure function exported for unit testing. It converts
// any Error into { statusCode, body } following the project error envelope:
//
//   { success: false, error: { message, code, details? } }

import { ZodError } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorDetail {
  path: string[];
  message: string;
  code: string;
}

interface ErrorBody {
  success: false;
  error: {
    message: string;
    code: string;
    details?: ErrorDetail[];
  };
}

export interface MappedError {
  statusCode: number;
  body: ErrorBody;
}

// ---------------------------------------------------------------------------
// mapError — pure function used by the error handler and tests
// ---------------------------------------------------------------------------

/**
 * Maps any Error to a standard HTTP response envelope.
 *
 * | Input                          | statusCode | code               |
 * |--------------------------------|------------|--------------------|
 * | ZodError                       | 400        | VALIDATION_ERROR   |
 * | Error with code FST_ERR_VALIDATION | 400    | VALIDATION_ERROR   |
 * | Error with statusCode: 404     | 404        | NOT_FOUND          |
 * | Any other Error                | 500        | INTERNAL_ERROR     |
 */
export function mapError(error: Error): MappedError {
  // ZodError — rich validation details
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
            code: issue.code,
          })),
        },
      },
    };
  }

  // Fastify schema validation error / body parsing errors
  const asAny = error as unknown as Record<string, unknown>;

  // SyntaxError — malformed JSON body (BUG-AUDIT-C4)
  // Check both instanceof and statusCode+message since Fastify may wrap the error
  if (error instanceof SyntaxError || asAny['statusCode'] === 400 && error.message.includes('JSON')) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          message: 'Invalid JSON in request body',
          code: 'VALIDATION_ERROR',
        },
      },
    };
  }

  // FST_ERR_CTP_EMPTY_JSON_BODY — POST with no body (BUG-AUDIT-C4)
  if (asAny['code'] === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          message: 'Request body is required',
          code: 'VALIDATION_ERROR',
        },
      },
    };
  }

  if (asAny['code'] === 'FST_ERR_VALIDATION') {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'VALIDATION_ERROR',
        },
      },
    };
  }

  // DB_UNAVAILABLE — DB query failure (estimation, conversation, health, etc.)
  if (asAny['code'] === 'DB_UNAVAILABLE') {
    // Include the underlying cause in non-production for debugging.
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    return {
      statusCode: 500,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'DB_UNAVAILABLE',
          ...(cause && { cause }),
        },
      },
    };
  }

  // REDIS_UNAVAILABLE — health route Redis check failure
  if (asAny['code'] === 'REDIS_UNAVAILABLE') {
    return {
      statusCode: 500,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'REDIS_UNAVAILABLE',
        },
      },
    };
  }

  // VALIDATION_ERROR — explicit validation error (e.g. missing file part)
  if (asAny['code'] === 'VALIDATION_ERROR') {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'VALIDATION_ERROR',
        },
      },
    };
  }

  // CHAIN_NOT_FOUND — reverse-search chain slug not found (BUG-AUDIT-C1C3)
  if (asAny['code'] === 'CHAIN_NOT_FOUND') {
    return {
      statusCode: 404,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'CHAIN_NOT_FOUND',
        },
      },
    };
  }

  // NOT_FOUND — resource not found (e.g. restaurantId or sourceId not in DB)
  if (asAny['code'] === 'NOT_FOUND') {
    return {
      statusCode: 404,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'NOT_FOUND',
        },
      },
    };
  }

  // INVALID_IMAGE — downloaded file is not a valid image (magic bytes not JPEG/PNG)
  if (asAny['code'] === 'INVALID_IMAGE') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'INVALID_IMAGE',
        },
      },
    };
  }

  // OCR_FAILED — Tesseract.js threw an unrecoverable error during OCR
  if (asAny['code'] === 'OCR_FAILED') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'OCR_FAILED',
        },
      },
    };
  }

  // INVALID_PDF — file is not a valid PDF (magic bytes check failed)
  if (asAny['code'] === 'INVALID_PDF') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'INVALID_PDF',
        },
      },
    };
  }

  // UNSUPPORTED_PDF — PDF is image-based / no extractable text
  if (asAny['code'] === 'UNSUPPORTED_PDF') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'UNSUPPORTED_PDF',
        },
      },
    };
  }

  // NO_NUTRITIONAL_DATA_FOUND — no parseable nutritional table in PDF
  if (asAny['code'] === 'NO_NUTRITIONAL_DATA_FOUND') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'NO_NUTRITIONAL_DATA_FOUND',
        },
      },
    };
  }

  // INVALID_URL — URL scheme is not http/https or address is private/loopback (SSRF guard)
  if (asAny['code'] === 'INVALID_URL') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'INVALID_URL',
        },
      },
    };
  }

  // FETCH_FAILED — network error, DNS failure, or non-2xx HTTP response
  if (asAny['code'] === 'FETCH_FAILED') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'FETCH_FAILED',
        },
      },
    };
  }

  // EMBEDDING_PROVIDER_UNAVAILABLE — OPENAI_API_KEY is not configured
  if (asAny['code'] === 'EMBEDDING_PROVIDER_UNAVAILABLE') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'EMBEDDING_PROVIDER_UNAVAILABLE',
        },
      },
    };
  }

  // SCRAPER_BLOCKED — target server returned HTTP 403 or 429 (anti-bot)
  if (asAny['code'] === 'SCRAPER_BLOCKED') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'SCRAPER_BLOCKED',
        },
      },
    };
  }

  // PROCESSING_TIMEOUT — processing exceeded time limit
  if (asAny['code'] === 'PROCESSING_TIMEOUT') {
    return {
      statusCode: 408,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'PROCESSING_TIMEOUT',
        },
      },
    };
  }

  // FST_REQ_FILE_TOO_LARGE — @fastify/multipart file size limit exceeded
  // Maps to 413 PAYLOAD_TOO_LARGE using our standard error envelope.
  // This also fixes a latent bug in POST /ingest/pdf where large uploads
  // would return a raw Fastify error instead of the standard envelope.
  if (asAny['code'] === 'FST_REQ_FILE_TOO_LARGE') {
    return {
      statusCode: 413,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'PAYLOAD_TOO_LARGE',
        },
      },
    };
  }

  // PAYLOAD_TOO_LARGE — response body exceeds size limit (e.g. PDF > 20 MB)
  if (asAny['code'] === 'PAYLOAD_TOO_LARGE') {
    return {
      statusCode: 413,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'PAYLOAD_TOO_LARGE',
        },
      },
    };
  }

  // UNAUTHORIZED — invalid or missing API key (F026)
  if (asAny['code'] === 'UNAUTHORIZED') {
    return {
      statusCode: 401,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'UNAUTHORIZED',
        },
      },
    };
  }

  // FORBIDDEN — valid key but access revoked (F026)
  if (asAny['code'] === 'FORBIDDEN') {
    return {
      statusCode: 403,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'FORBIDDEN',
        },
      },
    };
  }

  // EMPTY_TRANSCRIPTION — Whisper returned empty/whitespace or hallucination text (F075)
  if (asAny['code'] === 'EMPTY_TRANSCRIPTION') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'EMPTY_TRANSCRIPTION',
        },
      },
    };
  }

  // TRANSCRIPTION_FAILED — Whisper API upstream failure after retry (F075)
  if (asAny['code'] === 'TRANSCRIPTION_FAILED') {
    return {
      statusCode: 502,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'TRANSCRIPTION_FAILED',
        },
      },
    };
  }

  // RECIPE_UNRESOLVABLE — zero ingredients resolved in POST /calculate/recipe (F035)
  if (asAny['code'] === 'RECIPE_UNRESOLVABLE') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'RECIPE_UNRESOLVABLE',
        },
      },
    };
  }

  // FREE_FORM_PARSE_FAILED — LLM could not parse free-form recipe text (F035)
  if (asAny['code'] === 'FREE_FORM_PARSE_FAILED') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'FREE_FORM_PARSE_FAILED',
        },
      },
    };
  }

  // MENU_ANALYSIS_FAILED — Vision API + OCR fallback both produced < 1 dish name (F034)
  if (asAny['code'] === 'MENU_ANALYSIS_FAILED') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'MENU_ANALYSIS_FAILED',
        },
      },
    };
  }

  // VISION_API_UNAVAILABLE — OPENAI_API_KEY not set and vision/identify/auto+image requested (F034)
  if (asAny['code'] === 'VISION_API_UNAVAILABLE') {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'VISION_API_UNAVAILABLE',
        },
      },
    };
  }

  // DUPLICATE_RESTAURANT — (chainSlug, countryCode) unique constraint violation (F032)
  if (asAny['code'] === 'DUPLICATE_RESTAURANT') {
    return {
      statusCode: 409,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'DUPLICATE_RESTAURANT',
        },
      },
    };
  }

  // DUPLICATE_EMAIL — email unique constraint violation in waitlist_submissions (F046)
  if (asAny['code'] === 'DUPLICATE_EMAIL') {
    return {
      statusCode: 409,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'DUPLICATE_EMAIL',
        },
      },
    };
  }

  // RATE_LIMIT_EXCEEDED — @fastify/rate-limit exceeded response
  if (asAny['code'] === 'RATE_LIMIT_EXCEEDED') {
    return {
      statusCode: 429,
      body: {
        success: false,
        error: {
          message: 'Too many requests, please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
      },
    };
  }

  // 404 — typically set by Fastify on unmatched routes or explicitly
  if (typeof asAny['statusCode'] === 'number' && asAny['statusCode'] === 404) {
    return {
      statusCode: 404,
      body: {
        success: false,
        error: {
          message: 'Route not found',
          code: 'NOT_FOUND',
        },
      },
    };
  }

  // Generic server error — never leak internal details to the client
  return {
    statusCode: 500,
    body: {
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// registerErrorHandler — registers handlers on the Fastify instance
// ---------------------------------------------------------------------------

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: Error, request: FastifyRequest, reply: FastifyReply) => {
      request.log.error({ err: error }, error.message);

      const { statusCode, body } = mapError(error);
      return reply.status(statusCode).send(body);
    },
  );

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send({
      success: false,
      error: {
        message: 'Route not found',
        code: 'NOT_FOUND',
      },
    });
  });
}
