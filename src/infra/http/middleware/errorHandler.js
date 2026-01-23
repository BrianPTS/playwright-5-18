import { isDomainError, getErrorContext } from '../../../core/errors.js';
import { ZodError } from 'zod';
import logger from '../../../../utils/logger.js';

/**
 * Global error handler following nodejs-backend best practices
 * Handles domain errors, validation errors, and unexpected errors
 * with proper logging and structured responses
 */
export function errorHandler(err, req, res, next) {
  // Log the error with context
  const errorContext = getErrorContext(err);
  const requestContext = {
    method: req.method,
    url: req.url,
    userAgent: req.get('user-agent'),
    ip: req.ip,
    ...(req.user && { userId: req.user.id })
  };

  logger.error('Request error', 'error-handler', {
    error: errorContext,
    request: requestContext
  });

  // Handle domain errors (business logic errors)
  if (isDomainError(err)) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.toJSON && err.toJSON())
      },
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.errors.map(error => ({
          field: error.path.join('.'),
          message: error.message,
          code: error.code
        }))
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError' && err.errors) {
    const validationErrors = Object.keys(err.errors).map(key => ({
      field: key,
      message: err.errors[key].message
    }));

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Database validation failed',
        details: validationErrors
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      error: {
        code: 'DUPLICATE_KEY',
        message: `${field} already exists`,
        details: { field, value: err.keyValue[field] }
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle MongoDB CastError (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: {
        code: 'INVALID_FORMAT',
        message: `Invalid ${err.kind}: ${err.value}`,
        details: { field: err.path, value: err.value }
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle JSON syntax errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body'
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle CORS errors
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      error: {
        code: 'CORS_ERROR',
        message: 'Cross-origin request blocked'
      },
      timestamp: new Date().toISOString()
    });
  }

  // Handle rate limiting errors
  if (err.statusCode === 429 || err.status === 429) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        ...(err.retryAfter && { retryAfter: err.retryAfter })
      },
      timestamp: new Date().toISOString()
    });
  }

  // Log unexpected errors for investigation
  logger.error('Unexpected server error', 'error-handler', {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      statusCode: err.statusCode
    },
    request: requestContext
  });

  // Return generic error for security (don't leak internal details)
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' 
        ? err.message 
        : 'Something went wrong'
    },
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { 
      debug: {
        name: err.name,
        stack: err.stack
      }
    })
  });
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req, res) {
  logger.warn('Route not found', 'error-handler', {
    method: req.method,
    url: req.url,
    userAgent: req.get('user-agent'),
    ip: req.ip
  });

  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url} not found`
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * Async error wrapper for route handlers
 * Catches async errors and forwards them to error handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Request timeout middleware
 */
export function timeoutHandler(timeoutMs = 30000) {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: {
            code: 'REQUEST_TIMEOUT',
            message: `Request timeout after ${timeoutMs}ms`
          },
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    // Clear timeout on response finish
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));

    next();
  };
}