/**
 * SeatCountValidator - Prevents false deletions/updates from incomplete Ticketmaster data
 * 
 * Problem: Ticketmaster sometimes returns incomplete seat data (e.g., 500 seats → 30 seats)
 * causing false deletions in downstream processing.
 * 
 * Solution: Track historical seat counts and flag suspicious fluctuations for delayed retry.
 * Uses MongoDB for multi-instance coordination.
 */

import { SeatValidation } from '../models/index.js';
import crypto from 'crypto';

class SeatCountValidator {
  constructor(options = {}) {
    this.FLUCTUATION_THRESHOLD = options.fluctuationThreshold || 0.3; // 30% drop triggers validation
    this.MIN_SEATS_FOR_VALIDATION = options.minSeatsForValidation || 10; // Only validate if previous count >= 10
    this.DELAY_DURATION = options.delayDuration || 30000; // 30 seconds delay
    this.MAX_HISTORY_AGE = options.maxHistoryAge || 24 * 60 * 60 * 1000; // 24 hours
    this.TREND_CHECK_COUNT = options.trendCheckCount || 3; // Number of consecutive checks to confirm trend
    this.TREND_ACCEPTANCE_THRESHOLD = options.trendAcceptanceThreshold || 0.4; // Accept after 40% sustained drop
    
    // Generate unique instance ID for tracking
    this.instanceId = crypto.randomBytes(8).toString('hex');
    
    // In-memory cache for performance
    this.cache = new Map();
    this.CACHE_TTL = 5000; // 5 seconds cache TTL
    
    console.log(`[SeatValidator] Initialized instance ${this.instanceId}`);
  }

  /**
   * Get cached validation record or fetch from database
   */
  async getValidationRecord(eventId) {
    // Check cache first
    const cached = this.cache.get(eventId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    
    // Fetch from database
    try {
      const record = await SeatValidation.findOne({ eventId });
      
      // Update cache
      if (record) {
        this.cache.set(eventId, {
          data: record,
          timestamp: Date.now()
        });
      }
      
      return record;
    } catch (error) {
      console.warn(`[SeatValidator] Error fetching record for ${eventId}:`, error.message);
      return null;
    }
  }
  
  /**
   * Update trend tracking atomically across multiple instances
   */
  async updateTrendTracking(eventId, newSeatCount, previousCount, now) {
    try {
      // Use atomic findOneAndUpdate to track trend across instances
      const result = await SeatValidation.findOneAndUpdate(
        { eventId },
        {
          $setOnInsert: {
            eventId,
            seatCount: previousCount,
            validationCount: 0,
            fluctuationCount: 0,
            lastUpdated: new Date(),
            instanceId: this.instanceId
          },
          $push: {
            trendTracking: {
              count: newSeatCount,
              timestamp: new Date(now),
              previousCount: previousCount,
              instanceId: this.instanceId
            }
          },
          $set: {
            lastUpdated: new Date(now)
          }
        },
        { 
          upsert: true, 
          new: true,
          returnDocument: 'after' // Get the updated document
        }
      );
      
      // Keep only last N trend entries
      const trendTracking = result.trendTracking || [];
      if (trendTracking.length > this.TREND_CHECK_COUNT) {
        // Remove old entries atomically
        await SeatValidation.updateOne(
          { eventId },
          {
            $set: {
              trendTracking: trendTracking.slice(-this.TREND_CHECK_COUNT)
            }
          }
        );
      }
      
      // Check if we have enough consecutive drops
      const recentTrends = trendTracking.slice(-this.TREND_CHECK_COUNT);
      const allSignificantDrops = recentTrends.every(t => {
        const drop = (t.previousCount - t.count) / t.previousCount;
        return drop > this.TREND_ACCEPTANCE_THRESHOLD;
      });
      
      return {
        shouldAccept: recentTrends.length >= this.TREND_CHECK_COUNT && allSignificantDrops,
        currentCheck: recentTrends.length,
        checkCount: this.TREND_CHECK_COUNT
      };
    } catch (error) {
      console.warn(`[SeatValidator] Error updating trend tracking for ${eventId}:`, error.message);
      // Fallback: reject the data if we can't track properly
      return {
        shouldAccept: false,
        currentCheck: 1,
        checkCount: this.TREND_CHECK_COUNT
      };
    }
  }

  /**
   * Update or create validation record in database
   */
  async updateValidationRecord(eventId, data) {
    try {
      const record = await SeatValidation.findOneAndUpdate(
        { eventId },
        { 
          $set: { 
            ...data,
            lastUpdated: new Date(),
            instanceId: this.instanceId
          }
        },
        { upsert: true, new: true }
      );
      
      // Update cache
      this.cache.set(eventId, {
        data: record,
        timestamp: Date.now()
      });
      
      return record;
    } catch (error) {
      console.warn(`[SeatValidator] Error updating record for ${eventId}:`, error.message);
      return null;
    }
  }

  /**
   * Validate seat count and detect suspicious fluctuations
   * 
   * @param {string} eventId - Event ID
   * @param {number} newSeatCount - New seat count from API
   * @param {object} options - Additional options
   * @returns {object} Validation result
   */
  async validateSeatCount(eventId, newSeatCount, options = {}) {
    const now = Date.now();
    
    // Get historical data from database
    const history = await this.getValidationRecord(eventId);
    
    // Check if event is currently delayed
    if (history && history.delayedUntil && new Date(history.delayedUntil) > new Date()) {
      const remainingDelay = Math.ceil((new Date(history.delayedUntil) - now) / 1000);
      return {
        isValid: false,
        shouldDelay: true,
        reason: 'event_delayed',
        message: `Event delayed due to previous fluctuation. Retry in ${remainingDelay}s`,
        delayUntil: history.delayedUntil,
        previousCount: history.previousCount || history.seatCount,
        suspiciousCount: newSeatCount
      };
    }
    
    // First time seeing this event - accept and record
    if (!history) {
      await this.updateValidationRecord(eventId, {
        seatCount: newSeatCount,
        validationCount: 1,
        fluctuationCount: 0,
        delayedUntil: null,
        previousCount: null
      });
      
      return {
        isValid: true,
        shouldDelay: false,
        reason: 'first_observation',
        message: `First observation: ${newSeatCount} seats recorded`,
        seatCount: newSeatCount
      };
    }

    const previousCount = history.seatCount;
    const timeSinceLastUpdate = now - new Date(history.lastUpdated).getTime();
    
    // Calculate fluctuation percentage
    const fluctuation = previousCount > 0 
      ? (previousCount - newSeatCount) / previousCount 
      : 0;
    
    // Check if this is a significant drop
    const isSignificantDrop = 
      fluctuation > this.FLUCTUATION_THRESHOLD && 
      previousCount >= this.MIN_SEATS_FOR_VALIDATION;
    
    if (isSignificantDrop) {
      // Use atomic database operation to track trend across instances
      const trendUpdate = await this.updateTrendTracking(eventId, newSeatCount, previousCount, now);
      
      if (trendUpdate.shouldAccept) {
        // All instances agree on sustained drop - accept the new lower count
        console.log(
          `[SeatValidator] ✓ CONFIRMED TREND for ${eventId}: ` +
          `Sustained drop over ${trendUpdate.checkCount} checks. ` +
          `Accepting ${newSeatCount} seats (was ${previousCount})`
        );
        
        await this.updateValidationRecord(eventId, {
          seatCount: newSeatCount,
          validationCount: (history.validationCount || 0) + 1,
          fluctuationCount: (history.fluctuationCount || 0) + trendUpdate.checkCount,
          lastFluctuation: new Date(),
          delayedUntil: null,
          previousCount,
          trendTracking: null // Clear trend tracking
        });
        
        return {
          isValid: true,
          shouldDelay: false,
          reason: 'confirmed_trend',
          message: `Confirmed sustained drop: ${newSeatCount} seats (was ${previousCount}) over ${trendUpdate.checkCount} checks`,
          previousCount,
          newCount: newSeatCount,
          fluctuationPercent: Math.round(fluctuation * 100)
        };
      }
      
      // Suspicious fluctuation detected!
      console.warn(
        `[SeatValidator] ⚠️ SUSPICIOUS FLUCTUATION for ${eventId}: ` +
        `${previousCount} → ${newSeatCount} seats (${Math.round(fluctuation * 100)}% drop) - ` +
        `Check ${trendUpdate.currentCheck}/${this.TREND_CHECK_COUNT} - REJECTING DATA`
      );
      
      // Only update delay time and fluctuation count, DO NOT update lastUpdated or seatCount
      // This prevents the bad data from being recorded
      try {
        await SeatValidation.findOneAndUpdate(
          { eventId },
          { 
            $set: {
              delayedUntil: new Date(now + this.DELAY_DURATION),
              lastFluctuation: new Date(),
              previousCount
            },
            $inc: {
              fluctuationCount: 1
            }
            // Note: NOT updating lastUpdated, seatCount, or validationCount
          },
          { upsert: false } // Don't create if doesn't exist
        );
        
        // Invalidate cache so next read gets fresh data
        this.cache.delete(eventId);
      } catch (error) {
        console.warn(`[SeatValidator] Error setting delay for ${eventId}:`, error.message);
      }
      
      return {
        isValid: false,
        shouldDelay: true,
        reason: 'suspicious_fluctuation',
        message: `Seat count dropped ${Math.round(fluctuation * 100)}% (${previousCount} → ${newSeatCount}). Data REJECTED - check ${trendUpdate.currentCheck}/${this.TREND_CHECK_COUNT} - delaying for ${this.DELAY_DURATION / 1000}s`,
        previousCount,
        newCount: newSeatCount,
        fluctuationPercent: Math.round(fluctuation * 100),
        delayUntil: now + this.DELAY_DURATION,
        trendCheck: `${trendUpdate.currentCheck}/${this.TREND_CHECK_COUNT}`
      };
    }
    
    // Valid count - update database
    await this.updateValidationRecord(eventId, {
      seatCount: newSeatCount,
      validationCount: (history.validationCount || 0) + 1,
      fluctuationCount: history.fluctuationCount || 0,
      lastFluctuation: history.lastFluctuation,
      delayedUntil: null, // Clear any previous delay
      previousCount
    });
    
    return {
      isValid: true,
      shouldDelay: false,
      reason: 'normal_fluctuation',
      message: `Valid seat count: ${newSeatCount} (previous: ${previousCount})`,
      previousCount,
      newCount: newSeatCount,
      fluctuationPercent: Math.round(Math.abs(fluctuation) * 100)
    };
  }

  /**
   * Check if an event should be delayed
   */
  async isEventDelayed(eventId) {
    const history = await this.getValidationRecord(eventId);
    
    if (!history || !history.delayedUntil) {
      return false;
    }
    
    const now = new Date();
    if (new Date(history.delayedUntil) <= now) {
      // Delay expired, clear it
      await this.updateValidationRecord(eventId, {
        ...history.toObject(),
        delayedUntil: null
      });
      return false;
    }
    
    return true;
  }

  /**
   * Get delay information for an event
   */
  async getDelayInfo(eventId) {
    const history = await this.getValidationRecord(eventId);
    
    if (!history || !history.delayedUntil) {
      return null;
    }
    
    return {
      eventId: history.eventId,
      delayedUntil: history.delayedUntil,
      previousCount: history.previousCount || history.seatCount,
      seatCount: history.seatCount
    };
  }

  /**
   * Clear delay for an event (force retry)
   */
  async clearDelay(eventId) {
    const history = await this.getValidationRecord(eventId);
    
    if (history) {
      await this.updateValidationRecord(eventId, {
        ...history.toObject(),
        delayedUntil: null
      });
    }
    
    console.log(`[SeatValidator] Cleared delay for event ${eventId}`);
  }

  /**
   * Get statistics about validations
   */
  async getStats() {
    try {
      const [totalEvents, delayedEvents, aggregateStats] = await Promise.all([
        SeatValidation.countDocuments(),
        SeatValidation.countDocuments({ delayedUntil: { $gt: new Date() } }),
        SeatValidation.aggregate([
          {
            $group: {
              _id: null,
              totalFluctuations: { $sum: '$fluctuationCount' },
              totalValidations: { $sum: '$validationCount' }
            }
          }
        ])
      ]);
      
      const stats = aggregateStats[0] || { totalFluctuations: 0, totalValidations: 0 };
      
      return {
        totalEvents,
        delayedEvents,
        totalFluctuations: stats.totalFluctuations,
        totalValidations: stats.totalValidations,
        fluctuationRate: stats.totalValidations > 0 
          ? Math.round((stats.totalFluctuations / stats.totalValidations) * 100) 
          : 0
      };
    } catch (error) {
      console.warn('[SeatValidator] Error getting stats:', error.message);
      return {
        totalEvents: 0,
        delayedEvents: 0,
        totalFluctuations: 0,
        totalValidations: 0,
        fluctuationRate: 0
      };
    }
  }

  /**
   * Clean up old history entries
   */
  async cleanupOldHistory() {
    try {
      const cleaned = await SeatValidation.cleanupOld(this.MAX_HISTORY_AGE);
      
      if (cleaned > 0) {
        console.log(`[SeatValidator] Cleaned up ${cleaned} old history entries`);
      }
      
      // Also clear expired delays
      const clearedDelays = await SeatValidation.clearExpiredDelays();
      if (clearedDelays > 0) {
        console.log(`[SeatValidator] Cleared ${clearedDelays} expired delays`);
      }
      
      // Clean up old trend tracking data (older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const trendCleaned = await SeatValidation.updateMany(
        { 
          trendTracking: { $exists: true, $ne: [] }
        },
        {
          $pull: {
            trendTracking: {
              timestamp: { $lt: oneHourAgo }
            }
          }
        }
      );
      
      if (trendCleaned.modifiedCount > 0) {
        console.log(`[SeatValidator] Cleaned up ${trendCleaned.modifiedCount} old trend tracking entries`);
      }
      
      return cleaned;
    } catch (error) {
      console.warn('[SeatValidator] Cleanup error:', error.message);
      return 0;
    }
  }

  /**
   * Force update seat count (bypass validation)
   */
  async forceUpdateSeatCount(eventId, seatCount) {
    await this.updateValidationRecord(eventId, {
      seatCount,
      validationCount: 1,
      fluctuationCount: 0,
      delayedUntil: null,
      previousCount: null
    });
    
    console.log(`[SeatValidator] Force updated ${eventId} to ${seatCount} seats`);
  }
}

// Create singleton instance
const seatValidator = new SeatCountValidator({
  fluctuationThreshold: 0.3,  // 30% drop triggers validation
  minSeatsForValidation: 10,   // Only validate if previous count >= 10
  delayDuration: 30000,        // 30 seconds delay
  maxHistoryAge: 24 * 60 * 60 * 1000, // 24 hours
  trendCheckCount: 3,          // Require 3 consecutive checks
  trendAcceptanceThreshold: 0.4 // Accept after 40% sustained drop
});

// Cleanup old history every hour
setInterval(() => {
  seatValidator.cleanupOldHistory().catch(err => {
    console.warn('[SeatValidator] Cleanup error:', err.message);
  });
}, 60 * 60 * 1000);

export default seatValidator;
export { SeatCountValidator };
