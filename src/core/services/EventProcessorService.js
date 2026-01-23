/**
 * Event Processor Service
 * Handles individual event scraping and processing
 * Following nodejs-backend patterns for focused responsibility
 */

import { ScraperConfig } from './ScraperConfig.js';
import logger from '../../../utils/logger.js';
import { ScrapingError, ProxyError, SessionError } from '../errors.js';

export class EventProcessorService {
  constructor(dependencies = {}) {
    this.sessionManager = dependencies.sessionManager;
    this.proxyManager = dependencies.proxyManager;
    this.eventRepository = dependencies.eventRepository;
    this.inventoryApi = dependencies.inventoryApi;
    
    // Processing state
    this.activeProcessing = new Map();
    this.eventStats = new Map();
  }
  
  /**
   * Process a single event
   * @param {Object} event - Event to process
   * @returns {Promise<Object>} Processing result
   */
  async processEvent(event) {
    const eventId = event.Event_ID;
    
    // Check if already processing
    if (this.activeProcessing.has(eventId)) {
      throw new ScrapingError(`Event ${eventId} is already being processed`);
    }
    
    this.activeProcessing.set(eventId, {
      startTime: new Date(),
      attempts: 0
    });
    
    try {
      logger.info('Starting event processing', 'event-processor', {
        eventId,
        eventName: event.Event_Name
      });
      
      // Get or create session for event
      const session = await this.#getEventSession(event);
      
      // Validate session and refresh if needed
      await this.#validateAndRefreshSession(session, event);
      
      // Perform scraping
      const scrapingResult = await this.#performScraping(event, session);
      
      // Process and store results
      const processedResult = await this.#processScrapingResults(event, scrapingResult);
      
      // Update event status
      await this.eventRepository.updateInventoryTimestamp(
        eventId, 
        processedResult.inventoryCount
      );
      
      logger.info('Event processing completed', 'event-processor', {
        eventId,
        inventoryCount: processedResult.inventoryCount,
        duration: Date.now() - this.activeProcessing.get(eventId).startTime
      });
      
      return processedResult;
      
    } catch (error) {
      logger.error('Event processing failed', 'event-processor', {
        eventId,
        error: error.message,
        attempts: this.activeProcessing.get(eventId)?.attempts || 0
      });
      
      throw this.#handleProcessingError(error, eventId);
      
    } finally {
      this.activeProcessing.delete(eventId);
    }
  }
  
  /**
   * Get or create session for event
   */
  async #getEventSession(event) {
    try {
      // Try to get existing valid session
      let session = await this.sessionManager.getValidSession(event.Event_ID);
      
      if (!session) {
        // Create new session if none exists
        session = await this.sessionManager.createSession({
          eventId: event.Event_ID,
          eventName: event.Event_Name,
          url: event.URL
        });
        
        logger.info('Created new session for event', 'event-processor', {
          eventId: event.Event_ID,
          sessionId: session.sessionId
        });
      }
      
      return session;
      
    } catch (error) {
      throw new SessionError(`Failed to get session for event ${event.Event_ID}`, event.Event_ID);
    }
  }
  
  /**
   * Validate and refresh session if needed
   */
  async #validateAndRefreshSession(session, event) {
    try {
      const isValid = await this.sessionManager.validateSession(session.sessionId);
      
      if (!isValid) {
        logger.warn('Session invalid, refreshing', 'event-processor', {
          eventId: event.Event_ID,
          sessionId: session.sessionId
        });
        
        await this.sessionManager.refreshSession(session.sessionId);
      }
      
      // Check session age
      const sessionAge = Date.now() - new Date(session.createdAt).getTime();
      if (sessionAge > ScraperConfig.SESSION_REFRESH_INTERVAL) {
        logger.info('Session expired by age, rotating', 'event-processor', {
          eventId: event.Event_ID,
          sessionAge: Math.floor(sessionAge / 1000 / 60) + 'm'
        });
        
        await this.sessionManager.rotateSession(session.sessionId);
      }
      
    } catch (error) {
      throw new SessionError(`Session validation failed for event ${event.Event_ID}`, event.Event_ID);
    }
  }
  
  /**
   * Perform actual scraping operation
   */
  async #performScraping(event, session) {
    const processingInfo = this.activeProcessing.get(event.Event_ID);
    processingInfo.attempts++;
    
    try {
      // Get proxy for scraping
      const proxy = await this.proxyManager.getHealthyProxy();
      if (!proxy) {
        throw new ProxyError('No healthy proxies available');
      }
      
      logger.info('Starting scraping with proxy', 'event-processor', {
        eventId: event.Event_ID,
        proxyId: proxy.ip + ':' + proxy.port,
        attempt: processingInfo.attempts
      });
      
      // Perform scraping using the configured scraper
      const scrapingResult = await this.inventoryApi.scrapeEvent({
        event,
        session,
        proxy,
        timeout: ScraperConfig.SCRAPE_TIMEOUT
      });
      
      // Validate scraping result
      if (!scrapingResult || !scrapingResult.inventory) {
        throw new ScrapingError('No inventory data returned from scraping');
      }
      
      return scrapingResult;
      
    } catch (error) {
      if (error instanceof ProxyError) {
        // Mark proxy as problematic
        await this.proxyManager.markProxyStatus(proxy.ip + ':' + proxy.port, 'error');
      }
      
      throw error;
    }
  }
  
  /**
   * Process and validate scraping results
   */
  async #processScrapingResults(event, scrapingResult) {
    try {
      const { inventory, metadata } = scrapingResult;
      
      // Validate inventory data
      if (!Array.isArray(inventory)) {
        throw new ScrapingError('Invalid inventory data format');
      }
      
      // Process inventory items
      const processedInventory = inventory.map(item => ({
        ...item,
        eventId: event.Event_ID,
        scrapedAt: new Date(),
        inventoryId: this.#generateInventoryId()
      }));
      
      logger.info('Processed inventory data', 'event-processor', {
        eventId: event.Event_ID,
        inventoryCount: processedInventory.length,
        metadata: metadata || {}
      });
      
      return {
        inventoryCount: processedInventory.length,
        inventory: processedInventory,
        metadata: {
          ...metadata,
          processedAt: new Date(),
          eventId: event.Event_ID
        }
      };
      
    } catch (error) {
      throw new ScrapingError(`Failed to process scraping results: ${error.message}`);
    }
  }
  
  /**
   * Handle processing errors with proper categorization
   */
  #handleProcessingError(error, eventId) {
    // Determine error type and appropriate action
    if (error instanceof SessionError) {
      return new SessionError(`Session error for event ${eventId}: ${error.message}`, eventId);
    }
    
    if (error instanceof ProxyError) {
      return new ProxyError(`Proxy error for event ${eventId}: ${error.message}`);
    }
    
    if (error instanceof ScrapingError) {
      return error;
    }
    
    // Generic scraping error
    return new ScrapingError(`Event processing failed for ${eventId}: ${error.message}`);
  }
  
  /**
   * Generate unique inventory ID
   */
  #generateInventoryId() {
    // Simple implementation - can be enhanced
    return Date.now() + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Get processing statistics
   */
  getProcessingStats() {
    return {
      activeProcessing: this.activeProcessing.size,
      activeEvents: Array.from(this.activeProcessing.keys()),
      eventStats: Object.fromEntries(this.eventStats)
    };
  }
  
  /**
   * Check if event is currently being processed
   */
  isEventProcessing(eventId) {
    return this.activeProcessing.has(eventId);
  }
  
  /**
   * Get current processing info for event
   */
  getEventProcessingInfo(eventId) {
    return this.activeProcessing.get(eventId) || null;
  }
}