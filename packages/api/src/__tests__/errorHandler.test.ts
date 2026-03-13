// Unit tests for errors/errorHandler.ts — mapError pure function
//
// Tests each error branch in isolation without Fastify internals.
// The mapError function converts an Error to { statusCode, body }.

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { mapError } from '../errors/errorHandler.js';

// Helper type to create Fastify-like validation errors
interface FastifyValidationError extends Error {
  code: string;
  statusCode?: number;
  validation?: unknown;
}

function makeFstValidationError(message: string): FastifyValidationError {
  const err = new Error(message) as FastifyValidationError;
  err.code = 'FST_ERR_VALIDATION';
  err.statusCode = 400;
  return err;
}

describe('mapError', () => {
  describe('ZodError', () => {
    it('maps to 400 with VALIDATION_ERROR code and details array', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['name'],
          message: 'Expected string, received number',
        },
      ]);

      const result = mapError(zodError);

      expect(result.statusCode).toBe(400);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.message).toBe('Validation failed');
      expect(result.body.error.details).toBeDefined();
      expect(result.body.error.details).toHaveLength(1);

      const detail = result.body.error.details?.[0];
      expect(detail?.path).toEqual(['name']);
      expect(detail?.message).toBe('Expected string, received number');
      expect(detail?.code).toBe('invalid_type');
    });

    it('maps multiple ZodError issues to multiple details', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['name'],
          message: 'Required',
        },
        {
          code: 'too_small',
          minimum: 1,
          type: 'number',
          inclusive: true,
          exact: false,
          path: ['age'],
          message: 'Number must be greater than or equal to 1',
        },
      ]);

      const result = mapError(zodError);

      expect(result.body.error.details).toHaveLength(2);
    });

    it('maps nested path (array of string and number) to array of strings', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['items', 0, 'name'],
          message: 'Expected string, received number',
        },
      ]);

      const result = mapError(zodError);

      const detail = result.body.error.details?.[0];
      expect(detail?.path).toEqual(['items', '0', 'name']);
    });
  });

  describe('FST_ERR_VALIDATION (Fastify validation error)', () => {
    it('maps to 400 with VALIDATION_ERROR code', () => {
      const err = makeFstValidationError('querystring must have required property db');

      const result = mapError(err);

      expect(result.statusCode).toBe(400);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not include details for FST_ERR_VALIDATION (no ZodError issues)', () => {
      const err = makeFstValidationError('validation failed');

      const result = mapError(err);

      // details may be present (empty) or absent — it must NOT be a populated array
      const details = result.body.error.details;
      expect(details === undefined || (Array.isArray(details) && details.length === 0)).toBe(true);
    });
  });

  describe('Generic Error', () => {
    it('maps to 500 with INTERNAL_ERROR code', () => {
      const err = new Error('something went wrong');

      const result = mapError(err);

      expect(result.statusCode).toBe(500);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
      expect(result.body.error.message).toBe('Internal server error');
    });

    it('does NOT include details on 500 errors (no internal info leaked)', () => {
      const err = new Error('sensitive database connection string here');

      const result = mapError(err);

      expect(result.body.error.details).toBeUndefined();
    });

    it('does NOT include the original error message on 500 (no info leakage)', () => {
      const err = new Error('sensitive message');

      const result = mapError(err);

      expect(result.body.error.message).not.toContain('sensitive message');
    });
  });

  describe('Error with statusCode: 404', () => {
    it('maps to 404 with NOT_FOUND code', () => {
      const err = Object.assign(new Error('not found'), { statusCode: 404 });

      const result = mapError(err);

      expect(result.statusCode).toBe(404);
      expect(result.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('REDIS_UNAVAILABLE', () => {
    it('maps to 500 with REDIS_UNAVAILABLE code and original message', () => {
      const err = Object.assign(
        new Error('Redis connectivity check failed'),
        { statusCode: 500, code: 'REDIS_UNAVAILABLE' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(500);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('REDIS_UNAVAILABLE');
      expect(result.body.error.message).toBe('Redis connectivity check failed');
    });

    it('passes through custom message from the error', () => {
      const err = Object.assign(
        new Error('Custom redis error message'),
        { statusCode: 500, code: 'REDIS_UNAVAILABLE' },
      );

      const result = mapError(err);

      expect(result.body.error.message).toBe('Custom redis error message');
    });
  });

  describe('VALIDATION_ERROR (custom code)', () => {
    it('maps to 400 with VALIDATION_ERROR code and original message', () => {
      const err = Object.assign(
        new Error('Missing file part in multipart request'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(400);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(result.body.error.message).toBe('Missing file part in multipart request');
    });
  });

  describe('NOT_FOUND (custom code)', () => {
    it('maps to 404 with NOT_FOUND code and original message', () => {
      const err = Object.assign(
        new Error('Restaurant not found'),
        { statusCode: 404, code: 'NOT_FOUND' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(404);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('NOT_FOUND');
      expect(result.body.error.message).toBe('Restaurant not found');
    });
  });

  describe('INVALID_PDF', () => {
    it('maps to 422 with INVALID_PDF code and original message', () => {
      const err = Object.assign(
        new Error('File is not a valid PDF'),
        { statusCode: 422, code: 'INVALID_PDF' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('INVALID_PDF');
      expect(result.body.error.message).toBe('File is not a valid PDF');
    });
  });

  describe('UNSUPPORTED_PDF', () => {
    it('maps to 422 with UNSUPPORTED_PDF code and original message', () => {
      const err = Object.assign(
        new Error('PDF contains no extractable text'),
        { statusCode: 422, code: 'UNSUPPORTED_PDF' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('UNSUPPORTED_PDF');
      expect(result.body.error.message).toBe('PDF contains no extractable text');
    });
  });

  describe('NO_NUTRITIONAL_DATA_FOUND', () => {
    it('maps to 422 with NO_NUTRITIONAL_DATA_FOUND code and original message', () => {
      const err = Object.assign(
        new Error('No nutritional data found in PDF'),
        { statusCode: 422, code: 'NO_NUTRITIONAL_DATA_FOUND' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('NO_NUTRITIONAL_DATA_FOUND');
      expect(result.body.error.message).toBe('No nutritional data found in PDF');
    });
  });

  describe('PROCESSING_TIMEOUT', () => {
    it('maps to 408 with PROCESSING_TIMEOUT code and original message', () => {
      const err = Object.assign(
        new Error('Processing timeout'),
        { statusCode: 408, code: 'PROCESSING_TIMEOUT' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(408);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('PROCESSING_TIMEOUT');
      expect(result.body.error.message).toBe('Processing timeout');
    });
  });

  describe('INVALID_URL', () => {
    it('maps to 422 with INVALID_URL code and original message', () => {
      const err = Object.assign(
        new Error('URL must use http or https scheme'),
        { statusCode: 422, code: 'INVALID_URL' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('INVALID_URL');
      expect(result.body.error.message).toBe('URL must use http or https scheme');
    });
  });

  describe('FETCH_FAILED', () => {
    it('maps to 422 with FETCH_FAILED code and original message', () => {
      const err = Object.assign(
        new Error('Failed to fetch URL'),
        { statusCode: 422, code: 'FETCH_FAILED' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('FETCH_FAILED');
      expect(result.body.error.message).toBe('Failed to fetch URL');
    });
  });

  describe('SCRAPER_BLOCKED', () => {
    it('maps to 422 with SCRAPER_BLOCKED code and original message', () => {
      const err = Object.assign(
        new Error('Access blocked by target server'),
        { statusCode: 422, code: 'SCRAPER_BLOCKED' },
      );

      const result = mapError(err);

      expect(result.statusCode).toBe(422);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('SCRAPER_BLOCKED');
      expect(result.body.error.message).toBe('Access blocked by target server');
    });
  });
});
