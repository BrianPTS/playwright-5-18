/**
 * Domain errors following Node.js backend best practices
 * These errors represent business logic violations and provide
 * proper HTTP status codes and structured error responses.
 */

/**
 * Base domain error class
 * All business logic errors should extend this class
 */
export class DomainError extends Error {
  /**
   * @param {string} message - Human readable error message
   * @param {string} code - Error code for client identification
   * @param {number} statusCode - HTTP status code (default: 400)
   */
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
    
    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DomainError);
    }
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode
    };
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends DomainError {
  constructor(resource, id) {
    const message = id 
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.resourceId = id;
  }
}

/**
 * Validation error for business rules (400)
 */
export class ValidationError extends DomainError {
  constructor(message, details = null) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.details = details;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * Authentication/Authorization errors (401/403)
 */
export class AuthError extends DomainError {
  constructor(message, code = 'AUTH_ERROR', statusCode = 401) {
    super(message, code, statusCode);
    this.name = 'AuthError';
  }
}

/**
 * Rate limiting error (429)
 */
export class RateLimitError extends DomainError {
  constructor(message = 'Too many requests', retryAfter = null) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      ...(this.retryAfter && { retryAfter: this.retryAfter })
    };
  }
}

/**
 * Business logic constraint violation (409)
 */
export class ConflictError extends DomainError {
  constructor(message, conflictingResource = null) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
    this.conflictingResource = conflictingResource;
  }
}

/**
 * External service unavailable (503)
 */
export class ServiceUnavailableError extends DomainError {
  constructor(service, message = 'Service temporarily unavailable') {
    super(`${service}: ${message}`, 'SERVICE_UNAVAILABLE', 503);
    this.name = 'ServiceUnavailableError';
    this.service = service;
  }
}

/**
 * Scraper-specific domain errors
 */
export class ScrapingError extends DomainError {
  constructor(message, details = null) {
    super(message, 'SCRAPING_ERROR', 422);
    this.name = 'ScrapingError';
    this.details = details;
  }
}

export class ProxyError extends DomainError {
  constructor(message, proxyId = null) {
    super(message, 'PROXY_ERROR', 502);
    this.name = 'ProxyError';
    this.proxyId = proxyId;
  }
}

export class SessionError extends DomainError {
  constructor(message, sessionId = null) {
    super(message, 'SESSION_ERROR', 422);
    this.name = 'SessionError';
    this.sessionId = sessionId;
  }
}

/**
 * Check if an error is a domain error
 */
export function isDomainError(error) {
  return error instanceof DomainError;
}

/**
 * Extract error information for logging
 */
export function getErrorContext(error) {
  if (isDomainError(error)) {
    return {
      type: 'domain',
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
      ...error.toJSON()
    };
  }

  return {
    type: 'system',
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}