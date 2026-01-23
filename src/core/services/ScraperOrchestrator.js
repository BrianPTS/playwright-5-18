/**
 * Scraper Orchestrator Service
 * Main orchestration logic extracted from ScraperManager
 * Following nodejs-backend patterns for service composition
 */

import { ScraperConfig } from './ScraperConfig.js';
import { EventRepository } from '../../infra/db/repositories/EventRepository.js';
import logger from '../../../utils/logger.js';
import { ScrapingError, ServiceUnavailableError } from '../errors.js';

export class ScraperOrchestrator {
  constructor(dependencies = {}) {
    this.eventRepository = dependencies.eventRepository || new EventRepository();
    this.sessionManager = dependencies.sessionManager;
    this.proxyManager = dependencies.proxyManager;
    this.eventProcessor = dependencies.eventProcessor;
    this.recoveryService = dependencies.recoveryService;
    
    // State management
    this.isRunning = false;
    this.currentBatch = [];
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: null
    };
  }
  
  /**
   * Start continuous scraping orchestration
   */
  async startContinuousScraping() {
    if (this.isRunning) {
      logger.warn('Scraper already running', 'orchestrator');
      return;
    }
    
    try {
      this.isRunning = true;
      this.stats.startTime = new Date();
      
      logger.info('Starting continuous scraping orchestration', 'orchestrator', {
        config: {
          maxRetries: ScraperConfig.MAX_RETRIES,
          scrapeTimeout: ScraperConfig.SCRAPE_TIMEOUT,
          minTimeBetweenScrapes: ScraperConfig.MIN_TIME_BETWEEN_EVENT_SCRAPES
        }
      });
      
      // Initialize orchestration loops
      await Promise.all([
        this.#startProcessingLoop(),
        this.#startHealthMonitoring(),
        this.#startRecoveryLoop()
      ]);
      
    } catch (error) {
      logger.error('Failed to start scraper orchestration', 'orchestrator', error);
      this.isRunning = false;
      throw new ServiceUnavailableError('Scraper', 'Failed to start orchestration');
    }
  }
  
  /**
   * Stop scraper orchestration
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping scraper orchestration...', 'orchestrator');
    
    this.isRunning = false;
    
    // Wait for current operations to complete
    await this.#waitForCurrentOperations();
    
    logger.info('Scraper orchestration stopped', 'orchestrator', {
      stats: this.getStats()
    });
  }
  
  /**
   * Get current orchestration statistics
   */
  getStats() {
    const now = new Date();
    const uptime = this.stats.startTime ? now - this.stats.startTime : 0;
    const successRate = this.stats.totalProcessed > 0 
      ? (this.stats.successful / this.stats.totalProcessed * 100).toFixed(2)
      : '0';
    
    return {
      isRunning: this.isRunning,
      uptime: Math.floor(uptime / 1000 / 60), // minutes
      totalProcessed: this.stats.totalProcessed,
      successful: this.stats.successful,
      failed: this.stats.failed,
      successRate: `${successRate}%`,
      currentBatchSize: this.currentBatch.length
    };
  }
  
  /**
   * Process events in batches
   */
  async processEventBatch(events) {
    if (!Array.isArray(events) || events.length === 0) {
      return { processed: 0, successful: 0, failed: 0 };
    }
    
    this.currentBatch = events;
    const results = {
      processed: events.length,
      successful: 0,
      failed: 0,
      details: []
    };
    
    try {
      // Process events concurrently with throttling
      const processEvent = async (event) => {
        try {
          const result = await this.eventProcessor.processEvent(event);
          results.successful++;
          this.stats.successful++;
          results.details.push({ eventId: event.Event_ID, status: 'success', result });
        } catch (error) {
          results.failed++;
          this.stats.failed++;
          results.details.push({ eventId: event.Event_ID, status: 'failed', error: error.message });
          
          logger.error('Event processing failed', 'orchestrator', {
            eventId: event.Event_ID,
            error: error.message
          });
        }
      };
      
      // Process with controlled concurrency
      await Promise.all(events.map(processEvent));
      
      this.stats.totalProcessed += events.length;
      
      logger.info('Batch processing completed', 'orchestrator', {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed
      });
      
    } catch (error) {
      logger.error('Batch processing failed', 'orchestrator', error);
      throw new ScrapingError('Batch processing failed', { batchSize: events.length });
    } finally {
      this.currentBatch = [];
    }
    
    return results;
  }
  
  /**
   * Main processing loop
   */
  async #startProcessingLoop() {
    while (this.isRunning) {
      try {
        // Get next batch of events to process
        const events = await this.eventRepository.findByStatus('active', {
          limit: 10,
          sortBy: 'lastInventoryUpdate',
          sortOrder: 'asc'
        });
        
        if (events.length > 0) {
          await this.processEventBatch(events);
        } else {
          // No events to process, wait before next check
          await this.#delay(ScraperConfig.MIN_TIME_BETWEEN_EVENT_SCRAPES);
        }
        
      } catch (error) {
        logger.error('Processing loop error', 'orchestrator', error);
        await this.#delay(ScraperConfig.MIN_TIME_BETWEEN_EVENT_SCRAPES * 2);
      }
    }
  }
  
  /**
   * Health monitoring loop
   */
  async #startHealthMonitoring() {
    while (this.isRunning) {
      try {
        await this.#performHealthCheck();
        await this.#delay(30000); // Check every 30 seconds
      } catch (error) {
        logger.error('Health monitoring error', 'orchestrator', error);
      }
    }
  }
  
  /**
   * Recovery loop for handling stale/failed events
   */
  async #startRecoveryLoop() {
    while (this.isRunning) {
      try {
        if (this.recoveryService) {
          await this.recoveryService.performRecovery();
        }
        await this.#delay(ScraperConfig.STANDARD_RECOVERY_INTERVAL);
      } catch (error) {
        logger.error('Recovery loop error', 'orchestrator', error);
      }
    }
  }
  
  /**
   * Perform health check on services
   */
  async #performHealthCheck() {
    const checks = {
      database: false,
      proxy: false,
      session: false
    };
    
    try {
      // Check database connection
      const testEvent = await this.eventRepository.findAll({ limit: 1 });
      checks.database = true;
      
      // Check proxy availability
      if (this.proxyManager) {
        const proxyStats = this.proxyManager.getUsageStats();
        checks.proxy = proxyStats.healthyProxies > 0;
      }
      
      // Check session manager
      if (this.sessionManager) {
        const sessionStats = this.sessionManager.getSessionStats();
        checks.session = sessionStats.active >= 0;
      }
      
      logger.info('Health check completed', 'orchestrator', {
        checks,
        stats: this.getStats()
      });
      
    } catch (error) {
      logger.error('Health check failed', 'orchestrator', error);
    }
  }
  
  /**
   * Wait for current operations to complete
   */
  async #waitForCurrentOperations(maxWait = 30000) {
    const startTime = Date.now();
    
    while (this.currentBatch.length > 0 && (Date.now() - startTime) < maxWait) {
      await this.#delay(100);
    }
    
    if (this.currentBatch.length > 0) {
      logger.warn('Some operations did not complete within timeout', 'orchestrator', {
        remainingOperations: this.currentBatch.length
      });
    }
  }
  
  /**
   * Utility delay function
   */
  async #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}