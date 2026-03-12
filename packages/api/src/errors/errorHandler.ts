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
