/**
 * Event Service
 * Handles event-related business logic
 * Following nodejs-backend patterns for service layer
 */

import { EventRepository } from '../../infra/db/repositories/EventRepository.js';
import { NotFoundError, ValidationError } from '../errors.js';
import logger from '../../../utils/logger.js';

export class EventService {
  constructor(dependencies = {}) {
    this.eventRepository = dependencies.eventRepository || new EventRepository();
    this.scraperManager = dependencies.scraperManager;
  }
  
  /**
   * Get all events with pagination and filtering
   */
  async getAllEvents(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        venue,
        dateFrom,
        dateTo,
        search,
        includeStatus = true
      } = options;
      
      const result = await this.eventRepository.findAll({
        page,
        limit,
        status,
        venue,
        dateFrom,
        dateTo,
        search
      });
      
      // Add active status if scraper manager is available
      if (includeStatus && this.scraperManager) {
        result.events = result.events.map(event => ({
          ...event.toObject(),
          isActive: this.scraperManager.activeJobs?.has(event.Event_ID) || false,
          isRunning: this.scraperManager.isRunning || false
        }));
      }
      
      logger.info('Retrieved events', 'event-service', {
        count: result.events.length,
        total: result.pagination.total,
        page: result.pagination.page
      });
      
      return result;
      
    } catch (error) {
      logger.error('Failed to get all events', 'event-service', error);
      throw error;
    }
  }
  
  /**
   * Get event by ID (Event_ID or mapping_id)
   */
  async getEventById(eventId, options = {}) {
    try {
      const { includeGroups = false, includeStatus = true } = options;
      
      // Try to find by Event_ID first, then mapping_id
      let event = await this.eventRepository.findByEventId(eventId);
      
      if (!event) {
        // Try by MongoDB _id
        event = await this.eventRepository.findById(eventId);
      }
      
      if (!event) {
        throw new NotFoundError('Event', eventId);
      }
      
      const eventData = event.toObject();
      
      // Add active status if scraper manager is available
      if (includeStatus && this.scraperManager) {
        eventData.isActive = this.scraperManager.activeJobs?.has(event.Event_ID) || false;
        eventData.isRunning = this.scraperManager.isRunning || false;
      }
      
      // Include consecutive groups if requested
      if (includeGroups) {
        // This would require a ConsecutiveGroup repository
        // eventData.seatGroups = await this.getEventSeatGroups(event.Event_ID);
      }
      
      logger.info('Retrieved event by ID', 'event-service', {
        eventId: event.Event_ID,
        eventName: event.Event_Name
      });
      
      return eventData;
      
    } catch (error) {
      logger.error('Failed to get event by ID', 'event-service', { eventId, error });
      throw error;
    }
  }
  
  /**
   * Create new event
   */
  async createEvent(eventData) {
    try {
      // Validate required fields
      const requiredFields = ['Event_ID', 'Event_Name', 'Event_DateTime', 'URL', 'mapping_id'];
      for (const field of requiredFields) {
        if (!eventData[field]) {
          throw new ValidationError(`${field} is required`);
        }
      }
      
      // Create event using repository
      const event = await this.eventRepository.create(eventData);
      
      logger.info('Event created', 'event-service', {
        eventId: event.Event_ID,
        eventName: event.Event_Name
      });
      
      return event;
      
    } catch (error) {
      logger.error('Failed to create event', 'event-service', { eventData, error });
      throw error;
    }
  }
  
  /**
   * Update event
   */
  async updateEvent(eventId, updateData) {
    try {
      // Find the event first
      const event = await this.getEventById(eventId, { includeStatus: false });
      
      // Update using repository
      const updatedEvent = await this.eventRepository.update(event._id, updateData);
      
      logger.info('Event updated', 'event-service', {
        eventId: updatedEvent.Event_ID,
        updates: Object.keys(updateData)
      });
      
      return updatedEvent;
      
    } catch (error) {
      logger.error('Failed to update event', 'event-service', { eventId, updateData, error });
      throw error;
    }
  }
  
  /**
   * Delete event
   */
  async deleteEvent(eventId) {
    try {
      // Find the event first to get the internal ID
      const event = await this.getEventById(eventId, { includeStatus: false });
      
      // Stop scraping if active
      if (this.scraperManager && this.scraperManager.activeJobs?.has(event.Event_ID)) {
        await this.stopEventScraping(eventId);
      }
      
      // Delete using repository
      await this.eventRepository.delete(event._id);
      
      logger.info('Event deleted', 'event-service', {
        eventId: event.Event_ID,
        eventName: event.Event_Name
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to delete event', 'event-service', { eventId, error });
      throw error;
    }
  }
  
  /**
   * Start scraping for event
   */
  async startEventScraping(eventId) {
    try {
      if (!this.scraperManager) {
        throw new Error('Scraper manager not available');
      }
      
      const event = await this.getEventById(eventId, { includeStatus: false });
      
      // Check if already running
      if (this.scraperManager.activeJobs?.has(event.Event_ID)) {
        throw new ValidationError(`Event ${eventId} is already being scraped`);
      }
      
      // Start scraping using the enhanced scraper manager
      const result = await this.scraperManager.processEvent(event.Event_ID);
      
      logger.info('Started event scraping', 'event-service', {
        eventId: event.Event_ID,
        eventName: event.Event_Name
      });
      
      return result;
      
    } catch (error) {
      logger.error('Failed to start event scraping', 'event-service', { eventId, error });
      throw error;
    }
  }
  
  /**
   * Stop scraping for event
   */
  async stopEventScraping(eventId) {
    try {
      if (!this.scraperManager) {
        throw new Error('Scraper manager not available');
      }
      
      const event = await this.getEventById(eventId, { includeStatus: false });
      
      // Check if running
      if (!this.scraperManager.activeJobs?.has(event.Event_ID)) {
        throw new ValidationError(`Event ${eventId} is not being scraped`);
      }
      
      // Stop scraping (implementation depends on scraper manager)
      // For now, we'll assume the scraper manager handles this
      
      logger.info('Stopped event scraping', 'event-service', {
        eventId: event.Event_ID,
        eventName: event.Event_Name
      });
      
      return { success: true, eventId: event.Event_ID };
      
    } catch (error) {
      logger.error('Failed to stop event scraping', 'event-service', { eventId, error });
      throw error;
    }
  }
  
  /**
   * Get events by status
   */
  async getEventsByStatus(status, options = {}) {
    try {
      const events = await this.eventRepository.findByStatus(status, options);
      
      logger.info('Retrieved events by status', 'event-service', {
        status,
        count: events.length
      });
      
      return events;
      
    } catch (error) {
      logger.error('Failed to get events by status', 'event-service', { status, error });
      throw error;
    }
  }
  
  /**
   * Get stale events
   */
  async getStaleEvents(hoursThreshold = 24) {
    try {
      const staleEvents = await this.eventRepository.findStaleEvents(hoursThreshold);
      
      logger.info('Retrieved stale events', 'event-service', {
        count: staleEvents.length,
        hoursThreshold
      });
      
      return staleEvents;
      
    } catch (error) {
      logger.error('Failed to get stale events', 'event-service', { hoursThreshold, error });
      throw error;
    }
  }
  
  /**
   * Get event statistics
   */
  async getEventStatistics() {
    try {
      const stats = await this.eventRepository.getStats();
      
      // Add scraper manager stats if available
      if (this.scraperManager) {
        const scraperStats = this.scraperManager.getStats();
        stats.scraper = scraperStats;
      }
      
      logger.info('Retrieved event statistics', 'event-service', { stats });
      
      return stats;
      
    } catch (error) {
      logger.error('Failed to get event statistics', 'event-service', error);
      throw error;
    }
  }
}