// app.js - Enhanced with nodejs-backend patterns
import mongoose from "mongoose";
import { loadConfig, getDatabaseUri } from "./config/index.js";
import { createApp, startServerWithFallback } from "./src/infra/http/server.js";
import logger from "./utils/logger.js";

// Route imports
import scraperRoutes from "./routes/scraperRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import cookieRefreshRoutes from "./routes/cookieRefreshRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

// Import global setup
import setupGlobals from "./setup.js";
import scraperManager from "./scraperManager.js";

/**
 * Main application entry point
 */
async function main() {
  try {
    // Load and validate configuration
    const config = loadConfig();
    logger.info('Configuration loaded successfully', 'startup', {
      environment: config.NODE_ENV,
      port: config.PORT
    });

    // Initialize global components (including ProxyManager)
    await setupGlobals();

    // Database connection with enhanced configuration
    const connectDB = async () => {
      try {
        const mongoUri = getDatabaseUri();
        await mongoose.connect(mongoUri, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
          maxPoolSize: 10,
          minPoolSize: 2,
          heartbeatFrequencyMS: 10000
        });
        logger.info("Connected to MongoDB with enhanced configuration", 'database');
      } catch (error) {
        logger.error("Database connection failed", 'database', error);
        process.exit(1);
      }
    };

    await connectDB();

    // Create app with dependency injection
    const app = createApp({
      scraperRoutes,
      eventRoutes,
      statsRoutes,
      healthRoutes,
      cookieRefreshRoutes,
      adminRoutes
    });

    // Cleanup function for graceful shutdown
    const cleanup = async () => {
      logger.info('Starting cleanup process...', 'cleanup');

      // Stop scraper manager
      if (scraperManager && typeof scraperManager.stop === 'function') {
        try {
          logger.info("Stopping scraper manager...", 'cleanup');
          await scraperManager.stop();
          logger.info("Scraper manager stopped successfully", 'cleanup');
        } catch (error) {
          logger.error("Error during scraper stop", 'cleanup', error);
        }
      }

      // Close database connections
      try {
        logger.info("Closing database connections...", 'cleanup');
        await mongoose.connection.close();
        logger.info("Database connections closed successfully", 'cleanup');
      } catch (error) {
        logger.error("Error closing database connections", 'cleanup', error);
      }
    };

    // Start server with enhanced configuration
    startServerWithFallback(app, config.PORT, cleanup);

    // Check for command-line scraper start
    if (process.argv.includes('--start-scraper')) {
      logger.info('Starting scraper from command line...', 'startup');
      setTimeout(() => {
        if (scraperManager && typeof scraperManager.startContinuousScraping === 'function') {
          scraperManager.startContinuousScraping().catch((error) => {
            logger.error("Error starting scraper from command line", 'startup', error);
          });
        }
      }, 2000);
    }

  } catch (error) {
    logger.error('Failed to start application', 'startup', error);
    process.exit(1);
  }
}

// Start the application
main();

export default main;
