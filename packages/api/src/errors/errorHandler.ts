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

  // Fastify schema validation error
  const asAny = error as unknown as Record<string, unknown>;
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

  // DB_UNAVAILABLE — health route DB check failure
  if (asAny['code'] === 'DB_UNAVAILABLE') {
    return {
      statusCode: 500,
      body: {
        success: false,
        error: {
          message: error.message,
          code: 'DB_UNAVAILABLE',
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
