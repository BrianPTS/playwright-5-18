/**
 * Domain Errors for the scraper application
 * Following nodejs-backend patterns for proper error handling
 */

/**
 * Base domain error class
 */
export class DomainError extends Error {
  constructor(message, code, statusCode = 500, metadata = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.metadata = metadata;
    this.isOperational = true;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends DomainError {
  constructor(service, message, metadata = {}) {
    super(`Service ${service} is unavailable: ${message}`, 'SERVICE_UNAVAILABLE', 503, metadata);
    this.service = service;
  }
}

/**
 * Validation error
 */
export class ValidationError extends DomainError {
  constructor(message, field = null, metadata = {}) {
    super(message, 'VALIDATION_ERROR', 400, metadata);
    this.field = field;
  }
}

/**
 * Not found error
 */
export class NotFoundError extends DomainError {
  constructor(resource, identifier = null, metadata = {}) {
    const message = identifier 
      ? `${resource} with identifier ${identifier} not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, metadata);
    this.resource = resource;
    this.identifier = identifier;
  }
}

/**
 * Conflict error
 */
export class ConflictError extends DomainError {
  constructor(message, metadata = {}) {
    super(message, 'CONFLICT', 409, metadata);
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends DomainError {
  constructor(message = 'Rate limit exceeded', metadata = {}) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, metadata);
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends DomainError {
  constructor(message = 'Authentication failed', metadata = {}) {
    super(message, 'AUTHENTICATION_FAILED', 401, metadata);
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends DomainError {
  constructor(message = 'Access denied', metadata = {}) {
    super(message, 'ACCESS_DENIED', 403, metadata);
  }
}

/**
 * Network error
 */
export class NetworkError extends DomainError {
  constructor(message, metadata = {}) {
    super(message, 'NETWORK_ERROR', 502, metadata);
  }
}

/**
 * Database error
 */
export class DatabaseError extends DomainError {
  constructor(message, operation = null, metadata = {}) {
    super(message, 'DATABASE_ERROR', 500, metadata);
    this.operation = operation;
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends DomainError {
  constructor(service, message, statusCode = 502, metadata = {}) {
    super(`External service ${service} error: ${message}`, 'EXTERNAL_SERVICE_ERROR', statusCode, metadata);
    this.service = service;
  }
}

/**
 * Helper function to create domain errors
 */
export function createDomainError(code, message, metadata = {}) {
  const errorMap = {
    'SERVICE_UNAVAILABLE': () => new ServiceUnavailableError('Unknown', message, metadata),
    'VALIDATION_ERROR': () => new ValidationError(message, metadata.field, metadata),
    'NOT_FOUND': () => new NotFoundError(metadata.resource || 'Resource', metadata.identifier, metadata),
    'CONFLICT': () => new ConflictError(message, metadata),
    'RATE_LIMIT_EXCEEDED': () => new RateLimitError(message, metadata),
    'AUTHENTICATION_FAILED': () => new AuthenticationError(message, metadata),
    'ACCESS_DENIED': () => new AuthorizationError(message, metadata),
    'NETWORK_ERROR': () => new NetworkError(message, metadata),
    'DATABASE_ERROR': () => new DatabaseError(message, metadata.operation, metadata),
    'EXTERNAL_SERVICE_ERROR': () => new ExternalServiceError(metadata.service || 'Unknown', message, metadata.statusCode, metadata)
  };

  const createError = errorMap[code];
  if (createError) {
    return createError();
  }

  // Default to generic domain error
  return new DomainError(message, code, metadata.statusCode || 500, metadata);
}

/**
 * Check if an error is a domain error
 */
export function isDomainError(error) {
  return error instanceof DomainError;
}

/**
 * Extract error details for logging/API responses
 */
export function extractErrorDetails(error) {
  if (isDomainError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      metadata: error.metadata,
      isOperational: error.isOperational
    };
  }

  // Handle non-domain errors
  return {
    name: error.name || 'Error',
    message: error.message || 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    statusCode: 500,
    metadata: {},
    isOperational: false
  };
}