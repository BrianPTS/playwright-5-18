import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import { loadConfig, getCorsConfig } from '../../../config/index.js';
import { errorHandler, notFoundHandler, timeoutHandler } from './middleware/errorHandler.js';
import logger from '../../../utils/logger.js';

/**
 * Create Express app with proper middleware setup
 * Following nodejs-backend patterns for clean server architecture
 */
export function createApp(dependencies = {}) {
  const app = express();
  const config = loadConfig();

  // Trust proxy for proper IP handling
  app.set('trust proxy', 1);

  // Request logging with morgan
  const morganFormat = config.NODE_ENV === 'production' 
    ? 'combined' 
    : 'dev';
  
  app.use(morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim(), 'http')
    }
  }));

  // Security and parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // CORS configuration
  app.use(cors(getCorsConfig()));

  // Request timeout
  app.use(timeoutHandler(config.REQUEST_TIMEOUT_MS));

  // Health check endpoint (before routes for performance)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  // API routes with dependency injection
  const { 
    scraperRoutes,
    eventRoutes, 
    statsRoutes,
    healthRoutes,
    cookieRefreshRoutes,
    adminRoutes 
  } = dependencies;

  if (healthRoutes) app.use('/api/health', healthRoutes);
  if (scraperRoutes) app.use('/api/scraper', scraperRoutes);
  if (eventRoutes) app.use('/api/events', eventRoutes);
  if (statsRoutes) app.use('/api/stats', statsRoutes);
  if (cookieRefreshRoutes) app.use('/api/cookies', cookieRefreshRoutes);
  if (adminRoutes) app.use('/api/admin', adminRoutes);

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Start server with graceful shutdown support
 * @param {Express} app - Express application
 * @param {number} port - Port number
 * @param {Function} cleanup - Cleanup function for graceful shutdown
 */
export function startServer(app, port, cleanup) {
  const config = loadConfig();
  
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error('Failed to start server', 'server', err);
      process.exit(1);
    }
    
    logger.info(`🚀 Server running on port ${port}`, 'server', {
      port,
      environment: config.NODE_ENV,
      processId: process.pid
    });
  });

  // Graceful shutdown handling
  const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`, 'server');

    server.close(async (err) => {
      if (err) {
        logger.error('Error during server shutdown', 'server', err);
        process.exit(1);
      }

      logger.info('HTTP server closed', 'server');

      try {
        if (cleanup && typeof cleanup === 'function') {
          logger.info('Running cleanup tasks...', 'server');
          await cleanup();
          logger.info('Cleanup completed', 'server');
        }
        
        logger.info('Graceful shutdown complete', 'server');
        process.exit(0);
      } catch (cleanupError) {
        logger.error('Error during cleanup', 'server', cleanupError);
        process.exit(1);
      }
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down', 'server');
      process.exit(1);
    }, 10000);
  };

  // Listen for termination signals
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', 'server', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', 'server', { promise, reason });
    process.exit(1);
  });

  return server;
}

/**
 * Start server with automatic port fallback
 * @param {Express} app - Express application
 * @param {number} initialPort - Initial port to try
 * @param {Function} cleanup - Cleanup function
 * @param {number} maxAttempts - Maximum port fallback attempts
 */
export function startServerWithFallback(app, initialPort, cleanup, maxAttempts = 10) {
  let currentPort = initialPort;
  let attempts = 0;

  const tryPort = () => {
    const server = app.listen(currentPort, (err) => {
      if (!err) {
        logger.info(`🚀 Server started on port ${currentPort}`, 'server', {
          port: currentPort,
          attempts: attempts + 1
        });
        return;
      }
      
      if (attempts >= maxAttempts) {
        logger.error(`Failed to start server after ${maxAttempts} attempts`, 'server', err);
        process.exit(1);
      }
      
      attempts++;
      currentPort++;
      logger.warn(`Port ${currentPort - 1} unavailable, trying ${currentPort}`, 'server');
      tryPort();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (attempts < maxAttempts) {
          attempts++;
          currentPort++;
          server.close();
          setTimeout(tryPort, 100);
        } else {
          logger.error(`Failed to start server after ${maxAttempts} attempts`, 'server', err);
          process.exit(1);
        }
      } else {
        logger.error('Server error', 'server', err);
        process.exit(1);
      }
    });

    return server;
  };

  return tryPort();
}