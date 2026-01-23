import Event from '../../../models/eventModel.js';
import { NotFoundError, ValidationError, ConflictError } from '../../core/errors.js';
import { EventStatus } from '../../core/types/index.js';
import logger from '../../../utils/logger.js';

/**
 * Event Repository following clean architecture patterns
 * Handles all Event data access with proper error handling
 */
export class EventRepository {
  /**
   * Find event by ID
   * @param {string} id - Event ID
   * @returns {Promise<Object|null>} Event entity or null if not found
   */
  async findById(id) {
    try {
      const event = await Event.findById(id);
      return event;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new ValidationError(`Invalid event ID format: ${id}`);
      }
      throw error;
    }
  }

  /**
   * Find event by Event_ID
   * @param {string} eventId - Event ID from external system
   * @returns {Promise<Object|null>} Event entity or null if not found
   */
  async findByEventId(eventId) {
    try {
      const event = await Event.findOne({ Event_ID: eventId });
      return event;
    } catch (error) {
      logger.error('Error finding event by Event_ID', 'event-repository', { eventId, error });
      throw error;
    }
  }

  /**
   * Find all events with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated events with metadata
   */
  async findAll(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        venue,
        dateFrom,
        dateTo,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      // Build query filter
      const filter = {};
      
      if (status) {
        filter.Status = status;
      }
      
      if (venue) {
        filter.Venue = { $regex: venue, $options: 'i' };
      }
      
      if (dateFrom || dateTo) {
        filter.Event_DateTime = {};
        if (dateFrom) filter.Event_DateTime.$gte = new Date(dateFrom);
        if (dateTo) filter.Event_DateTime.$lte = new Date(dateTo);
      }
      
      if (search) {
        filter.$or = [
          { Event_Name: { $regex: search, $options: 'i' } },
          { Event_ID: { $regex: search, $options: 'i' } },
          { Venue: { $regex: search, $options: 'i' } }
        ];
      }

      // Calculate pagination
      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

      // Execute query
      const [events, total] = await Promise.all([
        Event.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        Event.countDocuments(filter)
      ]);

      return {
        events,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      logger.error('Error finding events', 'event-repository', { options, error });
      throw error;
    }
  }

  /**
   * Create new event
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} Created event
   */
  async create(eventData) {
    try {
      // Check for existing event with same Event_ID
      const existingEvent = await this.findByEventId(eventData.Event_ID);
      if (existingEvent) {
        throw new ConflictError(
          `Event with Event_ID '${eventData.Event_ID}' already exists`,
          'event'
        );
      }

      const event = new Event({
        ...eventData,
        Status: eventData.Status || EventStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const savedEvent = await event.save();
      logger.info('Event created', 'event-repository', { eventId: savedEvent.Event_ID });
      
      return savedEvent;
    } catch (error) {
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        throw new ConflictError(
          `Event with ${field} '${error.keyValue[field]}' already exists`,
          'event'
        );
      }
      
      if (error.name === 'ValidationError') {
        const validationErrors = Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }));
        throw new ValidationError('Event validation failed', validationErrors);
      }
      
      logger.error('Error creating event', 'event-repository', { eventData, error });
      throw error;
    }
  }

  /**
   * Update event by ID
   * @param {string} id - Event ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated event
   */
  async update(id, updateData) {
    try {
      const updatedEvent = await Event.findByIdAndUpdate(
        id,
        { 
          ...updateData, 
          updatedAt: new Date() 
        },
        { 
          new: true, 
          runValidators: true 
        }
      );

      if (!updatedEvent) {
        throw new NotFoundError('Event', id);
      }

      logger.info('Event updated', 'event-repository', { 
        eventId: updatedEvent.Event_ID, 
        updates: Object.keys(updateData) 
      });

      return updatedEvent;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new ValidationError(`Invalid event ID format: ${id}`);
      }
      
      logger.error('Error updating event', 'event-repository', { id, updateData, error });
      throw error;
    }
  }

  /**
   * Delete event by ID
   * @param {string} id - Event ID
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async delete(id) {
    try {
      const deletedEvent = await Event.findByIdAndDelete(id);
      
      if (!deletedEvent) {
        throw new NotFoundError('Event', id);
      }

      logger.info('Event deleted', 'event-repository', { eventId: deletedEvent.Event_ID });
      return true;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new ValidationError(`Invalid event ID format: ${id}`);
      }
      
      logger.error('Error deleting event', 'event-repository', { id, error });
      throw error;
    }
  }

  /**
   * Find events by status
   * @param {string} status - Event status
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} Events with specified status
   */
  async findByStatus(status, options = {}) {
    try {
      const { limit, sortBy = 'createdAt', sortOrder = 'desc' } = options;
      
      const query = Event.find({ Status: status });
      
      if (sortBy) {
        query.sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 });
      }
      
      if (limit) {
        query.limit(limit);
      }
      
      const events = await query.exec();
      return events;
    } catch (error) {
      logger.error('Error finding events by status', 'event-repository', { status, options, error });
      throw error;
    }
  }

  /**
   * Find stale events (events that haven't been updated recently)
   * @param {number} hoursThreshold - Hours threshold for stale check
   * @returns {Promise<Array>} Stale events
   */
  async findStaleEvents(hoursThreshold = 24) {
    try {
      const thresholdDate = new Date(Date.now() - (hoursThreshold * 60 * 60 * 1000));
      
      const staleEvents = await Event.find({
        Status: { $in: [EventStatus.ACTIVE, EventStatus.PENDING] },
        $or: [
          { lastInventoryUpdate: { $lt: thresholdDate } },
          { lastInventoryUpdate: { $exists: false } }
        ]
      });

      return staleEvents;
    } catch (error) {
      logger.error('Error finding stale events', 'event-repository', { hoursThreshold, error });
      throw error;
    }
  }

  /**
   * Update last inventory update timestamp
   * @param {string} eventId - Event ID
   * @param {number} inventoryCount - Number of inventory items found
   * @returns {Promise<Object>} Updated event
   */
  async updateInventoryTimestamp(eventId, inventoryCount = 0) {
    try {
      const updatedEvent = await Event.findOneAndUpdate(
        { Event_ID: eventId },
        { 
          lastInventoryUpdate: new Date(),
          inventoryCount: inventoryCount,
          isStale: false,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!updatedEvent) {
        throw new NotFoundError('Event', eventId);
      }

      return updatedEvent;
    } catch (error) {
      logger.error('Error updating inventory timestamp', 'event-repository', { eventId, error });
      throw error;
    }
  }

  /**
   * Mark events as stale
   * @param {Array} eventIds - Array of event IDs to mark as stale
   * @returns {Promise<Object>} Update result
   */
  async markAsStale(eventIds) {
    try {
      const result = await Event.updateMany(
        { Event_ID: { $in: eventIds } },
        { 
          isStale: true,
          updatedAt: new Date()
        }
      );

      logger.info('Events marked as stale', 'event-repository', { 
        eventCount: result.modifiedCount,
        eventIds 
      });

      return result;
    } catch (error) {
      logger.error('Error marking events as stale', 'event-repository', { eventIds, error });
      throw error;
    }
  }

  /**
   * Get event statistics
   * @returns {Promise<Object>} Event statistics
   */
  async getStats() {
    try {
      const stats = await Event.aggregate([
        {
          $group: {
            _id: '$Status',
            count: { $sum: 1 },
            avgInventoryCount: { $avg: '$inventoryCount' }
          }
        },
        {
          $project: {
            status: '$_id',
            count: 1,
            avgInventoryCount: { $round: ['$avgInventoryCount', 2] },
            _id: 0
          }
        }
      ]);

      const total = await Event.countDocuments();
      const staleCount = await Event.countDocuments({ isStale: true });

      return {
        total,
        staleCount,
        byStatus: stats.reduce((acc, stat) => {
          acc[stat.status] = stat;
          return acc;
        }, {})
      };
    } catch (error) {
      logger.error('Error getting event statistics', 'event-repository', { error });
      throw error;
    }
  }
}