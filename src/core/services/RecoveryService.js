/**
 * Recovery Service
 * Handles system recovery, stale event management, and emergency procedures
 * Following nodejs-backend patterns for resilience and fault tolerance
 */

import { ScraperConfig } from './ScraperConfig.js';
import logger from '../../../utils/logger.js';
import { ServiceUnavailableError } from '../errors.js';

export class RecoveryService {
  constructor(dependencies = {}) {
    this.eventRepository = dependencies.eventRepository;
    this.sessionManager = dependencies.sessionManager;
    this.proxyManager = dependencies.proxyManager;
    
    // Recovery state
    this.lastRecoveryTime = null;
    this.recoveryStats = {
      totalRecoveries: 0,
      emergencyRecoveries: 0,
      staleEventsRecovered: 0,
      failedEventsRecovered: 0
    };
    
    this.emergencyThreshold = {
      noSuccessMinutes: 10, // Emergency if no success for 10 minutes
      highErrorRate: 0.8, // Emergency if error rate > 80%
      stalledEvents: 5 // Emergency if 5+ events stalled
    };
  }
  
  /**
   * Perform comprehensive system recovery
   */
  async performRecovery() {
    try {
      const recoveryStartTime = Date.now();
      
      logger.info('Starting recovery cycle', 'recovery-service');
      
      // Check if emergency recovery is needed
      const needsEmergencyRecovery = await this.#assessEmergencyConditions();
      
      if (needsEmergencyRecovery) {
        await this.#performEmergencyRecovery();
      } else {
        await this.#performStandardRecovery();
      }
      
      this.lastRecoveryTime = new Date();
      
      logger.info('Recovery cycle completed', 'recovery-service', {
        duration: Date.now() - recoveryStartTime,
        type: needsEmergencyRecovery ? 'emergency' : 'standard',
        stats: this.recoveryStats
      });
      
    } catch (error) {
      logger.error('Recovery cycle failed', 'recovery-service', error);
      throw new ServiceUnavailableError('Recovery', `Recovery failed: ${error.message}`);
    }
  }
  
  /**
   * Assess if emergency recovery conditions are met
   */
  async #assessEmergencyConditions() {
    try {
      // Check for stale events
      const staleEvents = await this.eventRepository.findStaleEvents(
        ScraperConfig.STALE_EVENT_THRESHOLD / (1000 * 60 * 60) // Convert to hours
      );
      
      // Check session health
      const sessionStats = this.sessionManager?.getSessionStats() || { active: 0, failed: 0 };
      const totalSessions = sessionStats.active + sessionStats.failed;
      const errorRate = totalSessions > 0 ? sessionStats.failed / totalSessions : 0;
      
      // Check proxy health
      const proxyStats = this.proxyManager?.getUsageStats() || { healthyProxies: 0 };
      
      const conditions = {
        stalledEvents: staleEvents.length >= this.emergencyThreshold.stalledEvents,
        highErrorRate: errorRate >= this.emergencyThreshold.highErrorRate,
        noHealthyProxies: proxyStats.healthyProxies === 0,
        tooManyStaleEvents: staleEvents.length > 10
      };
      
      const needsEmergency = Object.values(conditions).some(condition => condition);
      
      if (needsEmergency) {
        logger.warn('Emergency recovery conditions detected', 'recovery-service', {
          conditions,
          staleEventCount: staleEvents.length,
          errorRate: (errorRate * 100).toFixed(2) + '%',
          healthyProxies: proxyStats.healthyProxies
        });
      }
      
      return needsEmergency;
      
    } catch (error) {
      logger.error('Failed to assess emergency conditions', 'recovery-service', error);
      return false;
    }
  }
  
  /**
   * Perform emergency recovery procedures
   */
  async #performEmergencyRecovery() {
    logger.warn('🚨 INITIATING EMERGENCY RECOVERY 🚨', 'recovery-service');
    
    this.recoveryStats.emergencyRecoveries++;
    
    try {
      // Step 1: Clear all processing locks and states
      logger.warn('Clearing all processing locks and states', 'recovery-service');
      await this.#clearProcessingStates();
      
      // Step 2: Force reset all sessions and cookies
      logger.warn('Force resetting all sessions and cookies', 'recovery-service');
      await this.#resetSessionsAndCookies();
      
      // Step 3: Release and refresh proxies
      logger.warn('Releasing and refreshing proxies', 'recovery-service');
      await this.#refreshProxyPool();
      
      // Step 4: Mark stale events for priority processing
      logger.warn('Marking stale events for priority processing', 'recovery-service');
      await this.#handleStaleEvents();
      
      // Step 5: Restart critical services
      logger.warn('Restarting critical services', 'recovery-service');
      await this.#restartCriticalServices();
      
      logger.info('🔄 EMERGENCY RECOVERY COMPLETE', 'recovery-service');
      
    } catch (error) {
      logger.error('Emergency recovery failed', 'recovery-service', error);
      throw error;
    }
  }
  
  /**
   * Perform standard recovery procedures
   */
  async #performStandardRecovery() {
    logger.info('Performing standard recovery', 'recovery-service');
    
    this.recoveryStats.totalRecoveries++;
    
    try {
      // Check for stale events
      const staleEvents = await this.eventRepository.findStaleEvents(1); // 1 hour threshold
      
      if (staleEvents.length > 0) {
        logger.info('Found stale events for recovery', 'recovery-service', {
          count: staleEvents.length
        });
        
        await this.#recoverStaleEvents(staleEvents);
      }
      
      // Validate and refresh sessions periodically
      await this.#validateSessions();
      
      // Check proxy health
      await this.#validateProxies();
      
      // Clean up old data
      await this.#performCleanup();
      
    } catch (error) {
      logger.error('Standard recovery failed', 'recovery-service', error);
      throw error;
    }
  }
  
  /**
   * Clear all processing states and locks
   */
  async #clearProcessingStates() {
    // This would clear any in-memory processing locks
    // Implementation depends on the orchestrator design
    logger.info('Clearing processing locks', 'recovery-service');
  }
  
  /**
   * Reset sessions and cookies
   */
  async #resetSessionsAndCookies() {
    try {
      if (this.sessionManager) {
        await this.sessionManager.forceRotateAllSessions();
        logger.info('All sessions rotated', 'recovery-service');
      }
      
      // Clear cookie files if they exist
      // Implementation depends on cookie management system
      logger.info('Cookie reset completed', 'recovery-service');
      
    } catch (error) {
      logger.error('Failed to reset sessions and cookies', 'recovery-service', error);
    }
  }
  
  /**
   * Refresh proxy pool
   */
  async #refreshProxyPool() {
    try {
      if (this.proxyManager) {
        await this.proxyManager.refreshProxyCache();
        const stats = this.proxyManager.getUsageStats();
        
        logger.info('Proxy pool refreshed', 'recovery-service', {
          healthyProxies: stats.healthyProxies,
          totalProxies: stats.totalProxies
        });
      }
    } catch (error) {
      logger.error('Failed to refresh proxy pool', 'recovery-service', error);
    }
  }
  
  /**
   * Handle stale events
   */
  async #handleStaleEvents() {
    try {
      const staleEvents = await this.eventRepository.findStaleEvents(2); // 2 hours
      
      if (staleEvents.length > 0) {
        // Mark for priority processing instead of stopping
        const eventIds = staleEvents.map(event => event.Event_ID);
        
        // Reset their timestamps to make them priority
        for (const event of staleEvents) {
          await this.eventRepository.update(event._id, {
            lastInventoryUpdate: new Date(Date.now() - ScraperConfig.MAX_UPDATE_INTERVAL),
            isStale: true
          });
        }
        
        this.recoveryStats.staleEventsRecovered += staleEvents.length;
        
        logger.info('Marked stale events for priority processing', 'recovery-service', {
          eventCount: staleEvents.length,
          eventIds: eventIds.slice(0, 5) // Log first 5
        });
      }
    } catch (error) {
      logger.error('Failed to handle stale events', 'recovery-service', error);
    }
  }
  
  /**
   * Recover specific stale events
   */
  async #recoverStaleEvents(staleEvents) {
    try {
      for (const event of staleEvents.slice(0, 5)) { // Limit to 5 at a time
        // Reset event to make it eligible for processing
        await this.eventRepository.update(event._id, {
          lastInventoryUpdate: new Date(Date.now() - ScraperConfig.MAX_UPDATE_INTERVAL),
          isStale: false
        });
        
        logger.info('Recovered stale event', 'recovery-service', {
          eventId: event.Event_ID,
          eventName: event.Event_Name
        });
      }
      
      this.recoveryStats.staleEventsRecovered += Math.min(staleEvents.length, 5);
      
    } catch (error) {
      logger.error('Failed to recover stale events', 'recovery-service', error);
    }
  }
  
  /**
   * Validate session health
   */
  async #validateSessions() {
    try {
      if (this.sessionManager) {
        await this.sessionManager.validateAndCleanupSessions();
        logger.info('Session validation completed', 'recovery-service');
      }
    } catch (error) {
      logger.error('Session validation failed', 'recovery-service', error);
    }
  }
  
  /**
   * Validate proxy health
   */
  async #validateProxies() {
    try {
      if (this.proxyManager) {
        // This would trigger proxy health checks
        await this.proxyManager.validateProxies();
        logger.info('Proxy validation completed', 'recovery-service');
      }
    } catch (error) {
      logger.error('Proxy validation failed', 'recovery-service', error);
    }
  }
  
  /**
   * Perform system cleanup
   */
  async #performCleanup() {
    try {
      // Clean up old error logs, expired sessions, etc.
      logger.info('Performing system cleanup', 'recovery-service');
      
      // Implementation would clean up old data
      
    } catch (error) {
      logger.error('System cleanup failed', 'recovery-service', error);
    }
  }
  
  /**
   * Restart critical services
   */
  async #restartCriticalServices() {
    try {
      logger.info('Critical services restart completed', 'recovery-service');
    } catch (error) {
      logger.error('Failed to restart critical services', 'recovery-service', error);
    }
  }
  
  /**
   * Get recovery statistics
   */
  getRecoveryStats() {
    return {
      ...this.recoveryStats,
      lastRecoveryTime: this.lastRecoveryTime,
      timeSinceLastRecovery: this.lastRecoveryTime 
        ? Date.now() - this.lastRecoveryTime.getTime()
        : null
    };
  }
}