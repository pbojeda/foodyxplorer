// Scraper-specific error classes.
//
// All errors carry a `code` property (SCREAMING_SNAKE_CASE) that matches the
// strings used in ScraperResult.errors[].code. The prototype chain is restored
// via Object.setPrototypeOf so that `instanceof` checks work correctly after
// TypeScript compiles to ES targets that do not natively support class extension
// of built-in types.

/**
 * Base error class for all scraper errors.
 * Not thrown directly — extend this class for specific error types.
 */
export class ScraperError extends Error {
  readonly code: string = 'SCRAPER_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ScraperError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a network failure occurs after all retry attempts are exhausted.
 */
export class ScraperNetworkError extends ScraperError {
  override readonly code: string = 'SCRAPER_NETWORK_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ScraperNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the scraper detects it is being blocked (HTTP 403, CAPTCHA, etc.).
 * This error is NOT retried — it causes the run to abort immediately.
 */
export class ScraperBlockedError extends ScraperError {
  override readonly code: string = 'SCRAPER_BLOCKED_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ScraperBlockedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a page's DOM structure has changed such that expected selectors
 * are no longer present. Signals that the chain scraper needs updating.
 */
export class ScraperStructureError extends ScraperError {
  override readonly code: string = 'SCRAPER_STRUCTURE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ScraperStructureError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when raw dish data cannot be normalized due to missing or invalid
 * required fields.
 */
export class NormalizationError extends ScraperError {
  override readonly code: string = 'NORMALIZATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'NormalizationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an abstract stub method is called without a concrete
 * implementation. Used to guard F007 stub methods until F008 implements them.
 */
export class NotImplementedError extends ScraperError {
  override readonly code: string = 'NOT_IMPLEMENTED_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
