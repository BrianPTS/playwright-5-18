/**
 * Batch Manager Service
 * Handles intelligent batching and processing of events
 * Following nodejs-backend patterns for efficient processing
 */

import { ScraperConfig } from './ScraperConfig.js';
import logger from '../../../utils/logger.js';
import { ValidationError } from '../errors.js';

export class BatchManager {
  constructor(dependencies = {}) {
    this.eventRepository = dependencies.eventRepository;
    
    // Batch configuration
    this.batchConfig = {
      defaultSize: 5,
      maxSize: 20,
      minSize: 1,
      prioritySize: 3,
      timeoutMs: 30000
    };
    
    // Current batches
    this.currentBatches = new Map();
    this.batchStats = {
      totalBatches: 0,
      totalEvents: 0,
      successfulBatches: 0,
      failedBatches: 0
    };
  }
  
  /**
   * Create optimized batch of events for processing
   * @param {Object} options - Batch options
   * @returns {Promise<Array>} Optimized batch of events
   */
  async createOptimizedBatch(options = {}) {
    try {
      const {
        priority = 'standard',
        maxBatchSize = this.batchConfig.defaultSize,
        includeStale = true,
        eventFilters = {}
      } = options;
      
      logger.info('Creating optimized batch', 'batch-manager', {
        priority,
        maxBatchSize,
        includeStale
      });
      
      const events = await this.#gatherEventsForBatch({
        priority,
        maxBatchSize,
        includeStale,
        eventFilters
      });
      
      if (events.length === 0) {
        logger.info('No events available for batching', 'batch-manager');
        return [];
      }
      
      // Optimize event order within batch
      const optimizedEvents = this.#optimizeBatchOrder(events, priority);
      
      // Create batch metadata
      const batchId = this.#generateBatchId();
      const batch = {
        id: batchId,
        events: optimizedEvents,
        priority,
        createdAt: new Date(),
        size: optimizedEvents.length,
        estimatedDuration: this.#estimateBatchDuration(optimizedEvents)
      };
      
      this.currentBatches.set(batchId, batch);
      
      logger.info('Optimized batch created', 'batch-manager', {
        batchId,
        eventCount: optimizedEvents.length,
        priority,
        estimatedDuration: batch.estimatedDuration
      });
      
      return optimizedEvents;
      
    } catch (error) {
      logger.error('Failed to create optimized batch', 'batch-manager', error);
      throw new ValidationError(`Batch creation failed: ${error.message}`);
    }
  }
  
  /**
   * Process batch with monitoring and statistics
   * @param {Array} events - Events to process
   * @param {Function} processFunction - Function to process individual events
   * @returns {Promise<Object>} Batch processing result
   */
  async processBatch(events, processFunction) {
    if (!Array.isArray(events) || events.length === 0) {
      return { processed: 0, successful: 0, failed: 0, results: [] };
    }
    
    if (typeof processFunction !== 'function') {
      throw new ValidationError('Process function is required');
    }
    
    const batchId = this.#generateBatchId();
    const startTime = Date.now();
    
    this.batchStats.totalBatches++;
    this.batchStats.totalEvents += events.length;
    
    logger.info('Starting batch processing', 'batch-manager', {
      batchId,
      eventCount: events.length
    });
    
    try {
      const results = await this.#processBatchWithConcurrency(
        events,
        processFunction,
        batchId
      );
      
      const duration = Date.now() - startTime;
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      
      if (failed === 0) {
        this.batchStats.successfulBatches++;
      } else {
        this.batchStats.failedBatches++;
      }
      
      logger.info('Batch processing completed', 'batch-manager', {
        batchId,
        duration,
        processed: events.length,
        successful,
        failed,
        successRate: ((successful / events.length) * 100).toFixed(1) + '%'
      });
      
      return {
        batchId,
        processed: events.length,
        successful,
        failed,
        duration,
        results,
        successRate: successful / events.length
      };
      
    } catch (error) {
      this.batchStats.failedBatches++;
      logger.error('Batch processing failed', 'batch-manager', {
        batchId,
        eventCount: events.length,
        error: error.message
      });
      throw error;
    } finally {
      this.currentBatches.delete(batchId);
    }
  }
  
  /**
   * Get next priority batch based on system state
   */
  async getNextPriorityBatch() {
    try {
      // Determine priority based on system conditions
      const priority = await this.#determineBatchPriority();
      
      return await this.createOptimizedBatch({
        priority,
        maxBatchSize: this.#getBatchSizeForPriority(priority)
      });
      
    } catch (error) {
      logger.error('Failed to get next priority batch', 'batch-manager', error);
      return [];
    }
  }
  
  /**
   * Gather events for batch based on criteria
   */
  async #gatherEventsForBatch(options) {
    const { priority, maxBatchSize, includeStale, eventFilters } = options;
    
    try {
      let events = [];
      
      // Get events based on priority
      if (priority === 'critical') {
        // Get events that haven't been updated recently
        const staleTreshold = Date.now() - ScraperConfig.CRITICAL_RECOVERY_INTERVAL;
        events = await this.eventRepository.findAll({
          ...eventFilters,
          limit: maxBatchSize,
          sortBy: 'lastInventoryUpdate',
          sortOrder: 'asc'
        });
        
        events = events.events.filter(event => 
          new Date(event.lastInventoryUpdate || 0).getTime() < staleTreshold
        );
        
      } else if (priority === 'stale') {
        // Get stale events
        events = await this.eventRepository.findStaleEvents(2); // 2 hours
        events = events.slice(0, maxBatchSize);
        
      } else {
        // Standard priority - get active events
        const result = await this.eventRepository.findByStatus('active', {
          limit: maxBatchSize,
          sortBy: 'lastInventoryUpdate',
          sortOrder: 'asc'
        });
        events = result;
      }
      
      return events || [];
      
    } catch (error) {
      logger.error('Failed to gather events for batch', 'batch-manager', error);
      return [];
    }
  }
  
  /**
   * Optimize order of events within batch
   */
  #optimizeBatchOrder(events, priority) {
    if (!Array.isArray(events) || events.length <= 1) {
      return events;
    }
    
    // Sort based on priority and other factors
    return events.sort((a, b) => {
      // Priority factors:
      // 1. Events that haven't been updated longer should go first
      const aLastUpdate = new Date(a.lastInventoryUpdate || 0).getTime();
      const bLastUpdate = new Date(b.lastInventoryUpdate || 0).getTime();
      
      if (aLastUpdate !== bLastUpdate) {
        return aLastUpdate - bLastUpdate; // Older first
      }
      
      // 2. Events with higher inventory count (more popular) go first
      const aInventory = a.inventoryCount || 0;
      const bInventory = b.inventoryCount || 0;
      
      if (aInventory !== bInventory) {
        return bInventory - aInventory; // Higher inventory first
      }
      
      // 3. Alphabetical by event name for consistency
      return a.Event_Name.localeCompare(b.Event_Name);
    });
  }
  
  /**
   * Process batch with controlled concurrency
   */
  async #processBatchWithConcurrency(events, processFunction, batchId) {
    const concurrencyLimit = Math.min(events.length, 3); // Max 3 concurrent
    const results = [];
    
    // Process in chunks for controlled concurrency
    for (let i = 0; i < events.length; i += concurrencyLimit) {
      const chunk = events.slice(i, i + concurrencyLimit);
      
      const chunkPromises = chunk.map(async (event, index) => {
        try {
          const result = await processFunction(event);
          return {
            eventId: event.Event_ID,
            status: 'success',
            result,
            index: i + index
          };
        } catch (error) {
          return {
            eventId: event.Event_ID,
            status: 'failed',
            error: error.message,
            index: i + index
          };
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      
      // Small delay between chunks to prevent overwhelming
      if (i + concurrencyLimit < events.length) {
        await this.#delay(100);
      }
    }
    
    return results;
  }
  
  /**
   * Determine batch priority based on system state
   */
  async #determineBatchPriority() {
    try {
      // Check for stale events
      const staleEvents = await this.eventRepository.findStaleEvents(1);
      
      if (staleEvents.length > 5) {
        return 'critical';
      } else if (staleEvents.length > 0) {
        return 'stale';
      } else {
        return 'standard';
      }
      
    } catch (error) {
      logger.error('Failed to determine batch priority', 'batch-manager', error);
      return 'standard';
    }
  }
  
  /**
   * Get batch size based on priority
   */
  #getBatchSizeForPriority(priority) {
    switch (priority) {
      case 'critical': return this.batchConfig.prioritySize;
      case 'stale': return this.batchConfig.defaultSize;
      default: return this.batchConfig.defaultSize;
    }
  }
  
  /**
   * Estimate batch processing duration
   */
  #estimateBatchDuration(events) {
    // Base estimation: 30 seconds per event
    const baseTimePerEvent = 30000; // 30 seconds
    return events.length * baseTimePerEvent;
  }
  
  /**
   * Generate unique batch ID
   */
  #generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Utility delay function
   */
  async #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get batch processing statistics
   */
  getBatchStats() {
    const successRate = this.batchStats.totalBatches > 0 
      ? (this.batchStats.successfulBatches / this.batchStats.totalBatches * 100).toFixed(1)
      : '0';
    
    return {
      ...this.batchStats,
      successRate: successRate + '%',
      activeBatches: this.currentBatches.size,
      averageEventsPerBatch: this.batchStats.totalBatches > 0 
        ? (this.batchStats.totalEvents / this.batchStats.totalBatches).toFixed(1)
        : '0'
    };
  }
  
  /**
   * Get current active batches
   */
  getActiveBatches() {
    return Array.from(this.currentBatches.values());
  }
}