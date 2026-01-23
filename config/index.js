import { z } from 'zod';
import dotenv from 'dotenv';
import { ValidationError } from '../src/core/errors.js';

// Load environment variables
dotenv.config();

/**
 * Configuration schema with validation rules
 * Following nodejs-backend best practices for environment validation
 */
const ConfigSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Server configuration
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  
  // Database configuration
  MONGODB_URI: z.string().url('Invalid MongoDB URI').or(z.string().regex(/^mongodb:\/\//, 'Must be a valid MongoDB connection string')),
  DATABASE_URL: z.string().url('Invalid Database URL').optional(),
  
  // External APIs
  TICKETMASTER_API_KEY: z.string().min(1, 'Ticketmaster API key is required').optional(),
  
  // Scraping configuration
  MAX_CONCURRENT_SCRAPERS: z.coerce.number().min(1).max(50).default(5),
  SESSION_ROTATION_INTERVAL: z.coerce.number().min(1000).default(300000), // 5 minutes
  PROXY_ROTATION_INTERVAL: z.coerce.number().min(1000).default(60000), // 1 minute
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1000).default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE_PATH: z.string().optional(),
  
  // CORS origins (comma-separated string)
  ALLOWED_ORIGINS: z.string()
    .transform(str => str.split(',').map(s => s.trim()).filter(Boolean))
    .default('http://localhost:3000,http://localhost:5173'),
    
  // Security
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters').optional(),
  
  // Performance
  REQUEST_TIMEOUT_MS: z.coerce.number().min(1000).default(30000),
  BROWSER_TIMEOUT_MS: z.coerce.number().min(5000).default(60000),
  
  // Feature flags
  ENABLE_PROXY_VALIDATION: z.coerce.boolean().default(true),
  ENABLE_SESSION_RECOVERY: z.coerce.boolean().default(true),
  ENABLE_AUTO_CLEANUP: z.coerce.boolean().default(true),
  
  // Monitoring
  HEALTH_CHECK_INTERVAL: z.coerce.number().min(1000).default(30000),
  STATS_LOG_INTERVAL: z.coerce.number().min(1000).default(300000),
});

/**
 * Load and validate configuration from environment variables
 * @returns {Config} Validated configuration object
 * @throws {ValidationError} If validation fails
 */
export function loadConfig() {
  try {
    const config = ConfigSchema.parse(process.env);
    
    // Additional business logic validations
    if (config.NODE_ENV === 'production') {
      if (!config.JWT_SECRET) {
        throw new ValidationError('JWT_SECRET is required in production environment');
      }
      if (!config.TICKETMASTER_API_KEY) {
        console.warn('⚠️  TICKETMASTER_API_KEY not set in production');
      }
    }
    
    // Validate database URI fallback
    if (!config.MONGODB_URI && !config.DATABASE_URL) {
      throw new ValidationError('Either MONGODB_URI or DATABASE_URL must be provided');
    }
    
    // Use DATABASE_URL as fallback for MONGODB_URI
    if (!config.MONGODB_URI && config.DATABASE_URL) {
      config.MONGODB_URI = config.DATABASE_URL;
    }
    
    return config;
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      throw new ValidationError(
        'Configuration validation failed',
        { errors: errorMessages, details: error.errors }
      );
    }
    throw error;
  }
}

/**
 * Get specific configuration value with type safety
 * @param {keyof Config} key - Configuration key
 * @returns {any} Configuration value
 */
export function getConfig(key) {
  return loadConfig()[key];
}

/**
 * Check if running in production environment
 */
export function isProduction() {
  return loadConfig().NODE_ENV === 'production';
}

/**
 * Check if running in development environment
 */
export function isDevelopment() {
  return loadConfig().NODE_ENV === 'development';
}

/**
 * Check if running in test environment
 */
export function isTest() {
  return loadConfig().NODE_ENV === 'test';
}

/**
 * Get database connection string with proper fallbacks
 */
export function getDatabaseUri() {
  const config = loadConfig();
  return config.MONGODB_URI || config.DATABASE_URL;
}

/**
 * Get CORS configuration
 */
export function getCorsConfig() {
  const config = loadConfig();
  const allowedOrigins = config.ALLOWED_ORIGINS;
  
  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // In development, be more permissive
      if (isDevelopment() && origin.includes('localhost')) {
        return callback(null, true);
      }
      
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  };
}

// Export default config instance for backwards compatibility
let configInstance = null;

export default function getConfigInstance() {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}